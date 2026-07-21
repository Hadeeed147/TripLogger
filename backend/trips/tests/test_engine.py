from datetime import datetime
from trips.hos.engine import plan_trip, TripTooLongError
from trips.hos.models import DutyStatus, Leg
import pytest

START = datetime(2026, 7, 21, 8, 0)

def statuses(tl):
    return [(s.status, round(s.minutes)) for s in tl.segments]

def test_short_same_day_trip():
    tl = plan_trip([Leg(60, 60), Leg(120, 120)], 0.0, START)
    assert statuses(tl) == [
        (DutyStatus.DRIVING, 60), (DutyStatus.ON_DUTY, 60),
        (DutyStatus.DRIVING, 120), (DutyStatus.ON_DUTY, 60),
    ]
    assert tl.segments[1].label == "Pickup"
    assert tl.segments[3].label == "Dropoff"
    assert tl.segments[3].end == datetime(2026, 7, 21, 13, 0)
    assert tl.restart_inserted is False

def test_zero_mile_deadhead_emits_no_empty_driving():
    tl = plan_trip([Leg(0, 0), Leg(60, 60)], 0.0, START)
    assert statuses(tl)[0] == (DutyStatus.ON_DUTY, 60)  # pickup first

def test_trip_over_5000_miles_rejected():
    with pytest.raises(TripTooLongError):
        plan_trip([Leg(100, 100), Leg(4950, 4950)], 0.0, START)

def test_odometer_tracks_route_miles():
    tl = plan_trip([Leg(60, 60), Leg(120, 120)], 0.0, START)
    assert tl.segments[2].start_odometer == 60.0
    assert tl.segments[2].end_odometer == 180.0

def test_break_inserted_after_8h_driving():
    # pickup first (0-mi deadhead), then 10h of driving at 55 mph
    tl = plan_trip([Leg(0, 0), Leg(550, 600)], 0.0, START)
    assert statuses(tl) == [
        (DutyStatus.ON_DUTY, 60),          # pickup (resets break accumulator)
        (DutyStatus.DRIVING, 480),         # 8h
        (DutyStatus.OFF, 30),              # 30-min break
        (DutyStatus.DRIVING, 120),
        (DutyStatus.ON_DUTY, 60),          # dropoff
    ]
    assert tl.segments[2].label == "30-min break"

def test_no_break_under_8h_driving():
    tl = plan_trip([Leg(0, 0), Leg(430, 469)], 0.0, START)  # 7h49m driving
    assert all(s.label != "30-min break" for s in tl.segments)

def test_pickup_resets_break_accumulator():
    # 7h drive, 1h pickup (resets the 8h accumulator), 7h drive: no break ever needed
    tl = plan_trip([Leg(420, 420), Leg(420, 420)], 0.0, START)
    assert all(s.label != "30-min break" for s in tl.segments)

def test_rest_after_11h_driving_and_resume():
    # pickup, 8h drive, break, 3h drive (11h cap), 10h rest, 40min drive, dropoff
    tl = plan_trip([Leg(0, 0), Leg(700, 700)], 0.0, START)
    assert statuses(tl) == [
        (DutyStatus.ON_DUTY, 60),
        (DutyStatus.DRIVING, 480),
        (DutyStatus.OFF, 30),
        (DutyStatus.DRIVING, 180),
        (DutyStatus.SLEEPER, 600),
        (DutyStatus.DRIVING, 40),
        (DutyStatus.ON_DUTY, 60),
    ]
    assert tl.segments[4].label == "10-hour rest"

def test_14h_window_blocks_driving():
    # White-box: window nearly exhausted, plenty of drive hours left.
    from trips.hos.engine import _Planner
    p = _Planner(0.0, START)
    p.shift_open = True
    p.window_elapsed = 825.0  # 13h45m into window
    p.drive_leg(Leg(100, 100))
    assert (p.segments[0].status, round(p.segments[0].minutes)) == (DutyStatus.DRIVING, 15)
    assert p.segments[1].label == "10-hour rest"

def test_rest_resets_all_shift_accumulators():
    tl = plan_trip([Leg(0, 0), Leg(1320, 1320)], 0.0, START)
    # After first rest the driver gets a fresh 8h-before-break allowance
    rest_idx = next(i for i, s in enumerate(tl.segments) if s.label == "10-hour rest")
    post = tl.segments[rest_idx + 1]
    assert post.status == DutyStatus.DRIVING
    assert post.minutes > 300  # not immediately re-broken

def test_no_fuel_stop_under_1000_miles():
    tl = plan_trip([Leg(0, 0), Leg(999, 999)], 0.0, START)
    assert all(s.label != "Fuel stop" for s in tl.segments)

def test_fuel_stop_at_1000_miles_and_accumulator_carries_across_rest():
    tl = plan_trip([Leg(0, 0), Leg(1100, 1100)], 0.0, START)
    fuels = [s for s in tl.segments if s.label == "Fuel stop"]
    assert len(fuels) == 1
    assert abs(fuels[0].start_odometer - 1000.0) < 0.5
    assert fuels[0].status == DutyStatus.ON_DUTY

def test_fuel_stop_satisfies_30min_break():
    # Fuel at 1000mi lands when 440 min of driving accumulated since rest;
    # afterwards driver continues 100mi with no extra break even though
    # cumulative driving since the last OFF-break would exceed 8h.
    tl = plan_trip([Leg(0, 0), Leg(1100, 1100)], 0.0, START)
    fuel_idx = next(i for i, s in enumerate(tl.segments) if s.label == "Fuel stop")
    tail = tl.segments[fuel_idx + 1:]
    assert all(s.label != "30-min break" for s in tail)

def test_cycle_69_forces_restart_before_driving():
    tl = plan_trip([Leg(0, 0), Leg(60, 60)], 69.0, START)
    # pickup consumes the last hour of cycle; restart precedes any driving
    assert statuses(tl) == [
        (DutyStatus.ON_DUTY, 60),
        (DutyStatus.OFF, 2040),
        (DutyStatus.DRIVING, 60),
        (DutyStatus.ON_DUTY, 60),
    ]
    assert tl.restart_inserted is True
    assert tl.segments[1].label == "34-hour restart"

def test_cycle_70_restarts_immediately():
    tl = plan_trip([Leg(60, 60), Leg(0, 0)], 70.0, START)
    assert tl.segments[0].label == "34-hour restart"

def test_cycle_0_no_restart_on_long_trip():
    tl = plan_trip([Leg(0, 0), Leg(2000, 2000)], 0.0, START)
    assert tl.restart_inserted is False

def test_timeline_invariants_across_scenarios():
    scenarios = [
        ([Leg(60, 60), Leg(120, 120)], 0.0),
        ([Leg(0, 0), Leg(550, 600)], 0.0),
        ([Leg(0, 0), Leg(2789, 3043)], 12.5),   # ~LA->NY at 55mph
        ([Leg(300, 327), Leg(2400, 2618)], 45.0),
        ([Leg(0, 0), Leg(60, 60)], 69.5),
    ]
    for legs, cycle in scenarios:
        tl = plan_trip(legs, cycle, START)
        segs = tl.segments
        # contiguous, non-overlapping, positive
        for a, b in zip(segs, segs[1:]):
            assert a.end == b.start
        assert all(s.minutes > 0 for s in segs)
        # miles conserved
        assert abs(sum(s.miles for s in segs) - sum(l.miles for l in legs)) < 0.01
        # no driving stretch violates 11h without an intervening rest
        drive_acc = 0.0
        for s in segs:
            if s.status == DutyStatus.DRIVING:
                drive_acc += s.minutes
                assert drive_acc <= 660.0 + 1e-6
            elif s.label in ("10-hour rest", "34-hour restart"):
                drive_acc = 0.0
