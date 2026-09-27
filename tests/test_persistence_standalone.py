"""Standalone tests for EnergyIQ persistence semantics.

These tests intentionally use only the Python standard library so the repository
validation job can exercise the persistence contract without installing Home Assistant.
"""
from __future__ import annotations

import importlib.util
import sys
import types
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
MODULE_PATH = ROOT / "custom_components" / "energyiq" / "persistence.py"


def load_persistence():
    """Load persistence.py with minimal Home Assistant/import stubs."""
    homeassistant = types.ModuleType("homeassistant")
    helpers = types.ModuleType("homeassistant.helpers")
    storage = types.ModuleType("homeassistant.helpers.storage")

    class Store:
        def __init__(self, *args, **kwargs):
            pass

    storage.Store = Store
    helpers.storage = storage
    homeassistant.helpers = helpers

    custom_components = types.ModuleType("custom_components")
    custom_components.__path__ = [str(ROOT / "custom_components")]
    energyiq = types.ModuleType("custom_components.energyiq")
    energyiq.__path__ = [str(ROOT / "custom_components" / "energyiq")]
    const = types.ModuleType("custom_components.energyiq.const")
    const.DOMAIN = "energy_attribution"

    sys.modules.update({
        "homeassistant": homeassistant,
        "homeassistant.helpers": helpers,
        "homeassistant.helpers.storage": storage,
        "custom_components": custom_components,
        "custom_components.energyiq": energyiq,
        "custom_components.energyiq.const": const,
    })

    spec = importlib.util.spec_from_file_location(
        "custom_components.energyiq.persistence",
        MODULE_PATH,
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


persistence = load_persistence()


class Entry:
    options = {"rate": 0.12}


class Coordinator:
    power_entity = "sensor.whole_home_power"
    entry = Entry()
    candidate_devices = {
        "washer": {"device_id": "washer", "name": "Washer", "source": "ha"}
    }
    device_classifications = {"washer": "monitor"}
    commissioned_devices = {"washer": True}
    monitored_entities = ["sensor.washer_power"]
    training_state = {
        "washer": {
            "status": "complete",
            "learned_signature": {"load_w": 412},
        }
    }
    training_samples = {"washer": [100, 412]}
    last_training_device_id = "washer"


class PersistenceTests(unittest.TestCase):
    def test_schema_zero_migrates_to_current_schema(self):
        snapshot = persistence.migrate_snapshot({"training_state": {"x": {"status": "complete"}}})
        self.assertEqual(snapshot["schema_version"], persistence.SCHEMA_VERSION)

    def test_current_schema_is_preserved(self):
        snapshot = {"schema_version": persistence.SCHEMA_VERSION, "training_state": {"x": {}}}
        self.assertEqual(persistence.migrate_snapshot(snapshot), snapshot)

    def test_snapshot_contains_owned_workspace(self):
        snapshot = persistence.build_snapshot(Coordinator())
        self.assertEqual(snapshot["power_entity"], Coordinator.power_entity)
        self.assertEqual(snapshot["device_classifications"]["washer"], "monitor")
        self.assertEqual(snapshot["training_state"]["washer"]["status"], "complete")
        self.assertEqual(snapshot["training_samples"]["washer"], [100, 412])

    def test_restore_entry_data_is_independent_of_entry_id(self):
        snapshot = persistence.build_snapshot(Coordinator())
        restored = persistence.build_entry_data(snapshot, "sensor.new_whole_home_power")
        self.assertEqual(restored["power_entity"], "sensor.new_whole_home_power")
        self.assertIn("washer", restored["candidate_devices"])
        self.assertEqual(restored["device_classifications"]["washer"], "monitor")

    def test_invalid_empty_backup_is_rejected(self):
        with self.assertRaises(ValueError):
            persistence.validate_import_snapshot({"schema_version": 1})

    def test_unsupported_schema_is_rejected(self):
        with self.assertRaises(ValueError):
            persistence.validate_import_snapshot({"schema_version": 999, "training_state": {"x": {}}})


if __name__ == "__main__":
    unittest.main()
