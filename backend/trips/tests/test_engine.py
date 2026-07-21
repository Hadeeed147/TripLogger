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
