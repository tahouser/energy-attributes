import unittest

from discriminator import discriminate


def ent(eid, cls, platform="shelly", device_id=None, name=None, state_class="measurement", attrs=None, domain="sensor"):
    return {
        "entity_id": eid,
        "domain": domain,
        "platform": platform,
        "device_id": device_id,
        "name": name or eid.split(".", 1)[1],
        "measurement_class": cls,
        "current_state": {
            "state": "100",
            "attributes": {
                "device_class": cls,
                "state_class": state_class,
                "unit_of_measurement": "W" if cls == "power" else "kWh",
                **(attrs or {}),
            },
        },
    }


class TestDiscriminator(unittest.TestCase):
    def test_shelly_derived_aggregate(self):
        p0 = ent("sensor.shelly_energy_meter_0_power", "power", device_id="d0", name="Power")
        p2 = ent("sensor.shelly_energy_meter_2_power", "power", device_id="d2", name="Power")
        total = ent(
            "sensor.power",
            "power",
            platform="min_max",
            attrs={"entity_id": [p0["entity_id"], p2["entity_id"]]},
        )
        result = discriminate({"entities": [p0, p2, total], "devices": []})
        self.assertEqual(result["whole_home"]["selected_power"], "sensor.power")

    def test_energyiq_source_is_excluded(self):
        entity = ent("sensor.whole_home_power", "power", platform="energyiq")
        result = discriminate({"entities": [entity], "devices": []})
        self.assertIsNone(result["whole_home"]["selected_power"])

    def test_device_energy_not_whole_home(self):
        entity = ent(
            "sensor.plug_total_consumption",
            "energy",
            platform="tplink",
            device_id="plug1",
            name="Total consumption",
            state_class="total_increasing",
        )
        result = discriminate({"entities": [entity], "devices": []})
        self.assertIsNone(result["whole_home"]["selected_energy"])

    def test_house_energy_can_be_primary(self):
        entity = ent(
            "sensor.house_energy_total",
            "energy",
            platform="template",
            name="House Energy Total",
            state_class="total_increasing",
            attrs={"unit_of_measurement": "kWh"},
        )
        result = discriminate({"entities": [entity], "devices": []})
        self.assertEqual(result["whole_home"]["selected_energy"], "sensor.house_energy_total")

    def test_power_measurement_is_auto_train(self):
        entity = ent(
            "sensor.dishwasher_power",
            "power",
            platform="smartthings",
            device_id="dish",
            name="Power",
        )
        device = {
            "device_id": "dish",
            "name": "Dishwasher",
            "manufacturer": "Samsung",
            "model": "Dishwasher",
            "entities": [entity["entity_id"]],
        }
        result = discriminate({"entities": [entity], "devices": [device]})
        self.assertEqual(result["device_assessments"][0]["training_method"], "auto_train")

    def test_controllable_without_power_is_quick(self):
        entity = {
            "entity_id": "switch.fan",
            "domain": "switch",
            "platform": "tplink",
            "device_id": "fan",
            "name": "Fan",
            "measurement_class": None,
            "current_state": {"state": "off", "attributes": {}},
        }
        device = {"device_id": "fan", "name": "Bathroom Fan", "entities": [entity["entity_id"]]}
        result = discriminate({"entities": [entity], "devices": [device]})
        self.assertEqual(result["device_assessments"][0]["training_method"], "quick")


if __name__ == "__main__":
    unittest.main()
