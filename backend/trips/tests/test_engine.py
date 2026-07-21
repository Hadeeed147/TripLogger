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
