"""Deterministic power-signature training engine."""
from __future__ import annotations
from dataclasses import dataclass, field
from statistics import median, pstdev
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
    baseline_window_s: float = 6.0
    min_event_w: float = 12.0
    stable_window_s: float = 2.0
    return_tolerance_w: float = 25.0
    max_quick_duration_s: float = 120.0
    max_full_cycle_duration_s: float = 8 * 3600.0
    full_cycle_min_active_s: float = 30.0
    idle_window_s: float = 30.0
    samples: list[PowerSample] = field(default_factory=list)
    baseline_w: float | None = None
    baseline_noise_w: float = 0.0
    on_threshold_w: float = 12.0
    phase: str = "baseline"
    observations: list[QuickObservation] = field(default_factory=list)
    active_started: float | None = None
    active_peak_w: float | None = None
    cycle_started: float | None = None
    completed: bool = False
    _on_hits: int = 0
    _off_hits: int = 0
    _cooldown_until: float | None = None
    cycles_required: int = 3

    def add_sample(self, timestamp: float, watts: float) -> dict:
        if watts != watts or watts < 0:
            return self.result()
        if self.samples:
            limit = self.max_quick_duration_s if self.method == "quick" else self.max_full_cycle_duration_s
            if timestamp - self.samples[0].timestamp > limit:
                self.phase = "timeout"
                return self.result(failed=True, failure_reason="Training timed out. No reliable signature was captured.")
        s = PowerSample(timestamp, watts)
        self.samples.append(s)
        self.samples = self.samples[-18000:]

        if self.baseline_w is None:
            if timestamp - self.samples[0].timestamp >= self.baseline_window_s:
                recent = [x.watts for x in self.samples]
                self.baseline_w = median(recent)
                self.baseline_noise_w = pstdev(recent) if len(recent) > 1 else 0.0
                self.on_threshold_w = max(self.min_event_w, 4 * self.baseline_noise_w, abs(self.baseline_w) * 0.006)
                self.return_tolerance_w = max(18.0, 6 * self.baseline_noise_w, abs(self.baseline_w) * 0.010)
                self.phase = "request_on" if self.method == "quick" else "waiting_for_start"
            return self.result()

        if self.method == "quick":
            return self._quick_step(s)
        return self._full_step(s)

    def _quick_step(self, s: PowerSample) -> dict:
        if self.phase == "request_on":
            return self.result(action="turn_on")
        if self.phase == "waiting_for_on":
            if s.watts >= self.baseline_w + self.on_threshold_w:
                self._on_hits += 1
                self.active_peak_w = max(self.active_peak_w or s.watts, s.watts)
                if self._on_hits >= 2:
                    self.phase = "request_off"
                    self.active_started = self.active_started or s.timestamp
            else:
                self._on_hits = 0
                self.active_peak_w = max(self.active_peak_w or self.baseline_w, s.watts)
        elif self.phase == "request_off":
            return self.result(action="turn_off")
        elif self.phase == "waiting_for_off":
            if s.watts <= self.baseline_w + self.return_tolerance_w:
                self._off_hits += 1
                if self._off_hits >= 2:
                    on_w = self.active_peak_w or s.watts
                    off_w = median(x.watts for x in self.samples[-3:])
                    delta = max(0.0, on_w - self.baseline_w)
                    duration = max(0.0, s.timestamp - (self.active_started or s.timestamp))
                    self.observations.append(QuickObservation(delta, on_w, off_w, duration))
                    if len(self.observations) >= self.cycles_required:
                        self.completed = self._quick_valid()
                        self.phase = "complete" if self.completed else "error"
                        if not self.completed:
                            return self.result(failed=True, failure_reason="The three ON/OFF measurements were not consistent enough to save a signature.")
                    else:
                        self.phase = "cooldown"
                        self._cooldown_until = s.timestamp + 2.0
                    self._on_hits = 0
                    self._off_hits = 0
                    self.active_started = None
                    self.active_peak_w = None
            else:
                self._off_hits = 0
        elif self.phase == "cooldown":
            if s.timestamp >= (self._cooldown_until or s.timestamp):
                self.phase = "request_on"
        return self.result()

    def control_action_consumed(self, action: str, timestamp: float) -> None:
        """Advance the control state after HA has accepted a service command."""
        if self.method != "quick":
            return
        if action == "turn_on" and self.phase == "request_on":
            self.phase = "waiting_for_on"
            self.active_started = timestamp
            self.active_peak_w = None
            self._on_hits = 0
        elif action == "turn_off" and self.phase == "request_off":
            self.phase = "waiting_for_off"
            self._off_hits = 0

    def _quick_valid(self) -> bool:
        values = [o.delta_w for o in self.observations]
        if len(values) != self.cycles_required or min(values) <= 0:
            return False
        center = median(values)
        return max(values) - min(values) <= max(center * 0.15, 10.0)

    def _full_step(self, s: PowerSample) -> dict:
        if self.phase == "waiting_for_start" and s.watts >= self.baseline_w + self.on_threshold_w:
            self.phase = "capturing"
            self.cycle_started = s.timestamp
            self.active_started = s.timestamp
            self.active_peak_w = s.watts
        elif self.phase == "capturing":
            self.active_peak_w = max(self.active_peak_w or s.watts, s.watts)
            active_for = s.timestamp - (self.cycle_started or s.timestamp)
            recent = [x.watts for x in self.samples if x.timestamp >= s.timestamp - self.idle_window_s]
            if active_for >= self.full_cycle_min_active_s and recent and max(abs(v - self.baseline_w) for v in recent) <= self.return_tolerance_w:
                self.completed = True
                self.phase = "complete"
        return self.result()

    def _energy_wh(self) -> float:
        if self.baseline_w is None or len(self.samples) < 2:
            return 0.0
        return sum(max(0.0, ((a.watts-self.baseline_w)+(b.watts-self.baseline_w))/2) * max(0.0,b.timestamp-a.timestamp)/3600 for a,b in zip(self.samples,self.samples[1:]))

    def result(self, *, action: str | None = None, failed: bool = False, failure_reason: str | None = None) -> dict:
        peak_delta = None
        duration = None
        if self.method == "quick" and self.observations:
            peak_delta = median(o.delta_w for o in self.observations)
        elif self.baseline_w is not None:
            peak_delta = max(0.0, max((s.watts for s in self.samples), default=self.baseline_w)-self.baseline_w)
        if self.method == "full_cycle" and self.cycle_started is not None and self.samples:
            duration = max(0.0, self.samples[-1].timestamp-self.cycle_started)
        return {
            "phase": self.phase, "baseline_w": self.baseline_w, "baseline_noise_w": self.baseline_noise_w,
            "on_threshold_w": self.on_threshold_w, "return_tolerance_w": self.return_tolerance_w,
            "peak_delta_w": peak_delta, "events_detected": len(self.observations),
            "cycles_required": self.cycles_required if self.method == "quick" else None,
            "cycles_completed": len(self.observations) if self.method == "quick" else None,
            "observations": [{"delta_w":o.delta_w,"on_w":o.on_w,"off_w":o.off_w,"on_duration_s":o.on_duration_s} for o in self.observations],
            "duration_s": duration, "energy_wh": self._energy_wh(), "completed": self.completed,
            "action": action, "failed": failed, "failure_reason": failure_reason,
        }
