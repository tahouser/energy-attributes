"""Coordinator and live training manager for Energy Attribution."""
from __future__ import annotations

import asyncio
import logging
import csv
import aiohttp
from datetime import datetime, timezone
from pathlib import Path
from datetime import timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.storage import Store
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import device_registry as dr
from homeassistant.const import CONF_HOST, CONF_PORT, CONF_USERNAME, CONF_PASSWORD
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import CONF_MONITORED_ENTITIES, CONF_POWER_ENTITY, DOMAIN
from .training import TrainingEngine

_LOGGER=logging.getLogger(__name__)

class EnergyAttributionCoordinator(DataUpdateCoordinator[dict]):
    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass=hass
        self.entry=entry
        self.power_entity=entry.data[CONF_POWER_ENTITY]
        self.monitored_entities=entry.options.get(CONF_MONITORED_ENTITIES, entry.data.get(CONF_MONITORED_ENTITIES, []))
        self.device_classifications=entry.options.get("device_classifications", entry.data.get("device_classifications", {}))
        self.commissioned_devices=entry.options.get("commissioned_devices", entry.data.get("commissioned_devices", {}))
        self.candidate_devices=entry.options.get("candidate_devices", entry.data.get("candidate_devices", {}))
        self._remove_shelly_energy_meter_candidates()
        self.training_state=entry.options.get("training_state", entry.data.get("training_state", {}))
        self.training_samples=entry.options.get("training_samples", entry.data.get("training_samples", {}))
        self._store=Store(hass, 1, f"{DOMAIN}.training.{entry.entry_id}", private=True)
        self._training_engine: TrainingEngine|None=None
        self._training_device: str|None=None
        self.last_training_device_id: str|None=None
        self._training_task: asyncio.Task|None=None
        self._training_lock=asyncio.Lock()
        self._response_log_path = Path(self.hass.config.path("energy_attribution_response.csv"))
        self._response_last_updated = None
        self._response_pending_action = None
        self._direct_rpc_task: asyncio.Task | None = None
        self._direct_rpc_samples: list[tuple[float, float]] = []
        self._direct_rpc_available = False
        self._direct_rpc_host: str | None = None
        self._direct_rpc_mode: str | None = None
        self.bulk_training_state={"status":"idle","queue":[],"current_index":0,"total":0,"current_device_id":None,"completed":0,"skipped":[],"failed":[]}
        self._last_persist=0.0
        super().__init__(hass, logger=_LOGGER, name="energy_attribution", update_interval=timedelta(seconds=2))

    def _remove_shelly_energy_meter_candidates(self):
        """Remove stale Shelly Energy Meter candidates from persisted inventory."""
        removed = []
        for did, candidate in list(self.candidate_devices.items()):
            text = " ".join(str(candidate.get(key, "") or "") for key in ("name", "manufacturer", "model", "evidence")).casefold()
            if "shelly" in text and "energy meter" in text:
                removed.append(did)
                self.candidate_devices.pop(did, None)
                self.device_classifications.pop(did, None)
                self.training_state.pop(did, None)
                self.training_samples.pop(did, None)
        if removed:
            self.monitored_entities = [
                entity_id
                for did, candidate in self.candidate_devices.items()
                for measurement in candidate.get("measurements", [])
                for entity_id in [measurement.get("entity_id")]
                if entity_id
            ]
            self.hass.config_entries.async_update_entry(
                self.entry,
                options={
                    **self.entry.options,
                    "candidate_devices": self.candidate_devices,
                    "device_classifications": self.device_classifications,
                    "monitored_entities": self.monitored_entities,
                },
            )

    async def async_load_training(self):
        saved=await self._store.async_load()
        if isinstance(saved, dict):
            self.training_state=saved.get("training_state", self.training_state)
            self.training_samples=saved.get("training_samples", self.training_samples)
            self.last_training_device_id=saved.get("last_training_device_id", self.last_training_device_id)
            active=saved.get("active")
            if active and active.get("status")=="active":
                # Do not silently operate a device after HA restarts. Retain the
                # captured state for review, but require an explicit restart.
                active["status"]="interrupted"
                self.training_state[active["device_id"]]=active
                await self._persist()

    async def _persist(self, force: bool = False):
        now = self.hass.loop.time()
        if not force and now - self._last_persist < 5.0:
            return
        self._last_persist = now
        await self._store.async_save({
            "training_state":self.training_state,
            "training_samples":self.training_samples,
            "last_training_device_id": self.last_training_device_id,
            "active": self.training_state.get(self._training_device) if self._training_device else None,
        })


    async def async_bulk_auto_training(self, device_ids: list[str]) -> dict:
        """Train selected HA/entity devices sequentially using Auto Quick."""
        selected=[]
        skipped=[]
        for did in device_ids:
            candidate=self.candidate_devices.get(did)
            if not candidate or str(candidate.get("source", "ha")).casefold()=="manual":
                continue
            if not self._auto_control_entities(did):
                skipped.append({"device_id":did,"reason":"No supported controllable HA entity"})
                continue
            selected.append(did)
        self.bulk_training_state={"status":"active","queue":selected,"current_index":0,"total":len(selected),"current_device_id":None,"completed":0,"skipped":skipped,"failed":[]}
        await self._persist(force=True)
        if not selected:
            self.bulk_training_state["status"]="complete"
            await self._persist(force=True)
            return self.bulk_training_state.copy()
        self.hass.async_create_task(self._bulk_training_loop(selected))
        return self.bulk_training_state.copy()

    async def _bulk_training_loop(self, selected: list[str]):
        for index, did in enumerate(selected, start=1):
            self.bulk_training_state.update({"current_index":index,"current_device_id":did})
            try:
                await self.async_start_training(did, "quick")
                if self._training_task:
                    await self._training_task
                state=self.training_state.get(did,{})
                if state.get("status")=="complete":
                    self.bulk_training_state["completed"] += 1
                else:
                    self.bulk_training_state["failed"].append({"device_id":did,"reason":state.get("error") or state.get("instruction") or state.get("status","failed")})
            except Exception as err:
                _LOGGER.exception("Bulk training failed for %s", did)
                self.bulk_training_state["failed"].append({"device_id":did,"reason":str(err)})
            await self._persist(force=True)
            if index < len(selected):
                await asyncio.sleep(2.0)
        self.bulk_training_state.update({"status":"complete","current_device_id":None})
        await self._persist(force=True)

    def _response_log(self, event: str, device_id: str, **values: Any) -> None:
        """Write a compact training response-timing record for diagnostics."""
        try:
            path = self._response_log_path
            new_file = not path.exists()
            row = {
                "timestamp_utc": datetime.now(timezone.utc).isoformat(),
                "event": event,
                "device_id": device_id,
                **values,
            }
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", newline="", encoding="utf-8") as fh:
                writer = csv.DictWriter(fh, fieldnames=list(row.keys()))
                if new_file:
                    writer.writeheader()
                writer.writerow(row)
        except Exception:  # diagnostics must never break training
            _LOGGER.debug("Unable to write EnergyIQ response diagnostic", exc_info=True)

    async def async_start_training(self, device_id:str, method:str) -> dict:
        async with self._training_lock:
            if self._training_task and not self._training_task.done():
                raise RuntimeError("Another training session is already active")
            if method=="quick":
                engine=TrainingEngine("quick")
            elif method=="manual":
                engine=TrainingEngine("manual")
            else:
                engine=TrainingEngine("full_cycle")
            candidate=self.candidate_devices.get(device_id,{})
            state={"status":"active","phase":"baseline","method":method,"device_id":device_id,
                   "device_name":candidate.get("name",device_id),"area":candidate.get("area",""),
                   "started_at":self.hass.loop.time(),"baseline_w":None,"peak_delta_w":None,
                   "events_detected":0,"result":None,"learned":False,"live_power_w":None,"live_delta_w":None,"live_peak_w":None}
            self.training_state[device_id]=state
            self._training_engine=engine
            self._training_device=device_id
            self.last_training_device_id=device_id
            self._response_last_updated = None
            self._response_pending_action = None
            self._direct_rpc_samples.clear()
            self._direct_rpc_available = False
            self._direct_rpc_host = None
            self._direct_rpc_mode = None
            self._response_log("training_start", device_id, power_entity=self.power_entity, method=method)
            if self._direct_rpc_task and not self._direct_rpc_task.done():
                self._direct_rpc_task.cancel()
                try:
                    await self._direct_rpc_task
                except asyncio.CancelledError:
                    pass
            self._direct_rpc_task = self.hass.async_create_task(self._direct_shelly_poll(device_id))
            await self._persist(force=True)
            self._training_task=self.hass.async_create_task(self._training_loop(device_id,method))
            return state

    def _shelly_rpc_config(self) -> tuple[str, int, str | None, str | None] | None:
        """Resolve a local Shelly connection from the selected whole-home entity.

        Prefer the selected entity's Shelly config entry, then its device and
        parent-device config entries. If HA has exactly one Shelly entry, use
        that as a safe fallback. Multiple unrelated Shelly entries require an
        explicit future selection rather than guessing.
        """
        registry = er.async_get(self.hass)
        device_registry = dr.async_get(self.hass)
        entity = registry.async_get(self.power_entity)
        candidate_entries = []

        def add_entry(entry_id: str | None) -> None:
            if not entry_id:
                return
            entry = self.hass.config_entries.async_get_entry(entry_id)
            if entry and entry.domain == "shelly" and entry.data.get(CONF_HOST):
                candidate_entries.append(entry)

        if entity:
            add_entry(entity.config_entry_id)
            if entity.device_id:
                device = device_registry.async_get(entity.device_id)
                if device:
                    for entry_id in getattr(device, "config_entries", set()):
                        add_entry(entry_id)
                    parent_id = getattr(device, "parent_device_id", None)
                    if parent_id:
                        parent = device_registry.async_get(parent_id)
                        if parent:
                            for entry_id in getattr(parent, "config_entries", set()):
                                add_entry(entry_id)

        if not candidate_entries:
            shelly_entries = [
                e for e in self.hass.config_entries.async_entries("shelly")
                if e.data.get(CONF_HOST)
            ]
            if len(shelly_entries) == 1:
                candidate_entries = shelly_entries

        unique = {entry.entry_id: entry for entry in candidate_entries}
        if len(unique) != 1:
            return None
        entry = next(iter(unique.values()))
        return (
            entry.data[CONF_HOST],
            int(entry.data.get(CONF_PORT, 80)),
            entry.data.get(CONF_USERNAME),
            entry.data.get(CONF_PASSWORD),
        )

    async def _direct_shelly_poll(self, device_id: str):
        """Poll the selected Shelly locally and provide fast training samples."""
        config = self._shelly_rpc_config()
        if config is None:
            self._direct_rpc_available = False
            self._response_log(
                "rpc_unavailable",
                device_id,
                reason="No unique Shelly connection could be resolved from the selected whole-home meter",
            )
            return

        host, port, username, password = config
        auth = aiohttp.BasicAuth(username, password) if username and password else None
        timeout = aiohttp.ClientTimeout(total=1.0)
        session = async_get_clientsession(self.hass)
        try:
            while self._training_device == device_id:
                started = self.hass.loop.time()
                try:
                    total = None
                    source = None

                    # Pro 3EM firmware/configurations can expose the aggregate
                    # through EM.GetStatus, while others expose the three phase
                    # readings as EM1 components. Try the aggregate endpoint once;
                    # if it is unsupported (notably HTTP 404), switch to the
                    # phase-sum endpoint for the remainder of this training run.
                    if self._direct_rpc_mode != "em1":
                        url = f"http://{host}:{port}/rpc/EM.GetStatus?id=0"
                        try:
                            async with session.get(url, auth=auth, timeout=timeout) as response:
                                response.raise_for_status()
                                payload = await response.json(content_type=None)
                            total = payload.get("total_act_power") if isinstance(payload, dict) else None
                            if total is not None:
                                source = "EM.GetStatus"
                                self._direct_rpc_mode = "em"
                        except aiohttp.ClientResponseError as err:
                            if err.status != 404:
                                raise
                            self._direct_rpc_mode = "em1"

                    if total is None:
                        phase_values = []
                        for phase_id in (0, 1, 2):
                            phase_url = f"http://{host}:{port}/rpc/EM1.GetStatus?id={phase_id}"
                            async with session.get(phase_url, auth=auth, timeout=timeout) as phase_response:
                                phase_response.raise_for_status()
                                phase_payload = await phase_response.json(content_type=None)
                            value = phase_payload.get("act_power") if isinstance(phase_payload, dict) else None
                            if value is not None:
                                phase_values.append(float(value))
                        if len(phase_values) != 3:
                            raise RuntimeError("Shelly EM1 phase readings were incomplete")
                        total = sum(phase_values)
                        source = "EM1.GetStatus(sum)"
                        self._direct_rpc_mode = "em1"

                    elapsed_ms = (self.hass.loop.time() - started) * 1000.0
                    total = float(total)
                    sample_time = self.hass.loop.time()
                    self._direct_rpc_available = True
                    self._direct_rpc_host = host
                    self._direct_rpc_samples.append((sample_time, total))

                    whole = self.hass.states.get(self.power_entity)
                    ha_w = None
                    ha_updated = ""
                    if whole is not None:
                        try:
                            ha_w = float(whole.state)
                        except (TypeError, ValueError):
                            pass
                        ha_updated = whole.last_updated.isoformat()

                    self._response_log(
                        "shelly_rpc_sample",
                        device_id,
                        shelly_host=host,
                        rpc_source=source,
                        rpc_power_w=round(total, 3),
                        rpc_elapsed_ms=round(elapsed_ms, 2),
                        ha_power_w=ha_w,
                        ha_last_updated=ha_updated,
                    )
                except Exception as err:
                    self._response_log(
                        "shelly_rpc_error", device_id, shelly_host=host, error=str(err)
                    )
                await asyncio.sleep(0.25)
        except asyncio.CancelledError:
            raise

    async def _training_loop(self, device_id: str, method: str):
        try:
            controls = self._auto_control_entities(device_id)
            if method == "quick" and not controls:
                raise RuntimeError("This device has no known controllable entity for Quick ON/OFF training.")
            control_state = "off"
            direct_cursor = 0
            while self._training_engine and self._training_device == device_id:
                samples: list[tuple[float, float]] = []

                # Once a direct Shelly sample is available, it is the preferred
                # whole-home signal for the entire training session. This keeps
                # the established Quick timing while removing HA's slower state
                # propagation from the measurement path.
                if self._direct_rpc_available:
                    if direct_cursor < len(self._direct_rpc_samples):
                        samples = self._direct_rpc_samples[direct_cursor:]
                        direct_cursor = len(self._direct_rpc_samples)
                else:
                    whole = self.hass.states.get(self.power_entity)
                    try:
                        watts = float(whole.state) if whole else None
                    except (TypeError, ValueError):
                        watts = None
                    if watts is not None:
                        now = self.hass.loop.time()
                        samples = [(now, watts)]
                        state_updated = whole.last_updated.isoformat() if whole else ""
                        if state_updated != self._response_last_updated:
                            self._response_last_updated = state_updated
                            values = {"power_w": watts, "ha_last_updated": state_updated}
                            if self._response_pending_action:
                                action = self._response_pending_action
                                values["response_to_action"] = action
                                self._response_pending_action = None
                            self._response_log("power_update", device_id, **values)

                if samples:
                    for now, watts in samples:
                        state = self.training_state[device_id]
                        state["live_power_w"] = watts
                        baseline = state.get("baseline_w")
                        state["live_delta_w"] = max(0.0, watts - baseline) if baseline is not None else None
                        if state.get("live_peak_w") is None or watts > state.get("live_peak_w", watts):
                            state["live_peak_w"] = watts

                        result = self._training_engine.add_sample(now, watts)
                        state.update({
                            k: result.get(k) for k in (
                                "phase", "baseline_w", "peak_delta_w", "events_detected",
                                "duration_s", "energy_wh", "cycles_required", "cycles_completed"
                            )
                        })
                        baseline = state.get("baseline_w")
                        state["live_delta_w"] = max(0.0, watts - baseline) if baseline is not None else None
                        state["result"] = result

                        if method == "quick" and result.get("action"):
                            action = result["action"]
                            if action == "turn_on" and control_state == "off":
                                state["instruction"] = "Turning the test device ON automatically…"
                                await self._call_power(controls, True)
                                control_state = "on"
                                self._training_engine.control_action_consumed("turn_on", self.hass.loop.time())
                            elif action == "turn_off" and control_state == "on":
                                state["instruction"] = "Turning the test device OFF automatically…"
                                await self._call_power(controls, False)
                                control_state = "off"
                                self._training_engine.control_action_consumed("turn_off", self.hass.loop.time())

                        if result.get("failed"):
                            state["status"] = "error"
                            state["instruction"] = result.get("failure_reason", "Training could not be completed.")
                            state["error"] = state["instruction"]
                            await self._persist(force=True)
                            return

                        if result.get("completed"):
                            if control_state == "on":
                                await self._call_power(controls, False)
                                control_state = "off"
                            state["status"] = "complete"
                            state["instruction"] = (
                                "Training Complete. One manual electrical cycle was captured and saved."
                                if method == "manual"
                                else "Training Complete. Three controlled measurements were captured and saved."
                            )
                            state["learned"] = True
                            state["completed_at"] = self.hass.loop.time()
                            self.last_training_device_id = device_id
                            state["completed"] = True
                            self._response_log(
                                "training_complete", device_id,
                                learned_load_w=result.get("peak_delta_w"),
                                measurement_source="shelly_rpc" if self._direct_rpc_available else "ha_entity",
                                shelly_host=self._direct_rpc_host or "",
                            )
                            state["learned_signature"] = {
                                "method": method, "baseline_w": result.get("baseline_w"), "load_w": result.get("peak_delta_w"),
                                "duration_s": result.get("duration_s"), "energy_wh": result.get("energy_wh"),
                                "events_detected": result.get("events_detected", 0), "observations": result.get("observations", []),
                            }
                            await self._persist(force=True)
                            if self._direct_rpc_task and not self._direct_rpc_task.done():
                                self._direct_rpc_task.cancel()
                            return

                        await self._persist()

                await asyncio.sleep(0.10 if self._direct_rpc_available else 0.5)
        except asyncio.CancelledError:
            raise
        except Exception as err:
            if self._direct_rpc_task and not self._direct_rpc_task.done():
                self._direct_rpc_task.cancel()
            _LOGGER.exception("Training failed")
            state = self.training_state.get(device_id, {})
            state["status"] = "error"
            state["error"] = str(err)
            state["instruction"] = str(err)
            await self._persist(force=True)

    def _auto_control_entities(self, device_id:str)->list[str]:
        candidate=self.candidate_devices.get(device_id,{})
        controls=[c for c in candidate.get("controls",[]) if c.get("domain") in {"light","switch","fan","humidifier","climate","water_heater"}]
        priority={"light":0,"switch":1,"fan":2,"humidifier":3,"climate":4,"water_heater":5}
        controls.sort(key=lambda c: priority.get(c.get("domain"),99))
        return [controls[0]["entity_id"]] if controls else []

    async def _call_power(self, entities:list[str], turn_on:bool):
        for entity_id in entities:
            domain=entity_id.split(".",1)[0]
            service="turn_on" if turn_on else "turn_off"
            command_loop = self.hass.loop.time()
            await self.hass.services.async_call(domain,service,{"entity_id":entity_id},blocking=True)
            self._response_pending_action = service
            self._response_log(
                "control_command",
                self._training_device or "",
                entity_id=entity_id,
                action=service,
                command_loop=command_loop,
            )

    async def async_reset_training(self, device_id: str):
        """Clear a training session without touching device commissioning."""
        if self._training_device == device_id:
            await self.async_stop_training(device_id)
        self.training_state.pop(device_id, None)
        self.training_samples.pop(device_id, None)
        await self._persist()

    async def async_stop_training(self, device_id:str):
        if self._direct_rpc_task and not self._direct_rpc_task.done():
            self._direct_rpc_task.cancel()
            try: await self._direct_rpc_task
            except asyncio.CancelledError: pass
        if self._training_task and not self._training_task.done():
            self._training_task.cancel()
            try: await self._training_task
            except asyncio.CancelledError: pass
        state=self.training_state.get(device_id)
        if state and state.get("status")=="active":
            state["status"]="stopped"
            state["instruction"]="Training stopped. No learned signature was saved."
            state["learned"] = False
        await self._persist()

    @callback
    def training_snapshot(self)->dict:
        return self.training_state

    async def _async_update_data(self)->dict:
        states=self.hass.states
        whole=states.get(self.power_entity)
        whole_power=None
        if whole is not None:
            try: whole_power=float(whole.state)
            except (TypeError,ValueError): pass
        return {"whole_home_power":whole_power,"entities":{e:states.get(e) for e in self.monitored_entities if states.get(e) is not None}}
