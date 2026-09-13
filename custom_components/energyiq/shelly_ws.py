"""Receiver for a Shelly Pro 3EM outbound WebSocket connection."""
from __future__ import annotations

import json
import logging

from aiohttp import WSMsgType, web
from homeassistant.components.http import HomeAssistantView, KEY_HASS
from homeassistant.core import HomeAssistant

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


class ShellyOutboundWebsocketView(HomeAssistantView):
    """Accept Shelly outbound RPC/status traffic on a tokenized endpoint."""

    url = "/api/energyiq/shelly/ws/{token}"
    name = "api:energyiq:shelly_ws"
    requires_auth = False

    async def get(self, request: web.Request, token: str) -> web.WebSocketResponse:
        """Handle a Shelly outbound WebSocket connection."""
        coordinator = self._coordinator(request.app[KEY_HASS])
        if coordinator is None or token != coordinator.entry.data.get("ws_token"):
            raise web.HTTPNotFound()

        ws = web.WebSocketResponse(heartbeat=30)
        await ws.prepare(request)
        _LOGGER.info("EnergyIQ Shelly outbound WebSocket connected from %s", request.remote)
        coordinator._sources["websocket"]["connected"] = True
        coordinator.async_set_updated_data(coordinator._snapshot())
        try:
            async for message in ws:
                if message.type == WSMsgType.TEXT:
                    try:
                        payload = json.loads(message.data)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(payload, dict):
                        coordinator.ingest_websocket_status(payload)
                elif message.type == WSMsgType.ERROR:
                    _LOGGER.warning("EnergyIQ Shelly WebSocket error: %s", ws.exception())
                    break
        finally:
            coordinator._sources["websocket"]["connected"] = False
            coordinator.async_set_updated_data(coordinator._snapshot())
            _LOGGER.info("EnergyIQ Shelly outbound WebSocket disconnected")
        return ws

    @staticmethod
    def _coordinator(hass: HomeAssistant):
        return next(
            (
                value
                for value in hass.data.get(DOMAIN, {}).values()
                if hasattr(value, "entry") and hasattr(value, "ingest_websocket_status")
            ),
            None,
        )


def async_register(hass: HomeAssistant) -> None:
    """Register the Shelly outbound WebSocket receiver."""
    hass.http.register_view(ShellyOutboundWebsocketView())
