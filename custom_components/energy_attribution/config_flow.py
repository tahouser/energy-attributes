"""Config flow for Energy Attribution."""
from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.entity import EntityCategory
from homeassistant.core import callback
from homeassistant.helpers import selector
from homeassistant.helpers.selector import SelectOptionDict, SelectSelector, SelectSelectorConfig, SelectSelectorMode

from .const import CONF_MONITORED_ENTITIES, CONF_POWER_ENTITY, DOMAIN

_LOGGER = logging.getLogger(__name__)

_POWER_CLASSES = {"power"}
_ENERGY_CLASSES = {"energy"}
_POWER_UNITS = {"W", "kW", "MW", "w", "kw", "mw"}
_ENERGY_UNITS = {"Wh", "kWh", "MWh", "GWh", "wh", "kwh", "mwh", "gwh"}

# These are normally derived/display-only energy sensors rather than a useful
# appliance measurement for attribution. Keep the real cumulative energy and
# live power sensors, not cost/tariff/difference/history derivatives.
_DERIVED_ENERGY_WORDS = {
    "difference", "saved", "cost", "price", "tariff", "rate", "forecast",
    "daily", "weekly", "monthly", "yearly", "yesterday", "today", "last",
}


def _state_class(hass, entity_id: str) -> str | None:
    state = hass.states.get(entity_id)
    if state is None:
        return None
    return state.attributes.get("state_class")


def _entity_name(hass, entry: er.RegistryEntry) -> str:
    state = hass.states.get(entry.entity_id)
    if state is not None:
        friendly = state.attributes.get("friendly_name")
        if friendly:
            return friendly
    return entry.name or entry.original_name or entry.entity_id


def _is_ignored_entity(entry: er.RegistryEntry) -> bool:
    return entry.disabled_by is not None or entry.entity_category in {
        EntityCategory.DIAGNOSTIC,
        EntityCategory.CONFIG,
    }


def _measurement_kind(hass, entry: er.RegistryEntry) -> str | None:
    """Return power/energy only for real electrical measurement entities."""
    if entry.domain != "sensor" or _is_ignored_entity(entry):
        return None

    state = hass.states.get(entry.entity_id)
    attrs = state.attributes if state is not None else {}
    device_class = entry.device_class or attrs.get("device_class")
    unit = entry.unit_of_measurement or attrs.get("unit_of_measurement")
    state_class = _state_class(hass, entry.entity_id)

    if device_class in _POWER_CLASSES and unit in _POWER_UNITS:
        if state_class in (None, "measurement"):
            return "power"

    if device_class in _ENERGY_CLASSES and unit in _ENERGY_UNITS:
        if state_class in (None, "total", "total_increasing"):
            words = set(_entity_name(hass, entry).casefold().replace("-", " ").split())
            if not words.intersection(_DERIVED_ENERGY_WORDS):
                return "energy"
    return None


def _is_battery_entity(hass, entry: er.RegistryEntry) -> bool:
    if entry.device_class == "battery":
        return True
    state = hass.states.get(entry.entity_id)
    return state is not None and state.attributes.get("device_class") == "battery"


def _build_candidates(hass, whole_home_entity: str | None = None) -> list[dict[str, Any]]:
    """Build a strict device-level list of electrical loads worth monitoring."""
    devices = dr.async_get(hass)
    entities = er.async_get(hass)
    areas = ar.async_get(hass)

    whole_home_entry = entities.async_get(whole_home_entity) if whole_home_entity else None
    whole_home_device_id = whole_home_entry.device_id if whole_home_entry else None

    by_device: dict[str, list[er.RegistryEntry]] = {}
    for entry in entities.entities.values():
        if entry.device_id:
            by_device.setdefault(entry.device_id, []).append(entry)

    candidates: list[dict[str, Any]] = []
    for device in devices.devices.values():
        # The selected whole-home meter is the aggregate source, not an
        # appliance candidate. Do not offer its device for attribution.
        if whole_home_device_id and device.id == whole_home_device_id:
            continue

        measurements: list[dict[str, str]] = []
        battery = False
        for entry in by_device.get(device.id, []):
            if _is_ignored_entity(entry):
                continue
            battery = battery or _is_battery_entity(hass, entry)
            kind = _measurement_kind(hass, entry)
            if kind:
                measurements.append({
                    "entity_id": entry.entity_id,
                    "name": _entity_name(hass, entry),
                    "kind": kind,
                    "unit": entry.unit_of_measurement or "",
                })

        # v0.3 intentionally requires direct power/energy evidence. This is
        # the main filter that prevents motion sensors, switches, remotes,
        # thermostats without measurement, and other non-load devices from
        # entering the commissioning environment.
        if not measurements:
            continue

        # A battery flag does not disqualify a device if it also has a real
        # electrical measurement; it is common for hybrid devices to expose
        # both battery and power/energy entities.
        area_entry = areas.async_get_area(device.area_id) if device.area_id else None
        area_name = area_entry.name if area_entry else ""
        name = device.name_by_user or device.name or "Unnamed device"
        power_count = sum(m["kind"] == "power" for m in measurements)
        energy_count = sum(m["kind"] == "energy" for m in measurements)

        candidates.append({
            "device_id": device.id,
            "name": name,
            "area": area_name,
            "manufacturer": device.manufacturer or "",
            "model": device.model or "",
            "area_id": device.area_id or "",
            "parent_device_id": getattr(device, "parent_device_id", None),
            "measurements": measurements,
            "battery": battery,
            "power_count": power_count,
            "energy_count": energy_count,
        })

    candidates.sort(key=lambda c: (c["area"].casefold(), c["name"].casefold()))
    return candidates


def _candidate_options(candidates: list[dict[str, Any]]) -> list[SelectOptionDict]:
    options: list[SelectOptionDict] = []
    for candidate in candidates:
        evidence = []
        if candidate["power_count"]:
            evidence.append(f"{candidate['power_count']} power")
        if candidate["energy_count"]:
            evidence.append(f"{candidate['energy_count']} energy")
        area = f" · {candidate['area']}" if candidate["area"] else ""
        options.append(
            SelectOptionDict(
                value=candidate["device_id"],
                label=f"{candidate['name']}{area} — {', '.join(evidence)}",
            )
        )
    return options


def _monitored_entities(candidates: list[dict[str, Any]], selected: set[str]) -> list[str]:
    return [
        measurement["entity_id"]
        for candidate in candidates
        if candidate["device_id"] in selected
        for measurement in candidate["measurements"]
    ]


def _device_data(candidates: list[dict[str, Any]], selected: set[str]) -> dict[str, dict[str, Any]]:
    return {
        candidate["device_id"]: {
            "name": candidate["name"],
            "area": candidate["area"],
            "manufacturer": candidate["manufacturer"],
            "model": candidate["model"],
            "measurements": candidate["measurements"],
            "classification": "monitor" if candidate["device_id"] in selected else "ignore",
        }
        for candidate in candidates
    }


class ConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle initial setup and bulk commissioning of Energy Attribution."""

    VERSION = 3

    def __init__(self) -> None:
        self._power_entity: str | None = None
        self._candidates: list[dict[str, Any]] = []

    async def async_step_user(self, user_input=None):
        """Select the whole-home power sensor, then build our own load list."""
        if user_input is not None:
            self._power_entity = user_input[CONF_POWER_ENTITY]
            self._candidates = _build_candidates(self.hass, self._power_entity)
            if not self._candidates:
                return self.async_abort(reason="no_candidates")
            return await self.async_step_commission()

        schema = vol.Schema({
            vol.Required(CONF_POWER_ENTITY): selector.EntitySelector(
                selector.EntitySelectorConfig(domain="sensor", device_class="power", multiple=False)
            )
        })
        return self.async_show_form(step_id="user", data_schema=schema)

    async def async_step_commission(self, user_input=None):
        """Bulk review: every filtered candidate is adopted and preselected."""
        all_ids = [candidate["device_id"] for candidate in self._candidates]
        if user_input is not None:
            selected = set(user_input.get("monitored_devices", []))
            monitored = _monitored_entities(self._candidates, selected)
            return self.async_create_entry(
                title="Energy Attribution",
                data={
                    CONF_POWER_ENTITY: self._power_entity,
                    CONF_MONITORED_ENTITIES: monitored,
                    "device_classifications": {
                        candidate["device_id"]: "monitor" if candidate["device_id"] in selected else "ignore"
                        for candidate in self._candidates
                    },
                    "commissioned_devices": _device_data(self._candidates, selected),
                },
            )

        schema = vol.Schema({
            vol.Required("monitored_devices", default=all_ids): SelectSelector(
                SelectSelectorConfig(
                    options=_candidate_options(self._candidates),
                    multiple=True,
                    mode=SelectSelectorMode.LIST,
                )
            )
        })
        return self.async_show_form(
            step_id="commission",
            data_schema=schema,
            description_placeholders={
                "count": str(len(self._candidates)),
                "selected": str(len(all_ids)),
            },
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return OptionsFlowHandler()


class OptionsFlowHandler(config_entries.OptionsFlowWithReload):
    """Reopen the same bulk commissioning interface after setup."""

    async def async_step_init(self, user_input=None):
        candidates = _build_candidates(self.hass, self.config_entry.data.get(CONF_POWER_ENTITY))
        if not candidates:
            return self.async_abort(reason="no_candidates")

        saved = set(self.config_entry.data.get(CONF_MONITORED_ENTITIES, []))
        default_devices = [
            candidate["device_id"]
            for candidate in candidates
            if any(m["entity_id"] in saved for m in candidate["measurements"])
        ]

        if user_input is not None:
            selected = set(user_input.get("monitored_devices", []))
            return self.async_create_entry(
                title="",
                data={
                    CONF_MONITORED_ENTITIES: _monitored_entities(candidates, selected),
                    "device_classifications": {
                        candidate["device_id"]: "monitor" if candidate["device_id"] in selected else "ignore"
                        for candidate in candidates
                    },
                    "commissioned_devices": _device_data(candidates, selected),
                },
            )

        schema = vol.Schema({
            vol.Required("monitored_devices", default=default_devices): SelectSelector(
                SelectSelectorConfig(
                    options=_candidate_options(candidates),
                    multiple=True,
                    mode=SelectSelectorMode.LIST,
                )
            )
        })
        return self.async_show_form(
            step_id="init",
            data_schema=schema,
            description_placeholders={"count": str(len(candidates))},
        )
