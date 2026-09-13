"""Multi-path electrical measurement engine for EnergyIQ."""
from __future__ import annotations

import asyncio
import json
import logging
import math
import statistics
import struct
import time
from collections import deque
from datetime import timedelta
from typing import Any

from homeassistant.components import mqtt
from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .const import CONF_HOST, DEFAULT_HOST

_LOGGER = logging.getLogger(__name__)
SOURCE_POLL_INTERVAL = 0.25
CALCULATION_INTERVAL = 0.025
REQUEST_TIMEOUT = 0.8
MODBUS_PORT = 502
MODBUS_UNIT = 1
MODBUS_TIMEOUT = 0.4
MODBUS_CANDIDATE_BASES = (32000, 2000, 1000, 31999, 1999, 999)


class InstrumentCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Acquire the same two EM1 channels through multiple transports."""

    def __init__(self, hass, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entry = entry
        self.host = str(entry.data.get(CONF_HOST, DEFAULT_HOST)).strip()
        self.samples: deque[tuple[float, float]] = deque(maxlen=1200)
        self._last_calc_time: float | None = None
        self._calc_intervals: deque[float] = deque(maxlen=600)
        self._last_success_time: float | None = None
        self._last_error: str | None = None
        self._poll_task: asyncio.Task | None = None
        self._calc_task: asyncio.Task | None = None
        self._modbus_task: asyncio.Task | None = None
        self._mqtt_unsubs: list[Any] = []
        self._modbus_reader: asyncio.StreamReader | None = None
        self._modbus_writer: asyncio.StreamWriter | None = None
        self._modbus_transaction = 0
        self._modbus_base: int | None = None
        self._session = async_get_clientsession(hass)
        self._sources: dict[str, dict[str, Any]] = {
            "http_aggregate": self._source_state(),
            "http_em1": self._source_state(),
            "mqtt": self._source_state(),
            "modbus": self._source_state(),
            "websocket": self._source_state(),
        }
        self._phase_power: dict[str, float | None] = {"0": None, "1": None, "2": None}
        self._calc_power: float | None = None
        self._source_values: dict[str, float | None] = {
            "http_aggregate": None,
            "http_em1": None,
            "mqtt": None,
            "modbus": None,
            "websocket": None,
        }
        self._source_phase_values: dict[str, dict[str, float | None]] = {}
        super().__init__(
            hass,
            logger=_LOGGER,
            name="energyiq_instrument",
            update_interval=timedelta(seconds=60),
        )

    @staticmethod
    def _source_state() -> dict[str, Any]:
        return {
            "updates": 0,
            "changes": 0,
            "duplicates": 0,
            "last_value": None,
            "last_update": None,
            "last_change": None,
            "change_intervals": deque(maxlen=120),
            "last_latency_ms": None,
            "errors": 0,
            "error": None,
        }

    async def async_config_entry_first_refresh(self) -> None:
        """Start all measurement paths and the independent 40 Hz calculator."""
        await self._subscribe_mqtt()
        await self._poll_sources()
        if self._poll_task is None or self._poll_task.done():
            self._poll_task = self.hass.async_create_task(self._poll_loop())
        if self._calc_task is None or self._calc_task.done():
            self._calc_task = self.hass.async_create_task(self._calculation_loop())
        if self._modbus_task is None or self._modbus_task.done():
            self._modbus_task = self.hass.async_create_task(self._modbus_loop())
        self.async_set_updated_data(self._snapshot())

    async def _poll_loop(self) -> None:
        while True:
            started = time.monotonic()
            try:
                await self._poll_sources()
            except asyncio.CancelledError:
                raise
            except Exception as err:
                self._record_source_error("http_aggregate", str(err))
                _LOGGER.exception("EnergyIQ multi-source HTTP loop error")
            elapsed = time.monotonic() - started
            await asyncio.sleep(max(0.0, SOURCE_POLL_INTERVAL - elapsed))

    async def _poll_sources(self) -> None:
        aggregate_task = self._get_json("Shelly.GetStatus")
        em1_tasks = [self._get_json("EM1.GetStatus", channel) for channel in (0, 1)]
        aggregate_result, em1_results = await asyncio.gather(
            aggregate_task,
            asyncio.gather(*em1_tasks, return_exceptions=True),
            return_exceptions=True,
        )
        now = time.monotonic()
        if isinstance(aggregate_result, Exception):
            self._record_source_error("http_aggregate", str(aggregate_result))
        else:
            phase_values = self._extract_payload_phases(aggregate_result)
            if phase_values:
                total = sum(v for v in phase_values.values() if v is not None)
                self._record_source("http_aggregate", total, now, None, phase_values)
        em_values: dict[str, float | None] = {"0": None, "1": None, "2": None}
        for channel, result in zip((0, 1), em1_results):
            if isinstance(result, Exception):
                self._record_source_error("http_em1", str(result))
                continue
            power = self._number(result.get("act_power")) if isinstance(result, dict) else None
            if power is not None:
                em_values[str(channel)] = power
        if em_values["0"] is not None or em_values["1"] is not None:
            total = sum(v for v in em_values.values() if v is not None)
            self._record_source("http_em1", total, now, None, em_values)

    async def _get_json(self, method: str, channel: int | None = None) -> dict[str, Any]:
        if channel is None:
            url = f"http://{self.host}/rpc/{method}"
        else:
            url = f"http://{self.host}/rpc/{method}?id={channel}"
        async with self._session.get(url, timeout=REQUEST_TIMEOUT) as response:
            response.raise_for_status()
            payload = await response.json(content_type=None)
        if not isinstance(payload, dict):
            raise ValueError(f"{method} returned a non-object")
        return payload

    async def _subscribe_mqtt(self) -> None:
        """Subscribe to the default Shelly MQTT status topics for both EM1 channels."""
        topic_prefix = self.entry.data.get("mqtt_topic_prefix")
        if not topic_prefix:
            try:
                info = await self._get_json("Shelly.GetDeviceInfo")
                topic_prefix = str(info.get("id") or "")
            except Exception as err:
                self._record_source_error("mqtt", f"device info: {err}")
                return
        if not topic_prefix:
            self._record_source_error("mqtt", "No MQTT topic prefix available")
            return
        for channel in (0, 1):
            topic = f"{topic_prefix}/status/em1:{channel}"
            try:
                unsub = await mqtt.async_subscribe(self.hass, topic, self._mqtt_message, qos=0)
                self._mqtt_unsubs.append(unsub)
            except Exception as err:
                self._record_source_error("mqtt", str(err))
                return
        self._sources["mqtt"]["topic_prefix"] = topic_prefix

    async def _mqtt_message(self, msg) -> None:
        try:
            payload = json.loads(msg.payload)
            if not isinstance(payload, dict):
                return
            channel = str(payload.get("id"))
            power = self._number(payload.get("act_power"))
            if channel not in ("0", "1") or power is None:
                return
            phase_values = dict(self._source_phase_values.get("mqtt", {"0": None, "1": None, "2": None}))
            phase_values[channel] = power
            total = sum(v for v in phase_values.values() if v is not None)
            self._record_source("mqtt", total, time.monotonic(), None, phase_values)
        except (json.JSONDecodeError, TypeError, ValueError) as err:
            self._record_source_error("mqtt", str(err))

    async def _modbus_loop(self) -> None:
        while True:
            try:
                await self._poll_modbus()
            except asyncio.CancelledError:
                raise
            except Exception as err:
                self._record_source_error("modbus", str(err))
                await self._close_modbus()
            await asyncio.sleep(0.05)

    async def _poll_modbus(self) -> None:
        started = time.monotonic()
        if self._modbus_reader is None or self._modbus_writer is None or self._modbus_writer.is_closing():
            self._modbus_reader, self._modbus_writer = await asyncio.wait_for(
                asyncio.open_connection(self.host, MODBUS_PORT), timeout=MODBUS_TIMEOUT
            )
        if self._modbus_base is None:
            for base in MODBUS_CANDIDATE_BASES:
                try:
                    regs = await self._modbus_read(base, 28)
                    ts = self._u32(regs[0:2])
                    if 1_500_000_000 < ts < time.time() + 86400:
                        self._modbus_base = base
                        break
                except Exception:
                    continue
            if self._modbus_base is None:
                raise RuntimeError("No valid Shelly EM1 Modbus register base found")
        regs = await self._modbus_read(self._modbus_base, 28)
        p0 = self._decode_float(regs[7:9])
        p1 = self._decode_float(regs[27:29])
        if p0 is None or p1 is None:
            raise ValueError("Invalid EM1 Modbus active-power registers")
        phase_values = {"0": p0, "1": p1, "2": None}
        self._record_source(
            "modbus",
            p0 + p1,
            time.monotonic(),
            (time.monotonic() - started) * 1000,
            phase_values,
        )

    async def _modbus_read(self, address: int, quantity: int) -> list[int]:
        if self._modbus_reader is None or self._modbus_writer is None:
            raise RuntimeError("Modbus connection unavailable")
        self._modbus_transaction = (self._modbus_transaction + 1) & 0xFFFF
        tid = self._modbus_transaction
        request = struct.pack(">HHHBBHH", tid, 0, 6, MODBUS_UNIT, 4, address, quantity)
        self._modbus_writer.write(request)
        await self._modbus_writer.drain()
        header = await asyncio.wait_for(self._modbus_reader.readexactly(9), timeout=MODBUS_TIMEOUT)
        r_tid, _, _, unit, function, byte_count = struct.unpack(">HHHBBB", header)
        if r_tid != tid or unit != MODBUS_UNIT:
            raise RuntimeError("Invalid Modbus response header")
        if function & 0x80:
            raise RuntimeError(f"Modbus exception code {byte_count}")
        if function != 4 or byte_count != quantity * 2:
            raise RuntimeError("Unexpected Modbus input-register response")
        body = await asyncio.wait_for(self._modbus_reader.readexactly(byte_count), timeout=MODBUS_TIMEOUT)
        return list(struct.unpack(">" + "H" * quantity, body))

    @staticmethod
    def _u32(words: list[int] | tuple[int, ...]) -> int:
        return (words[0] << 16) | words[1]

    @staticmethod
    def _decode_float(words: list[int] | tuple[int, ...]) -> float | None:
        if len(words) != 2:
            return None
        candidates = (
            struct.unpack(">f", struct.pack(">HH", words[0], words[1]))[0],
            struct.unpack(">f", struct.pack(">HH", words[1], words[0]))[0],
        )
        plausible = [v for v in candidates if math.isfinite(v) and abs(v) < 200000]
        return plausible[0] if plausible else None

    def _record_source(
        self,
        source: str,
        value: float,
        now: float,
        latency_ms: float | None,
        phase_values: dict[str, float | None],
    ) -> None:
        state = self._sources[source]
        state["updates"] += 1
        if state["last_value"] is None or value != state["last_value"]:
            state["changes"] += 1
            if state["last_change"] is not None:
                state["change_intervals"].append(now - state["last_change"])
            state["last_change"] = now
        else:
            state["duplicates"] += 1
        state["last_value"] = value
        state["last_update"] = now
        state["last_latency_ms"] = latency_ms
        state["error"] = None
        self._source_values[source] = value
        self._source_phase_values[source] = phase_values
        if source in ("http_em1", "mqtt", "modbus", "websocket"):
            for key, phase_value in phase_values.items():
                if phase_value is not None and key in self._phase_power:
                    self._phase_power[key] = phase_value
        self._last_success_time = now
        self._last_error = None

    def _record_source_error(self, source: str, message: str) -> None:
        state = self._sources[source]
        state["errors"] += 1
        state["error"] = message
        self._last_error = f"{source}: {message}"

    async def _calculation_loop(self) -> None:
        while True:
            started = time.monotonic()
            now = started
            if self._last_calc_time is not None:
                self._calc_intervals.append(now - self._last_calc_time)
            self._last_calc_time = now
            if self._phase_power["0"] is not None and self._phase_power["1"] is not None:
                self._calc_power = self._phase_power["0"] + self._phase_power["1"]
                self.samples.append((now, self._calc_power))
            self.async_set_updated_data(self._snapshot())
            elapsed = time.monotonic() - started
            await asyncio.sleep(max(0.0, CALCULATION_INTERVAL - elapsed))

    @staticmethod
    def _extract_payload_phases(payload: dict[str, Any]) -> dict[str, float | None]:
        values: dict[str, float | None] = {"0": None, "1": None, "2": None}
        for channel in range(3):
            item = payload.get(f"em1:{channel}")
            if isinstance(item, dict):
                values[str(channel)] = InstrumentCoordinator._number(item.get("act_power"))
        return values

    @staticmethod
    def _number(value: Any) -> float | None:
        try:
            number = float(value)
        except (TypeError, ValueError):
            return None
        return number if math.isfinite(number) else None

    def _snapshot(self) -> dict[str, Any]:
        values = [value for _, value in self.samples]
        calc_intervals = list(self._calc_intervals)
        now = time.monotonic()
        live = self._last_success_time is not None and now - self._last_success_time < 2.0
        return {
            "power_w": self._calc_power,
            "source": f"Shelly {self.host}",
            "host": self.host,
            "acquisition": "multi_path_diagnostic",
            "status": "LIVE" if live else ("ERROR" if self._last_error else "WAITING"),
            "calculation_rate_hz": 1.0 / statistics.median(calc_intervals) if calc_intervals else None,
            "calculation_interval_ms": statistics.median(calc_intervals) * 1000 if calc_intervals else None,
            "min_w": min(values) if values else None,
            "max_w": max(values) if values else None,
            "avg_w": statistics.fmean(values) if values else None,
            "phase_power_w": self._phase_power,
            "source_values_w": self._source_values,
            "sources": self._source_snapshot(),
            "modbus_base": self._modbus_base,
            "mqtt_topic_prefix": self._sources["mqtt"].get("topic_prefix"),
            "websocket_endpoint": f"/api/energyiq/shelly/ws/{self.entry.data.get('ws_token', '')}",
            "error": self._last_error,
        }

    def _source_snapshot(self) -> dict[str, Any]:
        result: dict[str, Any] = {}
        now = time.monotonic()
        for name, state in self._sources.items():
            result[name] = {
                "updates": state["updates"],
                "changes": state["changes"],
                "duplicates": state["duplicates"],
                "rate_hz": (1.0 / statistics.median(state["change_intervals"]) if state["change_intervals"] else None),
                "last_value": state["last_value"],
                "age_ms": (now - state["last_update"]) * 1000 if state.get("last_update") else None,
                "change_age_ms": (now - state["last_change"]) * 1000 if state.get("last_change") else None,
                "latency_ms": state.get("last_latency_ms"),
                "errors": state["errors"],
                "error": state.get("error"),
                "connected": state.get("connected"),
            }
        return result

    def ingest_websocket_status(self, payload: dict[str, Any]) -> None:
        """Accept a Shelly outbound-websocket status/RPC notification."""
        params = payload.get("params")
        status = params.get("status") if isinstance(params, dict) else None
        if not isinstance(status, dict):
            status = payload.get("status") if isinstance(payload.get("status"), dict) else None
        if not isinstance(status, dict):
            return
        phases = self._extract_payload_phases(status)
        usable = {k: v for k, v in phases.items() if v is not None and k in ("0", "1")}
        if len(usable) < 2:
            return
        self._record_source("websocket", sum(usable.values()), time.monotonic(), None, phases)
        self.async_set_updated_data(self._snapshot())

    async def _close_modbus(self) -> None:
        if self._modbus_writer is not None:
            self._modbus_writer.close()
            try:
                await self._modbus_writer.wait_closed()
            except Exception:
                pass
        self._modbus_reader = None
        self._modbus_writer = None

    async def async_shutdown(self) -> None:
        """Stop all acquisition paths cleanly."""
        for task in (self._poll_task, self._calc_task, self._modbus_task):
            if task and not task.done():
                task.cancel()
        for task in (self._poll_task, self._calc_task, self._modbus_task):
            if task:
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        for unsub in self._mqtt_unsubs:
            try:
                unsub()
            except Exception:
                pass
        self._mqtt_unsubs.clear()
        await self._close_modbus()
