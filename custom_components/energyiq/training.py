"""EnergyIQ training engine: one-shot five-fresh-reading capture."""
from __future__ import annotations

from dataclasses import dataclass, field
from statistics import median, pstdev
from typing import Literal

Method = Literal["quick", "manual", "full_cycle"]

@dataclass(slots=True)
class PowerSample:
    timestamp: float
    watts: float
    fresh: bool = True

@dataclass
class TrainingEngine:
    """Train one load from the fifth fresh Shelly measurement."""
    method: Method
    baseline_window_s: float = 3.0
    min_event_w: float = 12.0
    fresh_change_w: float = 0.1
    max_training_duration_s: float = 120.0
    manual_min_active_s: float = 5.0
    target_readings: int = 5
    samples: list[PowerSample] = field(default_factory=list)
    fresh_samples: list[PowerSample] = field(default_factory=list)
    baseline_w: float | None = None
    baseline_noise_w: float = 0.0
    on_threshold_w: float = 12.0
    phase: str = "baseline"
    active_started: float | None = None
    learned_w: float | None = None
    learned_source_w: float | None = None
    completed: bool = False
    _last_source_w: float | None = None

    def __post_init__(self) -> None:
        if self.method == "full_cycle":
            self.method = "quick"

    def add_sample(self, timestamp: float, watts: float, *, fresh: bool | None = None) -> dict:
        if watts != watts or watts < 0:
            return self.result()
        sample = PowerSample(timestamp, float(watts))
        self.samples.append(sample)
        self.samples = self.samples[-600:]
        if self._last_source_w is None:
            is_fresh = True if fresh is None else fresh
        elif fresh is not None:
            is_fresh = fresh
        else:
            is_fresh = abs(float(watts) - self._last_source_w) >= self.fresh_change_w
        self._last_source_w = float(watts)
        sample.fresh = is_fresh
        if self.samples and timestamp - self.samples[0].timestamp > self.max_training_duration_s:
            self.phase = "timeout"
            return self.result(failed=True, failure_reason="Training timed out before five fresh Shelly readings were captured.")
        if self.baseline_w is None:
            if timestamp - self.samples[0].timestamp >= self.baseline_window_s:
                recent = [x.watts for x in self.samples]
                self.baseline_w = median(recent)
                self.baseline_noise_w = pstdev(recent) if len(recent) > 1 else 0.0
                self.on_threshold_w = max(self.min_event_w, 4 * self.baseline_noise_w, abs(self.baseline_w) * 0.006)
                self.phase = "request_on" if self.method == "quick" else "ready_to_start"
            return self.result()
        if self.method == "manual":
            if self.phase == "capturing" and len(self.fresh_samples) == self.target_readings and self.active_started is not None and timestamp - self.active_started >= self.manual_min_active_s:
                self.completed = True
                self.phase = "complete"
            else:
                self._manual_step(sample)
            return self.result()
        return self._quick_step(sample)

    def _accept_fresh(self, sample: PowerSample) -> None:
        if not sample.fresh or len(self.fresh_samples) >= self.target_readings:
            return
        self.fresh_samples.append(sample)
        if len(self.fresh_samples) == self.target_readings:
            fifth = self.fresh_samples[self.target_readings - 1]
            self.learned_source_w = fifth.watts
            baseline = self.baseline_w if self.baseline_w is not None else 0.0
            self.learned_w = max(0.0, fifth.watts - baseline)
            if self.method == "quick":
                self.completed = True
                self.phase = "complete"
            elif self.active_started is not None and fifth.timestamp - self.active_started >= self.manual_min_active_s:
                self.completed = True
                self.phase = "complete"
            else:
                self.completed = False
                self.phase = "capturing"

    def _quick_step(self, sample: PowerSample) -> dict:
        if self.phase == "request_on":
            return self.result(action="turn_on")
        if self.phase == "capturing":
            self._accept_fresh(sample)
        return self.result()

    def control_action_consumed(self, action: str, timestamp: float) -> None:
        if self.method == "quick" and action == "turn_on" and self.phase == "request_on":
            self.phase = "capturing"
            self.active_started = timestamp
            self.fresh_samples.clear()
            self.learned_w = None
            self.learned_source_w = None

    def _manual_step(self, sample: PowerSample) -> dict:
        if self.phase == "ready_to_start":
            baseline = self.baseline_w if self.baseline_w is not None else sample.watts
            if sample.fresh and sample.watts >= baseline + self.on_threshold_w:
                self.phase = "capturing"
                self.active_started = sample.timestamp
                self.fresh_samples.clear()
                self.learned_w = None
                self.learned_source_w = None
                self._accept_fresh(sample)
            return self.result()
        if self.phase == "capturing":
            self._accept_fresh(sample)
        return self.result()

    def result(self, *, action: str | None = None, failed: bool = False, failure_reason: str | None = None, **extra) -> dict:
        count = min(len(self.fresh_samples), self.target_readings)
        progress = self.fresh_samples[: self.target_readings]
        duration = None
        if self.active_started is not None and self.samples:
            duration = max(0.0, self.samples[-1].timestamp - self.active_started)
        instruction = None
        if self.phase == "baseline":
            instruction = "Watching the load and establishing a stable baseline."
        elif self.phase == "request_on":
            instruction = "Baseline captured. EnergyIQ will turn the load ON automatically."
        elif self.phase == "ready_to_start":
            instruction = "Baseline is stable. Turn the load ON now. EnergyIQ will capture five fresh readings automatically."
        elif self.phase == "capturing":
            if self.method == "manual" and count >= self.target_readings and duration is not None and duration < self.manual_min_active_s:
                instruction = f"Five fresh readings captured. Holding the fifth reading until the {self.manual_min_active_s:.0f}-second minimum is reached."
            else:
                instruction = f"Capturing fresh Shelly readings: {count} of {self.target_readings}."
        elif self.phase == "complete":
            instruction = f"Training complete. Saved the fifth fresh reading: {self.learned_w:.1f} W load."
        return {"phase": self.phase, "method": self.method, "baseline_w": self.baseline_w, "baseline_noise_w": self.baseline_noise_w, "on_threshold_w": self.on_threshold_w, "fresh_readings_required": self.target_readings, "fresh_readings_collected": count, "fresh_readings": [s.watts for s in progress], "learned_w": self.learned_w, "learned_source_w": self.learned_source_w, "peak_delta_w": self.learned_w, "duration_s": duration, "completed": self.completed, "instruction": instruction, "action": action, "failed": failed, "failure_reason": failure_reason, **extra}
