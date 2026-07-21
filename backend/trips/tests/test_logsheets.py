from datetime import datetime
from trips.hos.models import DutyStatus, Segment, Timeline
from trips.hos.logsheets import build_day_logs

def seg(status, start, end, miles=0.0, label=""):
    return Segment(status, start, end, miles=miles, label=label)

def test_single_day_padding_and_totals():
    tl = Timeline([
        seg(DutyStatus.DRIVING, datetime(2026, 7, 21, 8), datetime(2026, 7, 21, 10), miles=120, label="Driving"),
        seg(DutyStatus.ON_DUTY, datetime(2026, 7, 21, 10), datetime(2026, 7, 21, 11), label="Pickup"),
    ])
    days = build_day_logs(tl)
    assert len(days) == 1
    d = days[0]
    assert d.grid[0].status == DutyStatus.OFF and d.grid[0].start_min == 0
    assert d.grid[-1].end_min == 1440
    assert sum(d.totals.values()) == 1440
    assert d.totals["driving"] == 120 and d.totals["on_duty"] == 60
    assert d.total_miles == 120.0

def test_midnight_split_prorates_miles():
    tl = Timeline([
        seg(DutyStatus.DRIVING, datetime(2026, 7, 21, 23), datetime(2026, 7, 22, 1), miles=110, label="Driving"),
    ])
    days = build_day_logs(tl)
    assert len(days) == 2
    assert days[0].total_miles == 55.0 and days[1].total_miles == 55.0
    assert days[0].totals["driving"] == 60 and days[1].totals["driving"] == 60

def test_snap_to_quarter_hour():
    tl = Timeline([
        seg(DutyStatus.DRIVING, datetime(2026, 7, 21, 8, 7), datetime(2026, 7, 21, 9, 8), miles=60, label="Driving"),
    ])
    d = build_day_logs(tl)[0]
    drv = next(e for e in d.grid if e.status == DutyStatus.DRIVING)
    assert drv.start_min == 480 and drv.end_min == 555  # 08:07→08:00, 09:08→09:15
    assert sum(d.totals.values()) == 1440

def test_remarks_carry_labels_and_locations():
    tl = Timeline([
        seg(DutyStatus.DRIVING, datetime(2026, 7, 21, 8), datetime(2026, 7, 21, 9), miles=60, label="Driving"),
        Segment(DutyStatus.ON_DUTY, datetime(2026, 7, 21, 9), datetime(2026, 7, 21, 10),
                label="Pickup", location="Denver, CO"),
    ])
    d = build_day_logs(tl)[0]
    assert any(r.note == "Pickup" and r.location == "Denver, CO" and r.time_min == 540
               for r in d.remarks)

def test_multiday_rest_spans_midnight():
    tl = Timeline([
        seg(DutyStatus.DRIVING, datetime(2026, 7, 21, 12), datetime(2026, 7, 21, 22), miles=550, label="Driving"),
        seg(DutyStatus.SLEEPER, datetime(2026, 7, 21, 22), datetime(2026, 7, 22, 8), label="10-hour rest"),
        seg(DutyStatus.DRIVING, datetime(2026, 7, 22, 8), datetime(2026, 7, 22, 9), miles=55, label="Driving"),
    ])
    days = build_day_logs(tl)
    assert len(days) == 2
    assert days[0].totals["sleeper"] == 120 and days[1].totals["sleeper"] == 480
    for d in days:
        assert sum(d.totals.values()) == 1440
        for a, b in zip(d.grid, d.grid[1:]):
            assert a.end_min == b.start_min
