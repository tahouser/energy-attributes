"""Config flow for EnergyIQ."""
from __future__ import annotations

import csv
import io
import logging
from datetime import datetime, timezone
from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.data_entry_flow import section
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.entity import EntityCategory
from homeassistant.core import callback
from homeassistant.util import dt as dt_util
from homeassistant.helpers import selector
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.selector import BooleanSelector
from homeassistant.helpers.selector import (
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    SelectOptionDict,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
)

from .const import CONF_MONITORED_ENTITIES, CONF_POWER_ENTITY, DOMAIN, TRAINING_SESSION
from .persistence import build_entry_data, get_store, has_saved_data, migrate_snapshot

_LOGGER = logging.getLogger(__name__)

_POWER_CLASSES = {"power"}
_ENERGY_CLASSES = {"energy"}
_POWER_UNITS = {"W", "kW", "MW", "w", "kw", "mw"}
_ENERGY_UNITS = {"Wh", "kWh", "MWh", "GWh", "wh", "kwh", "mwh", "gwh"}

_DERIVED_ENERGY_WORDS = {
    "difference", "saved", "cost", "price", "tariff", "rate", "forecast",
    "daily", "weekly", "monthly", "yearly", "yesterday", "today", "last",
}

# Four time-of-day points define the yellow/red consumption thresholds.
# Peak and Off-Peak have independent profiles. Thresholds are kWh for the
# visible one-hour segment; partial current segments are scaled by elapsed time.
_CONSUMPTION_THRESHOLD_DEFAULTS = {
    "peak": [
        {"time": "00:00:00", "yellow": 1.0, "red": 2.0},
        {"time": "06:00:00", "yellow": 1.0, "red": 2.0},
        {"time": "12:00:00", "yellow": 1.5, "red": 3.0},
        {"time": "18:00:00", "yellow": 1.0, "red": 2.0},
    ],
    "off_peak": [
        {"time": "00:00:00", "yellow": 1.0, "red": 2.0},
        {"time": "06:00:00", "yellow": 1.5, "red": 3.0},
        {"time": "12:00:00", "yellow": 1.5, "red": 3.0},
        {"time": "18:00:00", "yellow": 1.0, "red": 2.0},
    ],
}
_CONSUMPTION_THRESHOLD_MAX_KWH = 50.0
_PEAK_SCHEDULE_DEFAULTS = {
    "start": "15:00:00",
    "end": "19:00:00",
    "days": [1, 2, 3, 4, 5],
}

_UTILITY_ZIP_SOURCES = (
    "https://data.openei.org/files/8563/iou_zipcodes_2024.csv",
    "https://data.openei.org/files/8563/non_iou_zipcodes_2024.csv",
)
_UTILITY_LOOKUP_YEAR = 2024
_UTILITY_CHARGE_BASES = {"monthly": "Monthly", "daily": "Daily", "per_kwh": "Per kWh", "percent": "Percentage"}

def _normalized_csv_key(value: str) -> str:
    return "".join(ch for ch in value.casefold() if ch.isalnum())

def _csv_value(row: dict[str, str], *names: str) -> str:
    normalized = {_normalized_csv_key(str(k)): str(v or "").strip() for k, v in row.items()}
    for name in names:
        value = normalized.get(_normalized_csv_key(name), "")
        if value:
            return value
    return ""

async def _lookup_utility_by_zip(hass, zip_code: str) -> dict[str, str] | None:
    session = async_get_clientsession(hass)
    for source in _UTILITY_ZIP_SOURCES:
        try:
            async with session.get(source, timeout=20) as response:
                if response.status != 200:
                    continue
                text = await response.text()
        except Exception as err:
            _LOGGER.warning("EnergyIQ utility ZIP lookup failed for %s: %s", zip_code, err)
            continue
        try:
            reader = csv.DictReader(io.StringIO(text))
            for row in reader:
                row_zip = _csv_value(row, "zip", "zipcode", "zip_code", "postal_code")
                if row_zip.strip().zfill(5) != zip_code:
                    continue
                utility = _csv_value(row, "utility_name", "utility", "company_name", "name")
                rate = _csv_value(row, "residential_rate", "residential", "residential_rate_per_kwh", "res_rate")
                if utility:
                    return {"utility_name": utility, "average_rate": rate, "source": source, "year": str(_UTILITY_LOOKUP_YEAR)}
        except Exception as err:
            _LOGGER.warning("EnergyIQ utility ZIP data could not be read: %s", err)
    return None


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
    all_devices = [*devices.devices, *devices.child_devices]
    _LOGGER.debug(
        "EnergyIQ device registry inventory: %d main + %d child devices",
        len(devices.devices), len(devices.child_devices),
    )

    for device in all_devices:
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


def _reconcile_candidates(
    existing: dict[str, dict[str, Any]],
    discovered: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Reconcile HA discovery with the persistent EnergyIQ candidate inventory.

    HA-owned metadata and attached entities come from the current discovery
    snapshot. EnergyIQ-owned fields on existing candidates are preserved.
    Existing candidates that are no longer discovered are retained so that an
    HA outage or temporary removal cannot silently discard EnergyIQ state.
    """
    discovered_by_id = {candidate["device_id"]: candidate for candidate in discovered}
    merged: dict[str, dict[str, Any]] = {}

    for device_id, candidate in existing.items():
        fresh = discovered_by_id.pop(device_id, None)
        if fresh is None:
            merged[device_id] = dict(candidate)
            continue
        preserved = dict(candidate)
        preserved.update(fresh)
        for key in ("category", "classification", "manual_added", "source"):
            if key in candidate:
                preserved[key] = candidate[key]
        merged[device_id] = preserved

    for device_id, candidate in discovered_by_id.items():
        merged[device_id] = dict(candidate)

    return merged


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


def _read_utility_charges(user_input: dict[str, Any]) -> list[dict[str, Any]]:
    charges = []
    for index in range(1, 5):
        name = str(user_input.get(f"charge{index}_name", "")).strip()
        amount = user_input.get(f"charge{index}_amount")
        basis = str(user_input.get(f"charge{index}_basis", "monthly"))
        if amount in (None, ""):
            continue
        charges.append({"name": name or f"Other charge {index}", "amount": float(amount), "basis": basis})
    return charges


def _utility_cost_schema(*, utility_name: str, average_rate: Any, zip_code: str, saved: Any, include_average: bool = True) -> vol.Schema:
    saved_map = {}
    if isinstance(saved, list):
        for index, charge in enumerate(saved[:4], start=1):
            if isinstance(charge, dict):
                saved_map[index] = charge
    fields: dict[Any, Any] = {
        vol.Required("zip_code", default=zip_code): str,
        vol.Required("utility_name", default=utility_name): str,
        vol.Optional("rate_plan", default=""): str,
        vol.Optional("peak_rate", default=""): NumberSelector(NumberSelectorConfig(min=0, max=100, step=0.0001, mode=NumberSelectorMode.BOX)),
        vol.Optional("off_peak_rate", default=""): NumberSelector(NumberSelectorConfig(min=0, max=100, step=0.0001, mode=NumberSelectorMode.BOX)),
    }
    if include_average:
        fields[vol.Optional("average_rate", default=str(average_rate or ""))] = str
    basis_options = [SelectOptionDict(value=value, label=label) for value, label in _UTILITY_CHARGE_BASES.items()]
    for index in range(1, 5):
        charge = saved_map.get(index, {})
        fields[vol.Optional(f"charge{index}_name", default=str(charge.get("name", "")))] = str
        fields[vol.Optional(f"charge{index}_amount", default=str(charge.get("amount", "")))] = NumberSelector(NumberSelectorConfig(min=0, max=10000, step=0.01, mode=NumberSelectorMode.BOX))
        fields[vol.Optional(f"charge{index}_basis", default=str(charge.get("basis", "monthly")))] = SelectSelector(SelectSelectorConfig(options=basis_options, multiple=False, mode=SelectSelectorMode.DROPDOWN))
    return vol.Schema(fields)


class ConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Initial setup only: choose the aggregate meter and create the entry."""

    VERSION = 4

    def __init__(self) -> None:
        self._power_entity: str | None = None
        self._candidates: list[dict[str, Any]] = []
        self._saved_snapshot: dict[str, Any] | None = None

    async def async_step_user(self, user_input=None):
        """Select the whole-home power sensor and optionally restore saved data."""
        if self._saved_snapshot is None:
            self._saved_snapshot = migrate_snapshot(
                await get_store(self.hass).async_load()
            )

        if user_input is not None:
            self._power_entity = user_input[CONF_POWER_ENTITY]
            restore = bool(user_input.get("restore_existing", False))

            if restore and has_saved_data(self._saved_snapshot):
                snapshot = self._saved_snapshot
                data = build_entry_data(snapshot, self._power_entity)
                data["_restore_persistent_data"] = True
                options = dict(snapshot.get("options") or {})
                options.update({
                    CONF_MONITORED_ENTITIES: data[CONF_MONITORED_ENTITIES],
                    "candidate_devices": data["candidate_devices"],
                    "device_classifications": data["device_classifications"],
                    "commissioned_devices": data["commissioned_devices"],
                })
                return self.async_create_entry(
                    title="EnergyIQ",
                    data=data,
                    options=options,
                )

            # "Start fresh" is explicit and intentionally replaces the
            # canonical store during the new entry's first setup.
            self._candidates = _build_candidates(self.hass, self._power_entity)
            return self.async_create_entry(
                title="EnergyIQ",
                data={
                    CONF_POWER_ENTITY: self._power_entity,
                    "candidate_devices": {c["device_id"]: c for c in self._candidates},
                    CONF_MONITORED_ENTITIES: [],
                    "device_classifications": {},
                    "commissioned_devices": {},
                    "_restore_persistent_data": False,
                },
            )

        schema_fields = {
            vol.Required(CONF_POWER_ENTITY): selector.EntitySelector(
                selector.EntitySelectorConfig(
                    domain="sensor",
                    device_class="power",
                    multiple=False,
                )
            )
        }
        if has_saved_data(self._saved_snapshot):
            schema_fields[vol.Optional("restore_existing", default=True)] = bool

        schema = vol.Schema(schema_fields)
        return self.async_show_form(step_id="user", data_schema=schema)

    async def async_step_reconfigure(self, user_input=None):
        """Show the EnergyIQ configuration framework for an existing entry."""
        return await self.async_step_configuration_menu(user_input)

    async def async_step_configuration_menu(self, user_input=None):
        """Present the top-level EnergyIQ configuration categories."""
        return self.async_show_menu(
            step_id="configuration_menu",
            menu_options=[
                "meter_properties",
                "general",
                "consumption_limits",
                "cost_limits",
                "peak_time_window",
                "utility_search",
            ],
        )

    async def _configuration_placeholder(self, step_id: str):
        """Show a configuration section without changing stored values yet."""
        return self.async_show_form(
            step_id=step_id,
            data_schema=vol.Schema({}),
        )

    async def async_step_meter_properties(self, user_input=None):
        if user_input is not None:
            return await self.async_step_configuration_menu()
        return await self._configuration_placeholder("meter_properties")

    async def async_step_general(self, user_input=None):
        if user_input is not None:
            return await self.async_step_configuration_menu()
        return await self._configuration_placeholder("general")

    async def async_step_consumption_limits(self, user_input=None):
        if user_input is not None:
            return await self.async_step_configuration_menu()
        return await self._configuration_placeholder("consumption_limits")

    async def async_step_cost_limits(self, user_input=None):
        if user_input is not None:
            return await self.async_step_configuration_menu()
        return await self._configuration_placeholder("cost_limits")

    async def async_step_peak_time_window(self, user_input=None):
        if user_input is not None:
            return await self.async_step_configuration_menu()
        return await self._configuration_placeholder("peak_time_window")

    async def async_step_utility_search(self, user_input=None):
        if user_input is not None:
            return await self.async_step_configuration_menu()
        return await self._configuration_placeholder("utility_search")

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return OptionsFlowHandler()


class OptionsFlowHandler(config_entries.OptionsFlowWithReload):
    """Persistent commissioning workspace and consumption graph settings."""

    def __init__(self) -> None:
        self._pending_options: dict[str, Any] | None = None
        self._candidates_map: dict[str, dict[str, Any]] = {}
        self._candidates: list[dict[str, Any]] = []
        self._utility_lookup: dict[str, str] = {}

    async def async_step_init(self, user_input=None):
        """Enter the EnergyIQ configuration categories."""
        return await self.async_step_configuration_menu()

    async def async_step_configuration_menu(self, user_input=None):
        """Show the EnergyIQ configuration categories."""
        return self.async_show_menu(
            step_id="configuration_menu",
            menu_options=[
                "meter_properties",
                "general",
                "consumption_limits",
                "cost_limits",
                "peak_time_window",
                "utility_search",
            ],
        )

    async def _configuration_placeholder(self, step_id: str, user_input=None):
        """Show a framework section until its settings are implemented."""
        if user_input is not None:
            return await self.async_step_configuration_menu()
        return self.async_show_form(step_id=step_id, data_schema=vol.Schema({}))

    async def async_step_meter_properties(self, user_input=None):
        """Show the current whole-home meter without exposing unsafe shortcuts."""
        current = self.config_entry.data.get(CONF_POWER_ENTITY)
        state = self.hass.states.get(current) if current else None
        meter_name = (
            state.attributes.get("friendly_name")
            if state is not None
            else current
        ) or "No whole-home meter is currently selected"

        if user_input is not None:
            return await self.async_step_configuration_menu()

        return self.async_show_form(
            step_id="meter_properties",
            data_schema=vol.Schema({}),
            description_placeholders={
                "meter": str(meter_name),
            },
        )

    async def async_step_general(self, user_input=None):
        """Configure global EnergyIQ preferences."""
        options = dict(self.config_entry.options)
        currency = str(options.get("currency", "USD"))
        time_zone = str(self.hass.config.time_zone or "UTC")
        if user_input is not None:
            options["currency"] = str(user_input.get("currency", currency))
            return self.async_create_entry(data=options)

        currency_options = [
            SelectOptionDict(value="USD", label="USD ($)"),
            SelectOptionDict(value="CAD", label="CAD ($)"),
            SelectOptionDict(value="EUR", label="EUR (€)"),
            SelectOptionDict(value="GBP", label="GBP (£)"),
            SelectOptionDict(value="AUD", label="AUD ($)"),
        ]
        schema = vol.Schema({
            vol.Required("currency", default=currency): SelectSelector(
                SelectSelectorConfig(
                    options=currency_options,
                    multiple=False,
                    mode=SelectSelectorMode.DROPDOWN,
                )
            ),
        })
        return self.async_show_form(
            step_id="general",
            data_schema=schema,
            description_placeholders={"time_zone": time_zone},
        )

    async def async_step_consumption_limits(self, user_input=None):
        options = dict(self.config_entry.options)
        saved = options.get("consumption_limits", {})
        peak = dict(saved.get("peak", {})) if isinstance(saved, dict) else {}
        off_peak = dict(saved.get("off_peak", {})) if isinstance(saved, dict) else {}
        if user_input is not None:
            options["consumption_limits"] = {
                "peak": {"yellow": float(user_input["peak_green_yellow"]), "red": float(user_input["peak_yellow_red"])},
                "off_peak": {"yellow": float(user_input["off_peak_green_yellow"]), "red": float(user_input["off_peak_yellow_red"])},
            }
            return self.async_create_entry(data=options)
        return self.async_show_form(
            step_id="consumption_limits",
            data_schema=vol.Schema({
                vol.Required("peak_green_yellow", default=float(peak.get("yellow", 1.0))): NumberSelector(NumberSelectorConfig(min=0, max=50, step=0.1, mode=NumberSelectorMode.BOX)),
                vol.Required("peak_yellow_red", default=float(peak.get("red", 2.0))): NumberSelector(NumberSelectorConfig(min=0, max=50, step=0.1, mode=NumberSelectorMode.BOX)),
                vol.Required("off_peak_green_yellow", default=float(off_peak.get("yellow", 1.0))): NumberSelector(NumberSelectorConfig(min=0, max=50, step=0.1, mode=NumberSelectorMode.BOX)),
                vol.Required("off_peak_yellow_red", default=float(off_peak.get("red", 2.0))): NumberSelector(NumberSelectorConfig(min=0, max=50, step=0.1, mode=NumberSelectorMode.BOX)),
            }),
        )

    async def async_step_cost_limits(self, user_input=None):
        options = dict(self.config_entry.options)
        saved = options.get("cost_limits", {})
        peak = dict(saved.get("peak", {})) if isinstance(saved, dict) else {}
        off_peak = dict(saved.get("off_peak", {})) if isinstance(saved, dict) else {}
        if user_input is not None:
            options["cost_limits"] = {
                "peak": {"yellow": float(user_input["peak_green_yellow"]), "red": float(user_input["peak_yellow_red"])},
                "off_peak": {"yellow": float(user_input["off_peak_green_yellow"]), "red": float(user_input["off_peak_yellow_red"])},
            }
            return self.async_create_entry(data=options)
        return self.async_show_form(
            step_id="cost_limits",
            data_schema=vol.Schema({
                vol.Required("peak_green_yellow", default=float(peak.get("yellow", 0.25))): NumberSelector(NumberSelectorConfig(min=0, max=1000, step=0.01, mode=NumberSelectorMode.BOX)),
                vol.Required("peak_yellow_red", default=float(peak.get("red", 0.50))): NumberSelector(NumberSelectorConfig(min=0, max=1000, step=0.01, mode=NumberSelectorMode.BOX)),
                vol.Required("off_peak_green_yellow", default=float(off_peak.get("yellow", 0.15))): NumberSelector(NumberSelectorConfig(min=0, max=1000, step=0.01, mode=NumberSelectorMode.BOX)),
                vol.Required("off_peak_yellow_red", default=float(off_peak.get("red", 0.30))): NumberSelector(NumberSelectorConfig(min=0, max=1000, step=0.01, mode=NumberSelectorMode.BOX)),
            }),
        )

    async def async_step_peak_time_window(self, user_input=None):
        options = dict(self.config_entry.options)
        saved = options.get("peak_time_windows", [])
        if not isinstance(saved, list) or not saved:
            legacy = options.get("consumption_peak_schedule", {})
            saved = [legacy] if isinstance(legacy, dict) and legacy else []
        first = saved[0] if saved else _PEAK_SCHEDULE_DEFAULTS
        second = saved[1] if len(saved) > 1 else {}
        errors = {}
        if user_input is not None:
            windows = [{
                "start": str(user_input["period1_start"]),
                "end": str(user_input["period1_end"]),
                "days": [int(day) for day in user_input["period1_days"]],
            }]
            if user_input.get("period2_enabled"):
                windows.append({
                    "start": str(user_input["period2_start"]),
                    "end": str(user_input["period2_end"]),
                    "days": [int(day) for day in user_input["period2_days"]],
                })
            if any(window["start"] == window["end"] for window in windows):
                errors["base"] = "peak_start_end_must_differ"
            elif any(not window["days"] for window in windows):
                errors["base"] = "peak_days_required"
            else:
                options["peak_time_windows"] = windows
                options["consumption_peak_schedule"] = windows[0]
                return self.async_create_entry(data=options)
        weekday_options = [SelectOptionDict(value=str(i), label=label) for i, label in enumerate(("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"))]
        return self.async_show_form(
            step_id="peak_time_window",
            data_schema=vol.Schema({
                vol.Required("period1_start", default=str(first.get("start", "15:00:00"))): selector.TimeSelector(),
                vol.Required("period1_end", default=str(first.get("end", "19:00:00"))): selector.TimeSelector(),
                vol.Required("period1_days", default=[str(day) for day in first.get("days", [1,2,3,4,5])]): SelectSelector(SelectSelectorConfig(options=weekday_options, multiple=True, mode=SelectSelectorMode.DROPDOWN)),
                vol.Optional("period2_enabled", default=bool(second)): BooleanSelector(),
                vol.Optional("period2_start", default=str(second.get("start", "17:00:00"))): selector.TimeSelector(),
                vol.Optional("period2_end", default=str(second.get("end", "20:00:00"))): selector.TimeSelector(),
                vol.Optional("period2_days", default=[str(day) for day in second.get("days", [1,2,3,4,5])]): SelectSelector(SelectSelectorConfig(options=weekday_options, multiple=True, mode=SelectSelectorMode.DROPDOWN)),
            }),
            errors=errors,
        )

    async def async_step_utility_search(self, user_input=None):
        options = dict(self.config_entry.options)
        if user_input is not None:
            zip_code = str(user_input.get("zip_code", "")).strip()
            if len(zip_code) != 5 or not zip_code.isdigit():
                return self.async_show_form(
                    step_id="utility_search",
                    data_schema=vol.Schema({vol.Required("zip_code", default=zip_code): str}),
                    errors={"base": "invalid_zip"},
                )
            result = await _lookup_utility_by_zip(self.hass, zip_code)
            if result:
                self._utility_lookup = result
                return await self.async_step_utility_result()
            return await self.async_step_utility_manual(zip_code=zip_code)
        return self.async_show_form(
            step_id="utility_search",
            data_schema=vol.Schema({vol.Required("zip_code", default=str(options.get("utility_zip_code", ""))): str}),
        )

    async def async_step_utility_result(self, user_input=None):
        options = dict(self.config_entry.options)
        result = self._utility_lookup
        if user_input is not None:
            options.update({
                "utility_zip_code": str(user_input["zip_code"]),
                "utility_name": str(user_input["utility_name"]),
                "utility_rate_plan": str(user_input.get("rate_plan", "")),
                "utility_average_rate": float(user_input["average_rate"]) if user_input.get("average_rate") not in (None, "") else None,
                "utility_peak_rate": float(user_input["peak_rate"]) if user_input.get("peak_rate") not in (None, "") else None,
                "utility_off_peak_rate": float(user_input["off_peak_rate"]) if user_input.get("off_peak_rate") not in (None, "") else None,
                "utility_lookup_year": int(result.get("year", _UTILITY_LOOKUP_YEAR)),
                "utility_lookup_source": result.get("source", ""),
                "utility_costs": _read_utility_charges(user_input),
            })
            return self.async_create_entry(data=options)
        return self.async_show_form(
            step_id="utility_result",
            data_schema=_utility_cost_schema(
                utility_name=result.get("utility_name", ""),
                average_rate=result.get("average_rate", ""),
                zip_code=options.get("utility_zip_code", ""),
                saved=options.get("utility_costs", []),
            ),
        )

    async def async_step_utility_manual(self, user_input=None, zip_code=""):
        options = dict(self.config_entry.options)
        if user_input is not None:
            options.update({
                "utility_zip_code": str(user_input["zip_code"]),
                "utility_name": str(user_input["utility_name"]),
                "utility_rate_plan": str(user_input.get("rate_plan", "")),
                "utility_average_rate": None,
                "utility_peak_rate": float(user_input["peak_rate"]) if user_input.get("peak_rate") not in (None, "") else None,
                "utility_off_peak_rate": float(user_input["off_peak_rate"]) if user_input.get("off_peak_rate") not in (None, "") else None,
                "utility_lookup_year": None,
                "utility_lookup_source": "manual",
                "utility_costs": _read_utility_charges(user_input),
            })
            return self.async_create_entry(data=options)
        return self.async_show_form(
            step_id="utility_manual",
            data_schema=_utility_cost_schema(
                utility_name=options.get("utility_name", ""),
                average_rate="",
                zip_code=zip_code or options.get("utility_zip_code", ""),
                saved=options.get("utility_costs", []),
                include_average=False,
            ),
        )

    async def async_step_consumption_settings(self, user_input=None):
        """Configure the compact consumption thresholds and Peak schedule."""
        saved_thresholds = self.config_entry.options.get("consumption_thresholds", {})
        yellow_default = 1.0
        red_default = 2.0

        # Migrate the previous four-point profiles into the new single
        # threshold pair without discarding an existing configured value.
        if isinstance(saved_thresholds, dict):
            if isinstance(saved_thresholds.get("yellow"), (int, float)):
                yellow_default = float(saved_thresholds["yellow"])
            elif isinstance(saved_thresholds.get("peak"), list) and saved_thresholds["peak"]:
                yellow_default = float(saved_thresholds["peak"][0].get("yellow", yellow_default))
            if isinstance(saved_thresholds.get("red"), (int, float)):
                red_default = float(saved_thresholds["red"])
            elif isinstance(saved_thresholds.get("peak"), list) and saved_thresholds["peak"]:
                red_default = float(saved_thresholds["peak"][0].get("red", red_default))

        saved_schedule = self.config_entry.options.get("consumption_peak_schedule", {})
        schedule = dict(_PEAK_SCHEDULE_DEFAULTS)
        if isinstance(saved_schedule, dict):
            schedule["start"] = str(saved_schedule.get("start", schedule["start"]))
            schedule["end"] = str(saved_schedule.get("end", schedule["end"]))
            days = saved_schedule.get("days", schedule["days"])
            if isinstance(days, list):
                schedule["days"] = [
                    int(day) for day in days
                    if str(day).isdigit() and 0 <= int(day) <= 6
                ]

        errors: dict[str, str] = {}
        if user_input is not None:
            peak = user_input.get("peak_period", {})
            limits = user_input.get("consumption_limits", {})
            start_time = str(peak.get("peak_start", schedule["start"]))
            end_time = str(peak.get("peak_end", schedule["end"]))
            days = [int(day) for day in peak.get("peak_days", schedule["days"])]

            yellow = float(limits.get("green_yellow", yellow_default))
            red = float(limits.get("yellow_red", red_default))

            if start_time == end_time:
                errors["peak_period"] = "peak_start_end_must_differ"
            elif red < yellow:
                errors["consumption_limits"] = "red_must_be_at_least_yellow"
            elif not days:
                errors["peak_period"] = "peak_days_required"

            if not errors:
                options = dict(self._pending_options or self.config_entry.options)
                options["consumption_thresholds"] = {
                    "yellow": yellow,
                    "red": red,
                }
                options["consumption_peak_schedule"] = {
                    "start": start_time,
                    "end": end_time,
                    "days": days,
                }
                coordinator = self.config_entry.runtime_data
                if coordinator is not None and hasattr(coordinator, "async_persist_owned_state"):
                    await coordinator.async_persist_owned_state(options=options)
                return self.async_create_entry(data=options)

        weekday_options = [
            SelectOptionDict(value="0", label="Sunday"),
            SelectOptionDict(value="1", label="Monday"),
            SelectOptionDict(value="2", label="Tuesday"),
            SelectOptionDict(value="3", label="Wednesday"),
            SelectOptionDict(value="4", label="Thursday"),
            SelectOptionDict(value="5", label="Friday"),
            SelectOptionDict(value="6", label="Saturday"),
        ]

        schema = vol.Schema({
            vol.Required("peak_period"): section(
                vol.Schema({
                    vol.Required("peak_start", default=schedule["start"]): selector.TimeSelector(),
                    vol.Required("peak_end", default=schedule["end"]): selector.TimeSelector(),
                    vol.Required(
                        "peak_days",
                        default=[str(day) for day in schedule["days"]],
                    ): SelectSelector(
                        SelectSelectorConfig(
                            options=weekday_options,
                            multiple=True,
                            mode=SelectSelectorMode.DROPDOWN,
                        )
                    ),
                }),
                {"collapsed": False},
            ),
            vol.Required("consumption_limits"): section(
                vol.Schema({
                    vol.Required(
                        "green_yellow",
                        default=yellow_default,
                    ): NumberSelector(
                        NumberSelectorConfig(
                            min=0,
                            max=_CONSUMPTION_THRESHOLD_MAX_KWH,
                            step=0.1,
                            mode=NumberSelectorMode.BOX,
                        )
                    ),
                    vol.Required(
                        "yellow_red",
                        default=red_default,
                    ): NumberSelector(
                        NumberSelectorConfig(
                            min=0,
                            max=_CONSUMPTION_THRESHOLD_MAX_KWH,
                            step=0.1,
                            mode=NumberSelectorMode.BOX,
                        )
                    ),
                }),
                {"collapsed": False},
            ),
        })
        return self.async_show_form(
            step_id="consumption_settings",
            data_schema=schema,
            errors=errors,
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
