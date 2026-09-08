"""WebSocket controls for supervised EnergyIQ long-cycle training."""
from __future__ import annotations

import asyncio
import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .websocket import _coordinator


def _save_completed_signature(coordinator, device_id: str, result: dict) -> None:
    state = coordinator.training_state.get(device_id, {})
    state.update({
        "status": "complete",
        "phase": "complete",
        "result": result,
        "baseline_w": result.get("baseline_w"),
        "peak_delta_w": result.get("peak_delta_w"),
        "events_detected": result.get("events_detected", 0),
        "duration_s": result.get("duration_s"),
        "energy_wh": result.get("energy_wh"),
        "learned": True,
        "completed": True,
        "completed_at": coordinator.hass.loop.time(),
        "instruction": "Training Complete. The complete user-confirmed long-cycle footprint was captured and saved.",
    })
    coordinator.last_training_device_id = device_id
    state["learned_signature"] = {
        "method": "full_cycle",
        "baseline_w": result.get("baseline_w"),
        "load_w": result.get("peak_delta_w"),
        "duration_s": result.get("duration_s"),
        "energy_wh": result.get("energy_wh"),
        "events_detected": result.get("events_detected", 0),
        "observations": result.get("observations", []),
        "long_cycle": True,
    }


@websocket_api.websocket_command({
    vol.Required("type"): "energy_attribution/confirm_long_cycle",
    vol.Required("entry_id"): str,
    vol.Required("device_id"): str,
    vol.Required("accepted"): bool,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_confirm_long_cycle(hass: HomeAssistant, connection, msg):
    coordinator = _coordinator(hass, msg["entry_id"])
    device_id = msg["device_id"]
    if coordinator._training_device != device_id or coordinator._training_engine is None:
        raise ValueError("No active long-cycle training session for this device")
    if coordinator._training_engine.method != "full_cycle":
        raise ValueError("The active training session is not Long Cycle")
    result = coordinator._training_engine.confirm_full_cycle(msg["accepted"], hass.loop.time())
    state = coordinator.training_state.get(device_id, {})
    state.update({"phase": result.get("phase"), "result": result})
    if msg["accepted"]:
        state["instruction"] = "Load confirmed. Monitoring the complete cycle. Press END TRAINING only after the equipment has finished."
    else:
        state["instruction"] = "Event rejected. Waiting for the selected load to begin."
    await coordinator._persist(force=True)
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command({
    vol.Required("type"): "energy_attribution/end_long_cycle",
    vol.Required("entry_id"): str,
    vol.Required("device_id"): str,
    vol.Optional("force", default=False): bool,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_end_long_cycle(hass: HomeAssistant, connection, msg):
    coordinator = _coordinator(hass, msg["entry_id"])
    device_id = msg["device_id"]
    if coordinator._training_device != device_id or coordinator._training_engine is None:
        raise ValueError("No active long-cycle training session for this device")
    if coordinator._training_engine.method != "full_cycle":
        raise ValueError("The active training session is not Long Cycle")
    result = coordinator._training_engine.end_full_cycle(force=msg["force"])
    if result.get("action") == "end_warning":
        state = coordinator.training_state.get(device_id, {})
        state.update({"phase": result.get("phase"), "result": result})
        state["instruction"] = "The load may still be active or the cycle is too short. Confirm END anyway only if the equipment has actually finished."
        await coordinator._persist(force=True)
        connection.send_result(msg["id"], result)
        return
    if result.get("completed"):
        _save_completed_signature(coordinator, device_id, result)
        coordinator._response_log(
            "training_complete",
            device_id,
            learned_load_w=result.get("peak_delta_w"),
            measurement_source="shelly_rpc" if coordinator._direct_rpc_available else "ha_entity",
            shelly_host=coordinator._direct_rpc_host or "",
            training_method="full_cycle",
        )
        if coordinator._training_task and not coordinator._training_task.done():
            coordinator._training_task.cancel()
            try:
                await coordinator._training_task
            except asyncio.CancelledError:
                pass
        if coordinator._direct_rpc_task and not coordinator._direct_rpc_task.done():
            coordinator._direct_rpc_task.cancel()
            try:
                await coordinator._direct_rpc_task
            except asyncio.CancelledError:
                pass
        coordinator._training_task = None
        coordinator._training_device = None
        await coordinator._persist(force=True)
    connection.send_result(msg["id"], result)


async def async_register(hass: HomeAssistant) -> None:
    for handler in (ws_confirm_long_cycle, ws_end_long_cycle):
        websocket_api.async_register_command(hass, handler)
