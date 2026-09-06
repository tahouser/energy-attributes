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
from homeassistant.helpers import selector

from .const import CONF_MONITORED_ENTITIES, CONF_POWER_ENTITY, DOMAIN

_LOGGER = logging.getLogger(__name__)

_CLASSIFICATION_MONITOR = "monitor"
_CLASSIFICATION_IGNORE = "ignore"
_CLASSIFICATION_REVIEW = "review"

_POWER_CLASSES = {"power"}
_ENERGY_CLASSES = {"energy"}
_POWER_UNITS = {"W", "kW", "MW", "w", "kw", "mw"}
_ENERGY_UNITS = {"Wh", "kWh", "MWh", "GWh", "wh", "kwh", "mwh", "gwh"}

_CONTROL_DOMAINS = {"switch", "light", "fan", "climate", "humidifier", "cover", "media_player"}
_ENVIRONMENTAL_CLASSES = {
    "temperature", "humidity", "illuminance", "motion", "door", "window",
    "occupancy", "presence", "moisture", "pressure", "carbon_dioxide",
    "carbon_monoxide", "gas", "pm25", "volatile_organic_compounds",
    "signal_strength", "battery",
}


def _state_class(hass, entity_id: str) -> str | None:
    """Read state_class from the live state; it is not entity-registry metadata."""
    state = hass.states.get(entity_id)
    if state is None:
        return None
    return state.attributes.get("state_class")


def _measurement_kind(hass, entry: er.RegistryEntry) -> str | None:
    """Return power/energy for a genuine electrical measurement."""
    if entry.domain != "sensor" or entry.entity_category is not None:
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
            return "energy"
    return None


def _is_battery_entity(hass, entry: er.RegistryEntry) -> bool:
    """Detect battery evidence from registry or current state."""
    if entry.device_class == "battery":
        return True
    state = hass.states.get(entry.entity_id)
    return state is not None and state.attributes.get("device_class") == "battery"


def _is_ignored_entity(entry: er.RegistryEntry) -> bool:
    """Exclude diagnostic/configuration entities from load discovery."""
    return entry.disabled_by is not None or entry.entity_category in {
        EntityCategory.DIAGNOSTIC,
        EntityCategory.CONFIG,
    }


def _entity_name(hass, entry: er.RegistryEntry) -> str:
    state = hass.states.get(entry.entity_id)
    if state is not None:
        friendly = state.attributes.get("friendly_name")
        if friendly:
            return friendly
    return entry.name or entry.original_name or entry.entity_id


def _build_candidates(hass) -> list[dict[str, Any]]:
    """Build one commissioning candidate per relevant HA device."""
    devices = dr.async_get(hass)
    entities = er.async_get(hass)
    areas = ar.async_get(hass)
    by_device: dict[str, list[er.RegistryEntry]] = {}
    for entry in entities.entities.values():
        if entry.device_id:
            by_device.setdefault(entry.device_id, []).append(entry)

    candidates: list[dict[str, Any]] = []
    for device in devices.devices.values():
        dev_entities = by_device.get(device.id, [])
        if not dev_entities:
            continue

        measurements: list[dict[str, str]] = []
        battery = False
        controls: list[str] = []
        useful_other = False
        for entry in dev_entities:
            if _is_ignored_entity(entry):
                continue
            if _is_battery_entity(hass, entry):
                battery = True
            kind = _measurement_kind(hass, entry)
            if kind:
                measurements.append({
                    "entity_id": entry.entity_id,
                    "name": _entity_name(hass, entry),
                    "kind": kind,
                    "unit": entry.unit_of_measurement or "",
                })
                continue
            if entry.domain in _CONTROL_DOMAINS:
                controls.append(entry.domain)
            elif entry.domain == "sensor" and entry.device_class not in _ENVIRONMENTAL_CLASSES:
                useful_other = True

        controls = sorted(set(controls))
        # Primary discovery: every device with a real electrical measurement.
        # Secondary candidates: controllable devices with no measurement, but only
        # when they are not clearly battery/environmental-only.
        if not measurements and not controls and not useful_other:
            continue
        if battery and not measurements and not useful_other:
            # Battery-powered controls/sensors are not primary household-load candidates.
            continue

        score = 0
        reasons: list[str] = []
        if measurements:
            score += 100
            reasons.append(f"{len(measurements)} electrical measurement(s)")
            if any(m["kind"] == "power" for m in measurements):
                score += 20
                reasons.append("power measurement available")
            if any(m["kind"] == "energy" for m in measurements):
                score += 15
                reasons.append("energy measurement available")
        elif controls:
            score += 15
            reasons.append("controllable entity present, but no direct power/energy measurement")
        else:
            score += 5
            reasons.append("non-environmental sensor present, but no direct power/energy measurement")
        if battery:
            score -= 80
            reasons.append("battery evidence found")

        area_name = areas.async_get_area(device.area_id).name if device.area_id and areas.async_get_area(device.area_id) else ""
        name = device.name_by_user or device.name or "Unnamed device"
        candidates.append({
            "device_id": device.id,
            "name": name,
            "area": area_name,
            "manufacturer": device.manufacturer or "",
            "model": device.model or "",
            "area_id": device.area_id or "",
            "parent_device_id": getattr(device, "parent_device_id", None),
            "score": score,
            "reasons": reasons,
            "measurements": measurements,
            "battery": battery,
            "controls": controls,
        })

    # Measurements first; unmeasured controls after them. Within each group,
    # stronger evidence first and then a stable alphabetical order.
    candidates.sort(key=lambda c: (0 if c["measurements"] else 1, -c["score"], c["name"].casefold()))
    return candidates


class ConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle configuration of Energy Attribution."""

    VERSION = 2

    def __init__(self) -> None:
        self._power_entity: str | None = None
        self._candidates: list[dict[str, Any]] = []
        self._decisions: dict[str, str] = {}
        self._index = 0

    async def async_step_user(self, user_input=None):
        """Select the whole-home power entity."""
        if user_input is not None:
            self._power_entity = user_input[CONF_POWER_ENTITY]
            self._candidates = _build_candidates(self.hass)
            self._index = 0
            return await self.async_step_commission()
        schema = vol.Schema({
            vol.Required(CONF_POWER_ENTITY): selector.EntitySelector(
                selector.EntitySelectorConfig(domain="sensor", device_class="power", multiple=False)
            )
        })
        return self.async_show_form(step_id="user", data_schema=schema)

    async def async_step_commission(self, user_input=None):
        """Review one discovered candidate at a time."""
        if self._index >= len(self._candidates):
            return self._finish_entry()
        candidate = self._candidates[self._index]
        if user_input is not None:
            self._decisions[candidate["device_id"]] = user_input["classification"]
            self._index += 1
            return await self.async_step_commission()

        schema = vol.Schema({
            vol.Required("classification", default=_CLASSIFICATION_MONITOR): selector.SelectSelector(
                selector.SelectSelectorConfig(
                    options=[
                        {"value": _CLASSIFICATION_MONITOR, "label": "Monitor"},
                        {"value": _CLASSIFICATION_IGNORE, "label": "Ignore / not an electrical load"},
                        {"value": _CLASSIFICATION_REVIEW, "label": "Review later"},
                    ], mode=selector.SelectSelectorMode.DROPDOWN,
                )
            )
        })
        return self.async_show_form(
            step_id="commission", data_schema=schema,
            description_placeholders={
                "device_name": candidate["name"],
                "progress": f"{self._index + 1} of {len(self._candidates)}",
                "details": self._candidate_description(candidate),
            },
        )

    def _candidate_description(self, candidate: dict[str, Any]) -> str:
        lines = []
        if candidate["area"]:
            lines.append(f"Area: {candidate['area']}")
        if candidate["manufacturer"] or candidate["model"]:
            lines.append("Model: " + " ".join(x for x in [candidate["manufacturer"], candidate["model"]] if x))
        lines.append("Evidence: " + "; ".join(candidate["reasons"]))
        for m in candidate["measurements"]:
            lines.append(f"• {m['kind'].title()}: {m['name']} ({m['unit']})")
        if candidate["controls"]:
            lines.append("Controls: " + ", ".join(candidate["controls"]))
        if not candidate["measurements"]:
            lines.append("No direct power/energy measurement was found; this is a review candidate only.")
        return "\n".join(lines)

    def _finish_entry(self):
        monitored_entities = [
            measurement["entity_id"]
            for candidate in self._candidates
            if self._decisions.get(candidate["device_id"]) == _CLASSIFICATION_MONITOR
            for measurement in candidate["measurements"]
        ]
        return self.async_create_entry(
            title="Energy Attribution",
            data={
                CONF_POWER_ENTITY: self._power_entity,
                CONF_MONITORED_ENTITIES: monitored_entities,
                "device_classifications": self._decisions,
                "commissioned_devices": {
                    candidate["device_id"]: {
                        "name": candidate["name"],
                        "area": candidate["area"],
                        "manufacturer": candidate["manufacturer"],
                        "model": candidate["model"],
                        "measurements": candidate["measurements"],
                        "classification": self._decisions.get(candidate["device_id"], _CLASSIFICATION_REVIEW),
                    }
                    for candidate in self._candidates
                },
            },
        )
