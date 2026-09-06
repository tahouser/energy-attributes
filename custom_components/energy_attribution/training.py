"""Deterministic power-signature training engine.

This module has no Home Assistant dependencies so the detection logic can be
unit-tested with synthetic aggregate-power samples.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from statistics import median
from typing import Literal

Method = Literal["quick", "full_cycle"]

@dataclass(slots=True)
class PowerSample:
    timestamp: float
    watts: float

@dataclass(slots=True)
class QuickObservation:
    delta_w: float
    on_w: float
    off_w: float
    on_duration_s: float

@dataclass
class TrainingEngine:
    method: Method
    baseline_window_s: float = 12.0
    min_event_w: float = 30.0
    stable_window_s: float = 3.0
    idle_window_s: float = 30.0
    full_cycle_min_active_s: float = 30.0
    samples: list[PowerSample] = field(default_factory=list)
    baseline_w: float | None = None
    phase: str = "baseline"
    observations: list[QuickObservation] = field(default_factory=list)
    active_started: float | None = None
    active_peak_w: float | None = None
    cycle_started: float | None = None
    completed: bool = False

    def add_sample(self, timestamp: float, watts: float) -> dict:
        if watts != watts or watts < 0:
            return {"status": self.phase}
        sample = PowerSample(timestamp, watts)
        self.samples.append(sample)
        self.samples = self.samples[-18000:]

        if self.baseline_w is None:
            cutoff = timestamp - self.baseline_window_s
            recent = [s.watts for s in self.samples if s.timestamp >= cutoff]
            if recent and timestamp - self.samples[0].timestamp >= self.baseline_window_s:
                self.baseline_w = median(recent)
                self.phase = "waiting_for_on" if self.method == "quick" else "waiting_for_start"
            return self.result()

        if self.method == "quick":
            return self._quick_step(sample)
        return self._full_step(sample)

    def _quick_step(self, s: PowerSample) -> dict:
        if self.phase == "waiting_for_on":
            if s.watts >= self.baseline_w + self.min_event_w:
                self.phase = "on_stabilizing"
                self.active_started = s.timestamp
                self.active_peak_w = s.watts
        elif self.phase == "on_stabilizing":
            self.active_peak_w = max(self.active_peak_w or s.watts, s.watts)
            if s.timestamp - (self.active_started or s.timestamp) >= self.stable_window_s:
                self.phase = "waiting_for_off"
        elif self.phase == "waiting_for_off":
            if s.watts <= self.baseline_w + self.min_event_w * 0.35:
                on_w = self.active_peak_w or self.baseline_w
                off_w = median(x.watts for x in self.samples[-5:])
                delta = max(0.0, on_w - self.baseline_w)
                duration = max(0.0, s.timestamp - (self.active_started or s.timestamp))
                self.observations.append(QuickObservation(delta, on_w, off_w, duration))
                self.phase = "waiting_for_on"
                self.active_started = None
                self.active_peak_w = None
                if self._quick_confident():
                    self.completed = True
                    self.phase = "complete"
        return self.result()

    def _quick_confident(self) -> bool:
        if len(self.observations) < 2:
            return False
        values = [o.delta_w for o in self.observations]
        center = median(values)
        if center <= 0:
            return False
        return all(abs(v-center) <= max(0.10*center, 8.0) for v in values[-2:])

    def _full_step(self, s: PowerSample) -> dict:
        threshold = self.min_event_w
        if self.phase == "waiting_for_start":
            if s.watts >= self.baseline_w + threshold:
                self.phase = "capturing"
                self.cycle_started = s.timestamp
                self.active_started = s.timestamp
                self.active_peak_w = s.watts
        elif self.phase == "capturing":
            self.active_peak_w = max(self.active_peak_w or s.watts, s.watts)
            active_for = s.timestamp - (self.cycle_started or s.timestamp)
            recent = [x.watts for x in self.samples if x.timestamp >= s.timestamp - self.idle_window_s]
            if active_for >= self.full_cycle_min_active_s and recent and max(recent) <= self.baseline_w + threshold * 0.35:
                self.completed = True
                self.phase = "complete"
        return self.result()

    def _energy_wh(self) -> float:
        if self.baseline_w is None or len(self.samples) < 2:
            return 0.0
        total = 0.0
        for a, b in zip(self.samples, self.samples[1:]):
            dt = max(0.0, b.timestamp-a.timestamp)
            total += max(0.0, ((a.watts-self.baseline_w) + (b.watts-self.baseline_w))/2) * dt / 3600
        return total

    def result(self) -> dict:
        peak_delta = None
        duration = None
        if self.baseline_w is not None:
            peak = max((s.watts for s in self.samples), default=self.baseline_w)
            peak_delta = max(0.0, peak-self.baseline_w)
        if self.method == "quick" and self.observations:
            vals=[o.delta_w for o in self.observations]
            peak_delta=median(vals)
        if self.method == "full_cycle" and self.cycle_started is not None and self.samples:
            duration=max(0.0, self.samples[-1].timestamp-self.cycle_started)
        return {
            "phase": self.phase,
            "baseline_w": self.baseline_w,
            "peak_delta_w": peak_delta,
            "events_detected": len(self.observations),
            "observations": [o.__dict__ if hasattr(o, '__dict__') else {
                "delta_w":o.delta_w,"on_w":o.on_w,"off_w":o.off_w,"on_duration_s":o.on_duration_s
            } for o in self.observations],
            "duration_s": duration,
            "energy_wh": self._energy_wh(),
            "completed": self.completed,
        }
