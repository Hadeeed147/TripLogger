from datetime import datetime

from trips.hos.models import DutyStatus, Segment


def test_segment_minutes_and_end_odometer():
    s = Segment(DutyStatus.DRIVING, datetime(2026, 7, 21, 8), datetime(2026, 7, 21, 9, 30),
                miles=90.0, start_odometer=10.0)
    assert s.minutes == 90.0
    assert s.end_odometer == 100.0
