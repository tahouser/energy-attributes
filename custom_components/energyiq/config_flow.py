"""Config flow for EnergyIQ."""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timezone
from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.config_entries import SOURCE_RECONFIGURE
from homeassistant.data_entry_flow import section
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.entity import EntityCategory
from homeassistant.core import callback
from homeassistant.util import dt as dt_util
from homeassistant.helpers import selector
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
from .meter_detector import _probe_entities, discover_meters
from .persistence import build_entry_data, get_store, has_saved_data, migrate_snapshot

_LOGGER = logging.getLogger(__name__)

_POWER_CLASSES = {"power"}
_ENERGY_CLASSES = {"energy"}
_POWER_UNITS = {"W", "kW", "MW", "w", "kw", "mw"}
_ENERGY_UNITS = {"Wh", "kWh", "MWh", "GWh", "wh", "kwh", "mwh", "gwh"}


def _tokens(text: str) -> set[str]:
    """Split an entity name into normalized words for meter selection."""
    return {x for x in re.split(r"[^a-z0-9]+", text.casefold()) if x}

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


class ConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Commission EnergyIQ with the simplest useful path first."""

    VERSION = 4
    MINOR_VERSION = 1

    def __init__(self) -> None:
        self._power_entity: str | None = None
        self._candidates: list[dict[str, Any]] = []
        self._saved_snapshot: dict[str, Any] | None = None
        self._detected_meters: list[dict[str, Any]] = []
        self._selected_meter: dict[str, Any] | None = None
        self._meter_interrogation_task: asyncio.Task | None = None
        self._meter_probe_results: dict[str, dict[str, Any]] = {}

    def _create_commissioned_entry(self, power_entity: str, deferred: bool):
        self._power_entity = power_entity
        self._candidates = _build_candidates(self.hass, power_entity)
        return self.async_create_entry(title="EnergyIQ", data={
            CONF_POWER_ENTITY: power_entity,
            "candidate_devices": {c["device_id"]: c for c in self._candidates},
            CONF_MONITORED_ENTITIES: [],
            "device_classifications": {},
            "commissioned_devices": {},
            "commissioning_status": "needs_configuration" if not deferred else "deferred",
            "commissioning_source": self._selected_meter.get("group_id") if self._selected_meter else "manual",
            "commissioning_source_class": self._selected_meter.get("meter_class") if self._selected_meter else "manual",
            "_restore_persistent_data": False,
        })

    def _refresh_detected_meters(self) -> None:
        """Refresh all useful meter candidates from the live HA inventory."""
        report = discover_meters(self.hass)
        self._detected_meters = [
            candidate
            for candidate in report.get("candidates", [])
            if _commissioning_power_entity(candidate)
        ]

    def _commissioning_update_data(self, power_entity: str, candidate: dict[str, Any] | None) -> dict[str, Any]:
        """Build the small set of setup fields owned by commissioning."""
        return {
            CONF_POWER_ENTITY: power_entity,
            "commissioning_status": "complete",
            "commissioning_source": candidate.get("group_id") if candidate else "manual",
            "commissioning_source_class": candidate.get("meter_class") if candidate else "manual",
        }

    def _commissioning_candidate_map(self) -> dict[str, dict[str, Any]]:
        return {
            candidate["group_id"]: candidate
            for candidate in self._detected_meters
            if candidate.get("group_id")
        }

    async def _finish_commissioning(
        self,
        power_entity: str,
        candidate: dict[str, Any] | None,
    ):
        """Create a new entry or update an existing entry with the selected meter."""
        if self.source == SOURCE_RECONFIGURE:
            update_data = self._commissioning_update_data(power_entity, candidate)
            return self.async_update_reload_and_abort(
                self._get_reconfigure_entry(),
                data_updates=update_data,
            )

        self._selected_meter = candidate
        return self._create_commissioned_entry(power_entity, False)

    async def async_step_user(self, user_input=None):
        """Discover a useful whole-home source before asking for advanced settings."""
        if self._saved_snapshot is None:
            self._saved_snapshot = migrate_snapshot(await get_store(self.hass).async_load())

        if has_saved_data(self._saved_snapshot):
            return await self.async_step_existing_meter()

        # Meter Detector is the installation/commissioning step. Discovery
        # and Class A interrogation happen before the user is asked to choose.
        return await self.async_step_meter_discovery()

    async def async_step_meter_select(self, user_input=None):
        """Present discovery/interrogation results and let the user choose the meter."""
        if not self._detected_meters:
            self._refresh_detected_meters()
        if user_input is not None:
            selected = self._commissioning_candidate_map().get(user_input["meter"])
            if selected:
                self._selected_meter = selected
                power = _commissioning_power_entity(selected)
                if power:
                    return await self._finish_commissioning(power, selected)
            return await self.async_step_manual_meter()

        has_class_a = any(c.get("meter_class") == "A" for c in self._detected_meters)
        options = sorted(
            self._detected_meters,
            key=lambda candidate: (
                0 if candidate.get("meter_class") == "A" else 1,
                str(candidate.get("name", "")).casefold(),
            ),
        )
        probe_lines = []
        for candidate in options:
            if candidate.get("meter_class") != "A":
                continue
            result = self._meter_probe_results.get(
                str(candidate.get("group_id") or candidate.get("device_id"))
            )
            if result is None:
                continue
            channel_lines = []
            for channel in result.get("channels", []):
                measurements = []
                for entity in channel.get("entities", []):
                    maximum = entity.get("max")
                    if maximum is None:
                        continue
                    unit = entity.get("unit") or ""
                    measurements.append(f"{entity.get('kind', 'signal')} {float(maximum):.1f}{unit}")
                signal = ", ".join(measurements[:2])
                channel_lines.append(
                    f"{channel.get('channel', 'unlabeled')}: "
                    f"{'active' if channel.get('active') else 'quiet'}"
                    + (f" ({signal})" if signal else "")
                )
            detail = "; ".join(channel_lines)
            probe_lines.append(
                f"{candidate.get('name', 'Class A meter')}: "
                f"{result.get('active_channel_count', 0)}/"
                f"{result.get('channel_count_observed', 0)} channels active"
                + (f" — {detail}" if detail else "")
            )

        summary = (
            "Discovery complete. Every Class A source was automatically interrogated "
            "for 30 seconds before this selection page. "
            + ("; ".join(probe_lines) if probe_lines else "No Class A source required interrogation.")
        )

        return self.async_show_form(
            step_id="meter_select",
            description_placeholders={
                "description": summary,
            },
            data_schema=vol.Schema({
                vol.Required("meter"): SelectSelector(
                    SelectSelectorConfig(
                        options=_commissioning_options(options),
                        mode=SelectSelectorMode.LIST,
                    )
                ),
            }),
        )

    async def async_step_commission(self, user_input=None):
        """Give the user an explicit accept / choose-different / manual choice."""
        if self._selected_meter is None:
            self._refresh_detected_meters()
        if user_input is not None:
            action = user_input.get("action")
            if action == "use":
                power = _commissioning_power_entity(self._selected_meter) if self._selected_meter else None
                if power:
                    return await self._finish_commissioning(power, self._selected_meter)
            if action == "choose":
                self._refresh_detected_meters()
                return await self.async_step_choose_meter()
            return await self.async_step_manual_meter()

        if self._selected_meter is None:
            return await self.async_step_manual_meter()

        return self.async_show_menu(
            step_id="commission",
            menu_options=["commission_use", "commission_choose", "commission_manual"],
            description_placeholders={
                "meter": _commissioning_meter_label(self._selected_meter),
                "power": _commissioning_power_entity(self._selected_meter) or "Not available",
            },
        )

    async def async_step_commission_use(self, user_input=None):
        """Accept the detected meter."""
        if self._selected_meter is None:
            return await self.async_step_manual_meter()
        power = _commissioning_power_entity(self._selected_meter)
        if not power:
            return await self.async_step_manual_meter()
        return await self._finish_commissioning(power, self._selected_meter)

    async def async_step_commission_choose(self, user_input=None):
        """Reject the presented meter and choose another detected source."""
        self._refresh_detected_meters()
        return await self.async_step_choose_meter(user_input)

    async def async_step_commission_manual(self, user_input=None):
        """Reject the presented meter and enter a meter manually."""
        return await self.async_step_manual_meter(user_input)

    async def async_step_choose_meter(self, user_input=None):
        """List every useful detected source, not only Class A."""
        if not self._detected_meters:
            self._refresh_detected_meters()
        if user_input is not None:
            selected = self._commissioning_candidate_map().get(user_input["meter"])
            if selected:
                self._selected_meter = selected
                power = _commissioning_power_entity(selected)
                if power:
                    return await self._finish_commissioning(power, selected)
            return await self.async_step_manual_meter()

        return self.async_show_form(
            step_id="choose_meter",
            data_schema=vol.Schema({
                vol.Required("meter"): SelectSelector(
                    SelectSelectorConfig(
                        options=_commissioning_options(self._detected_meters),
                        mode=SelectSelectorMode.LIST,
                    )
                ),
            }),
        )

    async def async_step_manual_meter(self, user_input=None):
        """Offer either a discovered device or a manually selected power entity."""
        if not self._detected_meters:
            self._refresh_detected_meters()

        if user_input is not None:
            action = user_input.get("action")
            if action == "device":
                return await self.async_step_manual_device()
            if action == "entity":
                return await self.async_step_manual_entity()

        return self.async_show_menu(
            step_id="manual_meter",
            menu_options=["manual_device", "manual_entity"],
            description_placeholders={
                "message": (
                    "EnergyIQ could not identify your whole-home meter. "
                    "You can choose a useful device it found, or select any "
                    "Home Assistant power sensor yourself."
                )
            },
        )

    async def async_step_manual_device(self, user_input=None):
        """Choose a discovered Class A/B/C source."""
        if not self._detected_meters:
            self._refresh_detected_meters()
        if user_input is not None:
            selected = self._commissioning_candidate_map().get(user_input["meter"])
            if selected:
                self._selected_meter = selected
                power = _commissioning_power_entity(selected)
                if power:
                    return await self._finish_commissioning(power, selected)
            return await self.async_step_manual_meter()

        return self.async_show_form(
            step_id="manual_device",
            data_schema=vol.Schema({
                vol.Required("meter"): SelectSelector(
                    SelectSelectorConfig(
                        options=_commissioning_options(self._detected_meters),
                        mode=SelectSelectorMode.LIST,
                    )
                ),
            }),
        )

    async def async_step_manual_entity(self, user_input=None):
        """Select any Home Assistant power entity directly."""
        if user_input is not None:
            power_entity = user_input.get("power_entity")
            if power_entity:
                self._selected_meter = None
                return await self._finish_commissioning(power_entity, None)

        return self.async_show_form(
            step_id="manual_entity",
            data_schema=vol.Schema({
                vol.Required("power_entity"): selector.EntitySelector(
                    selector.EntitySelectorConfig(
                        domain="sensor",
                        device_class="power",
                        multiple=False,
                    )
                ),
            }),
        )


    async def async_step_existing_meter(self, user_input=None):
        """Ask whether an existing meter should be kept before discovery."""
        if self._saved_snapshot is None:
            self._saved_snapshot = migrate_snapshot(await get_store(self.hass).async_load())
        current_power = None
        if self.source == SOURCE_RECONFIGURE:
            current_power = self._get_reconfigure_entry().data.get(CONF_POWER_ENTITY)
        elif self._saved_snapshot:
            current_power = self._saved_snapshot.get("power_entity")

        if user_input is not None:
            action = user_input.get("action")
            if action == "keep":
                if self.source == SOURCE_RECONFIGURE:
                    return self.async_update_reload_and_abort(
                        self._get_reconfigure_entry(),
                        data_updates={},
                        reload_even_if_entry_is_unchanged=False,
                    )
                snapshot = self._saved_snapshot or {}
                data = build_entry_data(snapshot)
                data["_restore_persistent_data"] = True
                options = dict(snapshot.get("options") or {})
                options.update({
                    CONF_MONITORED_ENTITIES: data[CONF_MONITORED_ENTITIES],
                    "candidate_devices": data["candidate_devices"],
                    "device_classifications": data["device_classifications"],
                    "commissioned_devices": data["commissioned_devices"],
                })
                return self.async_create_entry(title="EnergyIQ", data=data, options=options)

            if action == "new":
                return await self.async_step_meter_discovery()

            if action == "restore" and self._saved_snapshot:
                snapshot = self._saved_snapshot
                saved_power = snapshot.get("power_entity")
                if saved_power:
                    if self.source == SOURCE_RECONFIGURE:
                        return self.async_update_reload_and_abort(
                            self._get_reconfigure_entry(),
                            data_updates={CONF_POWER_ENTITY: saved_power},
                        )
                    data = build_entry_data(snapshot)
                    data["_restore_persistent_data"] = True
                    options = dict(snapshot.get("options") or {})
                    options.update({
                        CONF_MONITORED_ENTITIES: data[CONF_MONITORED_ENTITIES],
                        "candidate_devices": data["candidate_devices"],
                        "device_classifications": data["device_classifications"],
                        "commissioned_devices": data["commissioned_devices"],
                    })
                    return self.async_create_entry(title="EnergyIQ", data=data, options=options)

        return self.async_show_menu(
            step_id="existing_meter",
            menu_options=["existing_keep", "existing_new", "existing_restore"],
            description_placeholders={
                "meter": current_power or "No previously saved meter entity",
            },
        )

    async def async_step_reconfigure(self, user_input=None):
        """Offer to keep the current meter or run fresh discovery."""
        return await self.async_step_existing_meter(user_input)

    async def _interrogate_class_a_meters(self) -> None:
        """Discover, group, classify, and automatically interrogate every Class A source."""
        self._refresh_detected_meters()
        class_a = [
            candidate
            for candidate in self._detected_meters
            if str(candidate.get("meter_class", "")).upper() == "A"
        ]

        async def probe(candidate: dict[str, Any]) -> tuple[str, dict[str, Any]]:
            rows = await _probe_entities(self.hass, candidate.get("entities", []))
            by_channel: dict[str, dict[str, Any]] = {}
            for row in rows:
                channel = row.get("channel") or "unlabeled"
                item = by_channel.setdefault(
                    channel,
                    {
                        "channel": channel,
                        "entities": [],
                        "active": False,
                        "reporting": False,
                    },
                )
                item["entities"].append(row)
                item["reporting"] = item["reporting"] or row.get("numeric_samples", 0) > 0
                item["active"] = item["active"] or row.get("status") == "active signal"

            channels = list(by_channel.values())
            for item in channels:
                item["assessment"] = (
                    "likely populated / carrying measurable signal"
                    if item["active"]
                    else (
                        "reporting, but zero during the probe — cannot prove CT is absent"
                        if item["reporting"]
                        else "not reporting during the probe"
                    )
                )

            active_channels = sum(1 for item in channels if item["active"])
            result = {
                "device_id": candidate.get("device_id"),
                "group_id": candidate.get("group_id"),
                "device_name": candidate.get("name"),
                "model": candidate.get("model"),
                "probe_seconds": 30,
                "sample_interval_seconds": 2,
                "channels": channels,
                "active_channel_count": active_channels,
                "channel_count_observed": len(channels),
            }
            return str(candidate.get("group_id") or candidate.get("device_id")), result

        if class_a:
            results = await asyncio.gather(*(probe(candidate) for candidate in class_a))
            self._meter_probe_results = dict(results)
        else:
            self._meter_probe_results = {}

    async def async_step_meter_discovery(self, user_input=None):
        """Run the Meter Detector before presenting a meter-selection form."""
        if self._meter_interrogation_task is None:
            self._meter_interrogation_task = self.hass.async_create_task(
                self._interrogate_class_a_meters()
            )

        if not self._meter_interrogation_task.done():
            return self.async_show_progress(
                progress_action="meter_discovery",
                progress_task=self._meter_interrogation_task,
            )

        self._refresh_detected_meters()
        if not self._detected_meters:
            return await self.async_step_manual_meter()

        return self.async_show_progress_done(next_step_id="meter_select")




class OptionsFlowHandler(config_entries.OptionsFlowWithReload):
    """Persistent commissioning workspace and consumption graph settings."""

    def __init__(self) -> None:
        self._pending_options: dict[str, Any] | None = None
        self._candidates_map: dict[str, dict[str, Any]] = {}
        self._candidates: list[dict[str, Any]] = []

    async def async_step_init(self, user_input=None):
        discovered = _build_candidates(
            self.hass, self.config_entry.data.get(CONF_POWER_ENTITY)
        )
        existing = dict(self.config_entry.options.get(
            "candidate_devices",
            self.config_entry.data.get("candidate_devices", {}),
        ))
        candidates_map = _reconcile_candidates(existing, discovered)
        candidates = list(candidates_map.values())
        if not candidates:
            return self.async_abort(reason="no_candidates")

        self._candidates_map = candidates_map
        self._candidates = candidates
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
            monitored = _monitored_entities(candidates, selected)
            options = dict(self.config_entry.options)
            options.update({
                CONF_MONITORED_ENTITIES: monitored,
                "device_classifications": classifications,
                "candidate_devices": candidates_map,
                "commissioned_devices": dict(options.get(
                    "commissioned_devices",
                    self.config_entry.data.get("commissioned_devices", {}),
                )),
                "training_state": dict(options.get(
                    "training_state",
                    self.config_entry.data.get("training_state", {}),
                )),
                "training_samples": dict(options.get(
                    "training_samples",
                    self.config_entry.data.get("training_samples", {}),
                )),
            })
            self._pending_options = options
            return await self.async_step_consumption_settings()

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


def _commissioning_power_entity(candidate: dict[str, Any]) -> str | None:
    """Choose the best aggregate power entity from a detected Class A source."""
    entities = [e for e in candidate.get("entities", []) if e.get("kind") == "power"]
    if not entities:
        return None
    def score(entity: dict[str, Any]) -> int:
        # Keep the selector self-contained. Config-flow code can survive a
        # stale HA module cache without depending on a helper added elsewhere.
        text = f"{entity.get('name', '')} {entity.get('entity_id', '')}".casefold()
        tokens = {
            token
            for token in re.split(r"[^a-z0-9]+", text)
            if token
        }
        value = 0
        if tokens & {"total", "aggregate", "whole", "home", "house", "mains", "main", "grid", "service"}:
            value += 100
        if tokens & {"l1", "l2", "l3", "phase", "channel", "ch1", "ch2", "ch3"}:
            value -= 40
        try:
            current = float(entity.get("value"))
        except (TypeError, ValueError):
            current = 0.0
        if current > 0:
            value += 5
        return value
    return max(entities, key=score)["entity_id"]


def _commissioning_meter_label(candidate: dict[str, Any]) -> str:
    name = candidate.get("name") or "Detected meter"
    detail = " · ".join(x for x in (candidate.get("manufacturer") or "", candidate.get("model") or "") if x)
    return f"{name} — {detail}" if detail else name


def _commissioning_options(candidates: list[dict[str, Any]]) -> list[SelectOptionDict]:
    """Create meter choices that expose the detector's classification."""
    options: list[SelectOptionDict] = []
    for candidate in candidates:
        meter_class = str(candidate.get("meter_class") or "C").upper()
        entity_count = len(candidate.get("entities") or [])
        power_count = sum(
            1 for entity in candidate.get("entities", []) if entity.get("kind") == "power"
        )
        energy_count = sum(
            1 for entity in candidate.get("entities", []) if entity.get("kind") == "energy"
        )
        grouping = (
            f"{len(candidate.get('member_device_ids') or [])} HA records"
            if len(candidate.get("member_device_ids") or []) > 1
            else "1 HA record"
        )
        label = (
            f"CLASS {meter_class} — {_commissioning_meter_label(candidate)}"
            f" · {grouping} · {entity_count} measurements"
            f" · {power_count} power / {energy_count} energy"
        )
        options.append(SelectOptionDict(value=candidate["group_id"], label=label))
    return options


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
