"""Coordinator and live training manager for Energy Attribution."""
from __future__ import annotations

import asyncio
import logging
from datetime import timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.storage import Store
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .const import CONF_MONITORED_ENTITIES, CONF_POWER_ENTITY, DOMAIN
from .training import TrainingEngine

_LOGGER=logging.getLogger(__name__)

class EnergyAttributionCoordinator(DataUpdateCoordinator[dict]):
    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.entry=entry
        self.power_entity=entry.data[CONF_POWER_ENTITY]
        self.monitored_entities=entry.options.get(CONF_MONITORED_ENTITIES, entry.data.get(CONF_MONITORED_ENTITIES, []))
        self.device_classifications=entry.options.get("device_classifications", entry.data.get("device_classifications", {}))
        self.commissioned_devices=entry.options.get("commissioned_devices", entry.data.get("commissioned_devices", {}))
        self.candidate_devices=entry.options.get("candidate_devices", entry.data.get("candidate_devices", {}))
        self.training_state=entry.options.get("training_state", entry.data.get("training_state", {}))
        self.training_samples=entry.options.get("training_samples", entry.data.get("training_samples", {}))
        self._store=Store(hass, 1, f"{DOMAIN}.training.{entry.entry_id}", private=True)
        self._training_engine: TrainingEngine|None=None
        self._training_device: str|None=None
        self.last_training_device_id: str|None=None
        self._training_task: asyncio.Task|None=None
        self._training_lock=asyncio.Lock()
        self._last_persist=0.0
        super().__init__(hass, logger=_LOGGER, name="energy_attribution", update_interval=timedelta(seconds=2))

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

    async def async_start_training(self, device_id:str, method:str) -> dict:
        async with self._training_lock:
            if self._training_task and not self._training_task.done():
                raise RuntimeError("Another training session is already active")
            if method=="quick":
                engine=TrainingEngine("quick")
            else:
                engine=TrainingEngine("full_cycle")
            candidate=self.candidate_devices.get(device_id,{})
            state={"status":"active","phase":"baseline","method":method,"device_id":device_id,
                   "device_name":candidate.get("name",device_id),"area":candidate.get("area",""),
                   "started_at":self.hass.loop.time(),"baseline_w":None,"peak_delta_w":None,
                   "events_detected":0,"result":None,"learned":False}
            self.training_state[device_id]=state
            self._training_engine=engine
            self._training_device=device_id
            self.last_training_device_id=device_id
            await self._persist(force=True)
            self._training_task=self.hass.async_create_task(self._training_loop(device_id,method))
            return state

    async def _training_loop(self, device_id: str, method: str):
        try:
            controls = self._auto_control_entities(device_id)
            if method == "quick" and not controls:
                raise RuntimeError("This device has no known controllable entity for Quick ON/OFF training.")
            control_state = "off"
            while self._training_engine and self._training_device == device_id:
                whole = self.hass.states.get(self.power_entity)
                try:
                    watts = float(whole.state) if whole else None
                except (TypeError, ValueError):
                    watts = None
                if watts is not None:
                    result = self._training_engine.add_sample(self.hass.loop.time(), watts)
                    state = self.training_state[device_id]
                    state.update({k: result.get(k) for k in ("phase", "baseline_w", "peak_delta_w", "events_detected", "duration_s", "energy_wh", "cycles_required", "cycles_completed")})
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
                        state["instruction"] = "Training Complete. Three controlled measurements were captured and saved."
                        state["learned"] = True
                        state["completed_at"] = self.hass.loop.time()
                        self.last_training_device_id = device_id
                        state["completed"] = True
                        state["learned_signature"] = {
                            "method": method, "baseline_w": result.get("baseline_w"), "load_w": result.get("peak_delta_w"),
                            "duration_s": result.get("duration_s"), "energy_wh": result.get("energy_wh"),
                            "events_detected": result.get("events_detected", 0), "observations": result.get("observations", []),
                        }
                        await self._persist(force=True)
                        return
                    await self._persist()
                await asyncio.sleep(0.5)
        except asyncio.CancelledError:
            raise
        except Exception as err:
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
            await self.hass.services.async_call(domain,service,{"entity_id":entity_id},blocking=True)

    async def async_reset_training(self, device_id: str):
        """Clear a training session without touching device commissioning."""
        if self._training_device == device_id:
            await self.async_stop_training(device_id)
        self.training_state.pop(device_id, None)
        self.training_samples.pop(device_id, None)
        await self._persist()

    async def async_stop_training(self, device_id:str):
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
