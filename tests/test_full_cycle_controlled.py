import importlib.util
import sys
from pathlib import Path
spec = importlib.util.spec_from_file_location("energyiq_training", Path("custom_components/energyiq/training.py"))
training_module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = training_module
spec.loader.exec_module(training_module)
TrainingEngine = training_module.TrainingEngine
def feed(engine, start, values, step=1.0):
    for i, watts in enumerate(values): engine.add_sample(start + i * step, watts)
def test_controlled_start_and_baseline():
    e = TrainingEngine("full_cycle", baseline_window_s=3, full_cycle_min_active_s=30)
    feed(e, 0, [100] * 4); assert e.phase == "waiting_for_start"
    feed(e, 4, [220] * 10); assert e.phase == "waiting_for_start"
    e.confirm_full_cycle(True, 14); feed(e, 14, [220] * 40)
    r = e.result(); assert r["baseline_w"] == 100; assert r["capture_valid"] is True; assert 110 <= r["stable_load_w"] <= 130
def test_stop_blocked_until_valid():
    e = TrainingEngine("full_cycle", baseline_window_s=3, full_cycle_min_active_s=30)
    feed(e, 0, [100] * 4); e.confirm_full_cycle(True, 4); feed(e, 4, [220] * 10)
    r = e.end_full_cycle(); assert r["phase"] == "capturing"; assert r["end_ready"] is False
def test_save_after_valid_without_return_to_baseline():
    e = TrainingEngine("full_cycle", baseline_window_s=3, full_cycle_min_active_s=30)
    feed(e, 0, [100] * 4); e.confirm_full_cycle(True, 4); feed(e, 4, [220] * 40)
    r = e.end_full_cycle(); assert r["completed"] is True; assert r["peak_delta_w"] == 120
test_controlled_start_and_baseline(); test_stop_blocked_until_valid(); test_save_after_valid_without_return_to_baseline(); print("Focused Full Cycle tests: PASS")
