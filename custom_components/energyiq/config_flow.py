"""Config flow for EnergyIQ."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.entity import EntityCategory
from homeassistant.core import callback
from homeassistant.util import dt as dt_util
from homeassistant.helpers import selector
from homeassistant.helpers.selector import BooleanSelector
from homeassistant.helpers.selector import SelectOptionDict, SelectSelector, SelectSelectorConfig, SelectSelectorMode

from .const import CONF_MONITORED_ENTITIES, CONF_POWER_ENTITY, DOMAIN, TRAINING_SESSION

_LOGGER = logging.getLogger(__name__)

_POWER_CLASSES = {"power"}
_ENERGY_CLASSES = {"energy"}
_POWER_UNITS = {"W", "kW", "MW", "w", "kw", "mw"}
_ENERGY_UNITS = {"Wh", "kWh", "MWh", "GWh", "wh", "kwh", "mwh", "gwh"}

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


def _is_load_control(hass, entry: er.RegistryEntry) -> bool:
    """Return True when an entity is plausibly an electrical load control.

    Keep the first-pass inventory broad enough to catch real loads that do not
    expose a power sensor, but do not treat every HA entity as a load. Domains
    such as media_player are checked for actual power capability rather than
    being accepted solely because the domain exists.
    """
    if _is_ignored_entity(entry):
        return False

    strong_domains = {
        "light", "switch", "fan", "climate", "humidifier", "water_heater",
    }
    if entry.domain in strong_domains:
        return True

    state = hass.states.get(entry.entity_id)
    supported = int(state.attributes.get("supported_features", 0)) if state else int(entry.supported_features or 0)

    if entry.domain == "media_player":
        # HA exposes turn_on/turn_off as MediaPlayerEntityFeature flags.
        from homeassistant.components.media_player import MediaPlayerEntityFeature
        required = int(MediaPlayerEntityFeature.TURN_ON | MediaPlayerEntityFeature.TURN_OFF)
        return (supported & required) == required

    if entry.domain == "vacuum":
        # A vacuum is a genuine electrical load even though its control API is
        # start/stop rather than generic turn_on/turn_off.
        from homeassistant.components.vacuum import VacuumEntityFeature
        required = int(VacuumEntityFeature.START | VacuumEntityFeature.STOP)
        return (supported & required) == required

    if entry.domain == "cover":
        # Motorized shades/doors are also electrical loads. They are included
        # for commissioning/manual training even when Auto Quick cannot yet
        # operate them through the generic power service.
        from homeassistant.components.cover import CoverEntityFeature
        required = int(CoverEntityFeature.OPEN | CoverEntityFeature.CLOSE)
        return (supported & required) == required

    return False


def _build_candidates(hass, whole_home_entity: str | None = None) -> list[dict[str, Any]]:
    """Build the EnergyIQ device environment.

    Candidate evidence comes from either a real power/energy measurement or a
    load-like entity with meaningful control capability. This is intentionally
    broader than the old fixed switch/light filter, while still excluding
    generic helpers, diagnostics and environmental-only entities.
    """
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
    browser_mod_config_entry_ids = {entry.entry_id for entry in hass.config_entries.async_entries("browser_mod")}
    all_devices = [*devices.devices, *devices.child_devices]
    _LOGGER.debug(
        "EnergyIQ device registry inventory: %d main + %d child devices",
        len(devices.devices), len(devices.child_devices),
    )

    for device in all_devices:
        if set(device.config_entries) & browser_mod_config_entry_ids:
            continue
        device_name = " ".join(
            str(value or "") for value in (
                device.name_by_user, device.name, device.manufacturer, device.model
            )
        ).casefold()
        if "shelly" in device_name and "energy meter" in device_name:
            continue

        if whole_home_device_id:
            whole_home_parent_id = getattr(whole_home_entry, "parent_device_id", None) if whole_home_entry else None
            device_parent_id = getattr(device, "parent_device_id", None)
            if (
                device.id == whole_home_device_id
                or device_parent_id == whole_home_device_id
                or (whole_home_parent_id and (
                    device.id == whole_home_parent_id
                    or device_parent_id == whole_home_parent_id
                ))
            ):
                continue

        measurements: list[dict[str, str]] = []
        controls: list[dict[str, str]] = []
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

            if _is_load_control(hass, entry):
                controls.append({
                    "entity_id": entry.entity_id,
                    "name": _entity_name(hass, entry),
                    "domain": entry.domain,
                })

        if not measurements and not controls:
            continue

        if not measurements and battery and not controls:
            continue

        area_entry = areas.async_get_area(device.area_id) if device.area_id else None
        area_name = area_entry.name if area_entry else ""
        name = device.name_by_user or device.name or "Unnamed device"
        power_count = sum(m["kind"] == "power" for m in measurements)
        energy_count = sum(m["kind"] == "energy" for m in measurements)

        evidence = []
        if measurements:
            if power_count:
                evidence.append(f"{power_count} power")
            if energy_count:
                evidence.append(f"{energy_count} energy")
        if controls:
            domains = sorted({c["domain"] for c in controls})
            evidence.append("control: " + ", ".join(domains))

        candidates.append({
            "device_id": device.id,
            "name": name,
            "area": area_name,
            "manufacturer": device.manufacturer or "",
            "model": device.model or "",
            "area_id": device.area_id or "",
            "parent_device_id": getattr(device, "parent_device_id", None),
            "measurements": measurements,
            "controls": controls,
            "battery": battery,
            "power_count": power_count,
            "energy_count": energy_count,
            "evidence": "; ".join(evidence),
        })

    candidates.sort(
        key=lambda c: (
            0 if c["measurements"] else 1,
            c["area"].casefold(),
            c["name"].casefold(),
        )
    )
    return candidates


def _candidate_options(candidates: list[dict[str, Any]]) -> list[SelectOptionDict]:
    """Create readable bulk-selection options."""
    options: list[SelectOptionDict] = []
    for candidate in candidates:
        area = f" · {candidate['area']}" if candidate["area"] else ""
        evidence = candidate.get("evidence") or "load-style device"
        options.append(
            SelectOptionDict(
                value=candidate["device_id"],
                label=f"{candidate['name']}{area} — {evidence}",
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
    """Initial setup only: choose the aggregate meter and create the entry."""

    VERSION = 4

    def __init__(self) -> None:
        self._power_entity: str | None = None
        self._candidates: list[dict[str, Any]] = []

    async def async_step_user(self, user_input=None):
        """Select the whole-home power sensor; commissioning happens later."""
        if user_input is not None:
            self._power_entity = user_input[CONF_POWER_ENTITY]
            self._candidates = _build_candidates(self.hass, self._power_entity)

            return self.async_create_entry(
                title="EnergyIQ",
                data={
                    CONF_POWER_ENTITY: self._power_entity,
                    "candidate_devices": {c["device_id"]: c for c in self._candidates},
                    CONF_MONITORED_ENTITIES: [],
                    "device_classifications": {},
                    "commissioned_devices": {},
                },
            )

        schema = vol.Schema({
            vol.Required(CONF_POWER_ENTITY): selector.EntitySelector(
                selector.EntitySelectorConfig(
                    domain="sensor",
                    device_class="power",
                    multiple=False,
                )
            )
        })
        return self.async_show_form(step_id="user", data_schema=schema)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return OptionsFlowHandler()


class OptionsFlowHandler(config_entries.OptionsFlowWithReload):
    """Persistent commissioning workspace."""

    async def async_step_init(self, user_input=None):
        candidates = _build_candidates(
            self.hass, self.config_entry.data.get(CONF_POWER_ENTITY)
        )
        if not candidates:
            return self.async_abort(reason="no_candidates")

        current = dict(self.config_entry.options.get(
            "device_classifications",
            self.config_entry.data.get("device_classifications", {}),
        ))
        selected_default = [
            c["device_id"] for c in candidates
            if current.get(c["device_id"], "monitor") == "monitor"
        ]

        if user_input is not None:
            selected = set(user_input.get("monitored_devices", []))
            classifications = {
                c["device_id"]: ("monitor" if c["device_id"] in selected else "ignore")
                for c in candidates
            }
            return self.async_create_entry(data={
                CONF_MONITORED_ENTITIES: _monitored_entities(candidates, selected),
                "device_classifications": classifications,
                "candidate_devices": {c["device_id"]: c for c in candidates},
            })

        schema = vol.Schema({
            vol.Required("monitored_devices", default=selected_default): SelectSelector(
                SelectSelectorConfig(
                    options=_candidate_options(candidates),
                    multiple=True,
                    mode=SelectSelectorMode.LIST,
                )
            ),
        })
        return self.async_show_form(
            step_id="init",
            data_schema=schema,
            description_placeholders={"count": str(len(candidates))},
        )


def _training_method(candidate: dict[str, Any]) -> str:
    """Suggest training based on device semantics, not a fixed repetition count."""
    domains = {c["domain"] for c in candidate.get("controls", [])}
    name = candidate.get("name", "").casefold()
    cycle_words = (
        "dishwasher", "dryer", "washer", "washing machine", "oven",
        "range", "heat pump", "furnace", "air conditioner", "hvac",
    )
    if domains & {"climate", "water_heater"} or any(word in name for word in cycle_words):
        return "full_cycle"
    return "quick"


def _training_plan_text(method: str) -> str:
    if method == "full_cycle":
        return (
            "Suggested method: Full cycle. This device may change load "
            "throughout operation, so the entire cycle is captured."
        )
    return (
        "Suggested method: Quick ON/OFF test. The system will watch for "
        "consistent transitions and will not assume a fixed number of repeats."
    )


def _candidate_category(candidate: dict[str, Any]) -> str:
    """Classify a candidate using HA entity domains, not AI guesses."""
    domains = {c["domain"] for c in candidate.get("controls", [])}
    if "climate" in domains:
        return "HVAC"
    if "light" in domains:
        return "Lighting"
    if "media_player" in domains:
        return "Media"
    if "vacuum" in domains:
        return "Appliance"
    if "water_heater" in domains:
        return "Appliance"
    if "humidifier" in domains:
        return "Appliance"
    if "fan" in domains:
        return "Fan"
    if "switch" in domains:
        return "Appliance"
    if "cover" in domains:
        return "Appliance"
    return "Electrical Load"
