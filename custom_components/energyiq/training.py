"""Deterministic power-signature training engine."""
from __future__ import annotations
from dataclasses import dataclass, field
from statistics import median, pstdev
from typing import Literal

Method = Literal["quick", "full_cycle", "manual"]

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
    baseline_window_s: float = 3.0
    min_event_w: float = 12.0
    stable_window_s: float = 5.0
    quick_on_measurement_s: float = 5.0
    quick_off_settle_s: float = 1.5
    quick_capture_lead_s: float = 0.25
    return_tolerance_w: float = 25.0
    max_quick_duration_s: float = 120.0
    max_full_cycle_duration_s: float = 8 * 3600.0
    full_cycle_min_active_s: float = 30.0
    full_cycle_settle_s: float = 5.0
    full_cycle_stability_tolerance_w: float = 0.08
    manual_min_active_s: float = 5.0
    idle_window_s: float = 5.0
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
    _on_samples: list[float] = field(default_factory=list)
    _off_samples: list[float] = field(default_factory=list)
    _on_capture_w: float | None = None
    cycles_required: int = 3
    _end_requested: bool = False
    _full_active_samples: list[PowerSample] = field(default_factory=list)
    _full_capture_valid: bool = False
    _full_stable_load_w: float | None = None
    _full_stability_range_w: float | None = None

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
        if self.method == "manual":
            return self._manual_step(s)
        return self._full_step(s)

    def _quick_step(self, s: PowerSample) -> dict:
        if self.phase == "request_on":
            return self.result(action="turn_on")
        if self.phase == "waiting_for_on":
            self._on_samples.append(s.watts)
            if self.active_started is not None and self._on_capture_w is None and s.timestamp - self.active_started >= max(0.0, self.quick_on_measurement_s - self.quick_capture_lead_s):
                self._on_capture_w = s.watts
            if self.active_started is not None and s.timestamp - self.active_started >= self.quick_on_measurement_s:
                self.phase = "request_off"
        elif self.phase == "request_off":
            return self.result(action="turn_off")
        elif self.phase == "waiting_for_off":
            self._off_samples.append(s.watts)
            if self.active_started is not None and s.timestamp - self.active_started >= self.quick_off_settle_s:
                on_w = self._on_capture_w if self._on_capture_w is not None else (self._on_samples[-1] if self._on_samples else (self.baseline_w or s.watts))
                off_w = self._off_samples[-1] if self._off_samples else s.watts
                delta = max(0.0, on_w - off_w)
                duration = max(0.0, s.timestamp - (self.cycle_started or s.timestamp))
                self.observations.append(QuickObservation(delta, on_w, off_w, duration))
                if len(self.observations) >= self.cycles_required:
                    self.completed = self._quick_valid()
                    self.phase = "complete" if self.completed else "error"
                    if not self.completed:
                        return self.result(failed=True, failure_reason="The three ON/OFF measurements were not consistent enough to save a signature.")
                else:
                    self.phase = "cooldown"
                    self._cooldown_until = s.timestamp + 0.5
                self._on_hits = 0; self._off_hits = 0; self.active_started = None; self.cycle_started = None; self.active_peak_w = None
                self._on_samples.clear(); self._off_samples.clear(); self._on_capture_w = None
        elif self.phase == "cooldown" and s.timestamp >= (self._cooldown_until or s.timestamp):
            self.phase = "request_on"
        return self.result()

    def control_action_consumed(self, action: str, timestamp: float) -> None:
        if self.method != "quick":
            return
        if action == "turn_on" and self.phase == "request_on":
            self.phase = "waiting_for_on"; self.active_started = timestamp; self.cycle_started = timestamp; self.active_peak_w = None
            self._on_samples.clear(); self._off_samples.clear(); self._on_capture_w = None; self._on_hits = 0
        elif action == "turn_off" and self.phase == "request_off":
            self.phase = "waiting_for_off"; self.active_started = timestamp; self._off_samples.clear(); self._off_hits = 0

    def _quick_valid(self) -> bool:
        values = [o.delta_w for o in self.observations]
        return len(values) == self.cycles_required and any(value > 0.0 for value in values)

    def _manual_step(self, s: PowerSample) -> dict:
        if self.phase == "waiting_for_start":
            if s.watts >= (self.baseline_w or s.watts) + self.on_threshold_w:
                self.phase = "capturing"; self.cycle_started = s.timestamp; self.active_started = s.timestamp; self.active_peak_w = s.watts
            return self.result()
        if self.phase == "capturing":
            self.active_peak_w = max(self.active_peak_w or s.watts, s.watts)
            active_for = s.timestamp - (self.cycle_started or s.timestamp)
            recent = [x.watts for x in self.samples if x.timestamp >= s.timestamp - self.idle_window_s]
            if active_for >= self.manual_min_active_s and recent and max(abs(v - (self.baseline_w or v)) for v in recent) <= self.return_tolerance_w:
                self.phase = "validating"
            return self.result()
        if self.phase == "validating":
            recent = [x.watts for x in self.samples if x.timestamp >= s.timestamp - self.idle_window_s]
            if recent and max(abs(v - (self.baseline_w or v)) for v in recent) <= self.return_tolerance_w:
                self.completed = True; self.phase = "complete"
            elif self.active_peak_w is not None and s.watts > (self.baseline_w or s.watts) + self.on_threshold_w:
                self.phase = "capturing"
            return self.result()
        return self.result()

    def _full_step(self, s: PowerSample) -> dict:
        # Full Cycle is deliberately controlled: never infer a start from a
        # power rise.  The baseline is captured first, then the user turns the
        # load on and explicitly starts capture.
        if self.phase == "waiting_for_start":
            return self.result()
        if self.phase == "capturing":
            self._full_active_samples.append(s)
            self.active_peak_w = max(self.active_peak_w or s.watts, s.watts)
            self._update_full_stability(s.timestamp)
        return self.result()

    def _update_full_stability(self, timestamp: float) -> None:
        if self.baseline_w is None or self.cycle_started is None:
            self._full_capture_valid = False
            return
        active_for = timestamp - self.cycle_started
        recent = [x.watts for x in self._full_active_samples if x.timestamp >= timestamp - self.stable_window_s]
        if not recent:
            self._full_capture_valid = False
            return
        load_values = [max(0.0, v - self.baseline_w) for v in recent]
        center = median(load_values)
        spread = max(load_values) - min(load_values)
        self._full_stable_load_w = center
        self._full_stability_range_w = spread
        tolerance = max(15.0, center * self.full_cycle_stability_tolerance_w)
        self._full_capture_valid = active_for >= self.stable_window_s and spread <= tolerance and center >= self.min_event_w

    def confirm_full_cycle(self, accepted: bool, timestamp: float) -> dict:
        if self.method != "full_cycle" or self.phase not in {"awaiting_confirmation", "waiting_for_start"}:
            return self.result(failed=True, failure_reason="Long-cycle training is not waiting to start or confirm an event.")
        if accepted:
            # Explicit user action starts the measurement.  The baseline is
            # already fixed, so the target may be ON at this point without
            # contaminating the baseline.
            self.phase = "capturing"
            self._end_requested = False
            self.cycle_started = timestamp
            self.active_started = timestamp
            current = self.samples[-1] if self.samples else PowerSample(timestamp, self.baseline_w or 0.0)
            self.active_peak_w = current.watts
            self._full_active_samples = [current]
            self._full_capture_valid = False
            self._full_stable_load_w = None
            self._full_stability_range_w = None
            return self.result()
        self.phase = "waiting_for_start"
        self.cycle_started = None; self.active_started = None; self.active_peak_w = None
        self._full_active_samples.clear(); self._full_capture_valid = False
        self._full_stable_load_w = None; self._full_stability_range_w = None
        return self.result()

    def end_full_cycle(self, force: bool = False) -> dict:
        if self.method != "full_cycle" or self.phase != "capturing":
            return self.result(failed=True, failure_reason="Long-cycle training is not currently capturing a confirmed load.")
        self._end_requested = True
        self._update_full_stability(self.samples[-1].timestamp if self.samples else (self.cycle_started or 0.0))
        duration = max(0.0, self.samples[-1].timestamp - (self.cycle_started or self.samples[-1].timestamp)) if self.samples else 0.0
        if not force and not self._full_capture_valid:
            self._end_requested = False
            return self.result(action="end_warning", end_ready=False, end_returned=False, end_duration_s=duration)
        self.completed = True; self.phase = "complete"
        return self.result()

    def _energy_wh(self) -> float:
        if self.baseline_w is None or len(self.samples) < 2: return 0.0
        return sum(max(0.0, ((a.watts-self.baseline_w)+(b.watts-self.baseline_w))/2) * max(0.0,b.timestamp-a.timestamp)/3600 for a,b in zip(self.samples,self.samples[1:]))

    def result(self, *, action: str | None = None, failed: bool = False, failure_reason: str | None = None, **extra) -> dict:
        peak_delta = None; duration = None
        if self.method == "quick" and self.observations:
            peak_delta = median(o.delta_w for o in self.observations)
        elif self.baseline_w is not None and self.method == "full_cycle" and self.phase in {"capturing", "complete"}:
            if self._full_stable_load_w is not None:
                peak_delta = self._full_stable_load_w
            else:
                active = self._full_active_samples or self.samples
                values = [max(0.0, x.watts - self.baseline_w) for x in active]
                peak_delta = median(values) if values else 0.0
        elif self.baseline_w is not None:
            peak_delta = max(0.0, max((s.watts for s in self.samples), default=self.baseline_w)-self.baseline_w)
        if self.method in {"full_cycle", "manual"} and self.cycle_started is not None and self.samples:
            duration = max(0.0, self.samples[-1].timestamp-self.cycle_started)
        instruction = None
        if self.method == "full_cycle":
            if self.phase == "waiting_for_start": instruction = "Baseline captured. Turn the load ON, wait for it to reach its normal operating state, then press Start Power Capture."
            elif self.phase == "capturing": instruction = "Capturing power. Leave the load ON. The Wattage cell turns green when the capture is stable and valid; then press Stop & Save."
            elif self.phase == "complete": instruction = "Training Complete. The stable Full Cycle load was captured and saved."
        return {
            "phase": self.phase, "baseline_w": self.baseline_w, "baseline_noise_w": self.baseline_noise_w,
            "on_threshold_w": self.on_threshold_w, "return_tolerance_w": self.return_tolerance_w,
            "peak_delta_w": peak_delta, "events_detected": len(self.observations),
            "cycles_required": self.cycles_required if self.method == "quick" else None,
            "cycles_completed": len(self.observations) if self.method == "quick" else None,
            "observations": [{"delta_w":o.delta_w,"on_w":o.on_w,"off_w":o.off_w,"on_duration_s":o.on_duration_s} for o in self.observations],
            "duration_s": duration, "energy_wh": self._energy_wh(), "completed": self.completed,
            "capture_valid": self._full_capture_valid if self.method == "full_cycle" else None,
            "stable_load_w": self._full_stable_load_w if self.method == "full_cycle" else None,
            "stability_range_w": self._full_stability_range_w if self.method == "full_cycle" else None,
            "instruction": instruction, "action": action, "failed": failed, "failure_reason": failure_reason, **extra,
        }
