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
from homeassistant.util import dt as dt_util
from homeassistant.helpers import selector
from homeassistant.helpers.selector import SelectOptionDict, SelectSelector, SelectSelectorConfig, SelectSelectorMode

from .const import CONF_MONITORED_ENTITIES, CONF_POWER_ENTITY, DOMAIN, TRAINING_SESSION

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
    """Build the Energy Attribution device environment.

    A device is a candidate if it has direct power/energy evidence OR a
    controllable appliance/load-style entity. This intentionally includes
    lights, switches/outlets, fans, climate devices, media players (TV/audio),
    vacuums, water heaters and similar loads so the user can decide later.
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

    # Domains that represent a controllable thing that can itself be an
    # electrical load, even when it has no direct power sensor.
    load_domains = {
        "light", "switch", "fan", "climate", "humidifier", "media_player",
        "vacuum", "water_heater",
    }

    # Domains that are explicitly not electrical-load candidates by themselves.
    ignored_domains = {
        "binary_sensor", "button", "camera", "event", "image", "input_boolean",
        "input_button", "input_datetime", "input_number", "input_select",
        "input_text", "number", "remote", "scene", "select", "sensor",
        "text", "update", "weather", "device_tracker",
    }

    candidates: list[dict[str, Any]] = []

    for device in devices.devices.values():
        # Never treat the whole-home meter device (including its phase
        # channels) as an appliance/load.
        if whole_home_device_id and device.id == whole_home_device_id:
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

            if entry.domain in load_domains:
                controls.append({
                    "entity_id": entry.entity_id,
                    "name": _entity_name(hass, entry),
                    "domain": entry.domain,
                })

        # Measurement evidence is strongest. Otherwise a controllable
        # load-style entity is enough to put the device into our review
        # environment. This is deliberate: the user decides what is useful.
        if not measurements and not controls:
            continue

        # A device that is only a battery/environmental sensor still does not
        # qualify. Hybrid devices with both useful load evidence and battery
        # entities remain candidates.
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

    # Put measured loads first, then controllable loads without measurement.
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
                title="Energy Attribution",
                data={
                    CONF_POWER_ENTITY: self._power_entity,
                    # Adopt every filtered device into our private environment.
                    # Selection/ignore is deliberately deferred to Configure.
                    "candidate_devices": {
                        c["device_id"]: c for c in self._candidates
                    },
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
    """Persistent commissioning workspace.

    The device list is the central UI. Adopt/monitor selection and training
    live here. Training state is persisted so a long-cycle capture can continue
    after the page is closed.
    """

    async def async_step_init(self, user_input=None):
        candidates = _build_candidates(
            self.hass, self.config_entry.data.get(CONF_POWER_ENTITY)
        )
        if not candidates:
            return self.async_abort(reason="no_candidates")

        classifications = dict(
            self.config_entry.options.get(
                "device_classifications",
                self.config_entry.data.get("device_classifications", {}),
            )
        )
        # First visit: adopt all filtered candidates into the private environment.
        if not classifications:
            classifications = {c["device_id"]: "monitor" for c in candidates}

        training_state = dict(
            self.config_entry.options.get(
                "training_state",
                self.config_entry.data.get("training_state", {}),
            )
        )

        if user_input is not None:
            action = user_input.get("action", "save")
            selected = set(user_input.get("monitored_devices", []))

            if action == "save":
                classifications = {
                    c["device_id"]: (
                        "monitor" if c["device_id"] in selected else "ignore"
                    )
                    for c in candidates
                }
                return self.async_create_entry(
                    title="",
                    data={
                        CONF_MONITORED_ENTITIES: _monitored_entities(
                            candidates, selected
                        ),
                        "device_classifications": classifications,
                        "candidate_devices": {
                            c["device_id"]: c for c in candidates
                        },
                        "training_state": training_state,
                    },
                )

            device_id = user_input.get("train_device")
            if action == "train" and device_id:
                candidate = next(
                    (c for c in candidates if c["device_id"] == device_id), None
                )
                if candidate:
                    training_state[device_id] = {
                        "status": "armed",
                        "device_name": candidate["name"],
                        "area": candidate["area"],
                        "category": _candidate_category(candidate),
                        "started_at": None,
                        "samples": [],
                        "baseline_w": None,
                        "peak_delta_w": None,
                    }
                    # Persist the armed state and return to the workspace.
                    selected = {
                        c["device_id"]
                        for c in candidates
                        if classifications.get(c["device_id"]) == "monitor"
                    }
                    return self.async_create_entry(
                        title="",
                        data={
                            CONF_MONITORED_ENTITIES: _monitored_entities(
                                candidates, selected
                            ),
                            "device_classifications": classifications,
                            "candidate_devices": {
                                c["device_id"]: c for c in candidates
                            },
                            "training_state": training_state,
                        },
                    )

        selected_default = [
            c["device_id"]
            for c in candidates
            if classifications.get(c["device_id"]) == "monitor"
        ]

        # Build a compact action selector. Trainable device IDs are represented
        # as separate actions; the selected device is handled by the next
        # revision's dedicated training step.
        options = [
            SelectOptionDict(value="save", label="Save monitor selections"),
        ]
        for c in candidates:
            state = training_state.get(c["device_id"], {})
            if state.get("status") == "armed":
                label = f"Training active — {c['name']}"
            elif state.get("status") == "complete":
                label = f"Trained ✓ — {c['name']}"
            else:
                label = f"Train — {c['name']}"
            options.append(SelectOptionDict(value=f"train:{c['device_id']}", label=label))

        # A single form gives us the persistent list and a training action.
        schema = vol.Schema({
            vol.Required(
                "monitored_devices", default=selected_default
            ): SelectSelector(
                SelectSelectorConfig(
                    options=_candidate_options(candidates),
                    multiple=True,
                    mode=SelectSelectorMode.LIST,
                )
            ),
            vol.Required("action", default="save"): SelectSelector(
                SelectSelectorConfig(
                    options=options,
                    multiple=False,
                    mode=SelectSelectorMode.DROPDOWN,
                )
            ),
        })

        # The config-flow form cannot expose arbitrary per-row buttons yet;
        # this revision keeps the persistent state model in place while using
        # native HA selectors. The next UI layer can replace this with a custom
        # panel without changing the stored model.
        return self.async_show_form(
            step_id="init",
            data_schema=schema,
            description_placeholders={"count": str(len(candidates))},
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
    return "Electrical Load"

