from __future__ import annotations
from datetime import datetime, timedelta
from .models import DutyStatus, Leg, Segment, Timeline

MAX_DRIVE_MIN = 660.0
WINDOW_MIN = 840.0
DRIVE_BEFORE_BREAK_MIN = 480.0
BREAK_MIN = 30.0
REST_MIN = 600.0
RESTART_MIN = 2040.0
CYCLE_MIN = 4200.0
FUEL_INTERVAL_MILES = 1000.0
FUEL_STOP_MIN = 30.0
SERVICE_STOP_MIN = 60.0
MAX_TRIP_MILES = 5000.0
EPS = 1e-6


class TripTooLongError(ValueError):
    pass


class _Planner:
    def __init__(self, cycle_used_min: float, start: datetime):
        self.now = start
        self.segments: list[Segment] = []
        self.odometer = 0.0
        self.drive_since_break = 0.0
        self.drive_since_rest = 0.0
        self.window_elapsed = 0.0
        self.shift_open = False          # becomes True at first on-duty/driving after a rest
        self.cycle_used = cycle_used_min
        self.next_fuel_at = FUEL_INTERVAL_MILES
        self.restart_inserted = False

    # -- emit helpers ------------------------------------------------------
    def _emit(self, status: DutyStatus, minutes: float, miles: float = 0.0, label: str = "") -> None:
        if minutes <= EPS:
            return
        seg = Segment(status, self.now, self.now + timedelta(minutes=minutes),
                      miles=miles, start_odometer=self.odometer, label=label)
        self.segments.append(seg)
        self.now = seg.end
        self.odometer += miles

    def _open_shift(self) -> None:
        if not self.shift_open:
            self.shift_open = True
            self.window_elapsed = 0.0

    # -- duty events -------------------------------------------------------
    def rest(self) -> None:
        self._emit(DutyStatus.SLEEPER, REST_MIN, label="10-hour rest")
        self.drive_since_rest = 0.0
        self.drive_since_break = 0.0
        self.shift_open = False

    def restart(self) -> None:
        self._emit(DutyStatus.OFF, RESTART_MIN, label="34-hour restart")
        self.cycle_used = 0.0
        self.drive_since_rest = 0.0
        self.drive_since_break = 0.0
        self.shift_open = False
        self.restart_inserted = True

    def take_break(self) -> None:
        self._emit(DutyStatus.OFF, BREAK_MIN, label="30-min break")
        self.drive_since_break = 0.0
        if self.shift_open:
            self.window_elapsed += BREAK_MIN

    def on_duty_stop(self, minutes: float, label: str) -> None:
        self._open_shift()
        self._emit(DutyStatus.ON_DUTY, minutes, label=label)
        self.cycle_used += minutes
        self.window_elapsed += minutes
        if minutes >= BREAK_MIN:
            self.drive_since_break = 0.0

    # -- driving loop ------------------------------------------------------
    def _ensure_can_drive(self) -> None:
        while True:
            if CYCLE_MIN - self.cycle_used <= EPS:
                self.restart()
                continue
            if MAX_DRIVE_MIN - self.drive_since_rest <= EPS:
                self.rest()
                continue
            if self.shift_open and WINDOW_MIN - self.window_elapsed <= EPS:
                self.rest()
                continue
            if DRIVE_BEFORE_BREAK_MIN - self.drive_since_break <= EPS:
                self.take_break()
                continue
            return

    def drive_leg(self, leg: Leg) -> None:
        speed = leg.miles / leg.minutes  # miles per minute
        remaining_miles = leg.miles
        while remaining_miles > EPS:
            if self.odometer >= self.next_fuel_at - EPS:
                self.on_duty_stop(FUEL_STOP_MIN, "Fuel stop")
                self.next_fuel_at += FUEL_INTERVAL_MILES
            self._ensure_can_drive()
            chunk = min(
                remaining_miles / speed,
                MAX_DRIVE_MIN - self.drive_since_rest,
                (WINDOW_MIN - self.window_elapsed) if self.shift_open else WINDOW_MIN,
                DRIVE_BEFORE_BREAK_MIN - self.drive_since_break,
                CYCLE_MIN - self.cycle_used,
                (self.next_fuel_at - self.odometer) / speed,
            )
            self._open_shift()
            miles = chunk * speed
            self._emit(DutyStatus.DRIVING, chunk, miles=miles, label="Driving")
            self.drive_since_rest += chunk
            self.drive_since_break += chunk
            self.window_elapsed += chunk
            self.cycle_used += chunk
            remaining_miles -= miles


def plan_trip(legs: list[Leg], cycle_used_hrs: float, start: datetime) -> Timeline:
    total = sum(leg.miles for leg in legs)
    if total > MAX_TRIP_MILES:
        raise TripTooLongError(
            f"Trip is {total:.0f} route-miles; TripLogger supports up to {MAX_TRIP_MILES:.0f}."
        )
    p = _Planner(cycle_used_hrs * 60.0, start)
    for leg, stop_label in zip(legs, ("Pickup", "Dropoff")):
        if leg.miles > EPS:
            p.drive_leg(leg)
        p.on_duty_stop(SERVICE_STOP_MIN, stop_label)
    return Timeline(segments=p.segments, restart_inserted=p.restart_inserted)
