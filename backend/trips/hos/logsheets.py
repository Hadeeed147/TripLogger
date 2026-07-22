from __future__ import annotations
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from .models import DutyStatus, Segment, Timeline


@dataclass
class GridEntry:
    status: DutyStatus
    start_min: int
    end_min: int


@dataclass
class Remark:
    time_min: int
    end_min: int
    location: str
    note: str


@dataclass
class DayLog:
    date: date
    grid: list[GridEntry]
    totals: dict[str, int]
    total_miles: float
    remarks: list[Remark]


def _midnight(dt: datetime) -> datetime:
    return datetime.combine(dt.date(), time.min)


def _snap(minute: float) -> int:
    return int(round(minute / 15.0) * 15)


def _pad(segments: list[Segment]) -> list[Segment]:
    out: list[Segment] = []
    first, last = segments[0], segments[-1]
    day_start = _midnight(first.start)
    if first.start > day_start:
        out.append(Segment(DutyStatus.OFF, day_start, first.start))
    out.extend(segments)
    day_end = _midnight(last.end)
    if last.end > day_end:
        out.append(Segment(DutyStatus.OFF, last.end, day_end + timedelta(days=1)))
    return out


def _split_days(segments: list[Segment]) -> dict[date, list[Segment]]:
    days: dict[date, list[Segment]] = {}
    for seg in segments:
        cur = seg
        while True:
            boundary = _midnight(cur.start) + timedelta(days=1)
            if cur.end <= boundary:
                days.setdefault(cur.start.date(), []).append(cur)
                break
            frac = (boundary - cur.start).total_seconds() / (cur.end - cur.start).total_seconds()
            head_miles = cur.miles * frac
            days.setdefault(cur.start.date(), []).append(
                Segment(cur.status, cur.start, boundary, miles=head_miles,
                        start_odometer=cur.start_odometer, label=cur.label, location=cur.location))
            cur = Segment(cur.status, boundary, cur.end, miles=cur.miles - head_miles,
                          start_odometer=cur.start_odometer + head_miles,
                          label=cur.label, location=cur.location)
    return days


def build_day_logs(timeline: Timeline) -> list[DayLog]:
    if not timeline.segments:
        return []
    days = _split_days(_pad(timeline.segments))
    result: list[DayLog] = []
    for day in sorted(days):
        segs = days[day]
        base = datetime.combine(day, time.min)
        grid: list[GridEntry] = []
        remarks: list[Remark] = []
        prev_end = 0
        for i, s in enumerate(segs):
            start_m = 0 if i == 0 else prev_end
            end_m = 1440 if i == len(segs) - 1 else _snap((s.end - base).total_seconds() / 60.0)
            end_m = max(end_m, start_m)
            if s.label and s.label != "Driving":
                remark_start = min(start_m, 1425)
                remark_end = max(end_m, remark_start)
                remarks.append(Remark(remark_start, remark_end, s.location, s.label))
            if end_m > start_m:
                if grid and grid[-1].status == s.status:
                    grid[-1].end_min = end_m
                else:
                    grid.append(GridEntry(s.status, start_m, end_m))
            prev_end = end_m
        totals = {st.value: 0 for st in DutyStatus}
        for e in grid:
            totals[e.status.value] += e.end_min - e.start_min
        miles = round(sum(s.miles for s in segs), 1)
        result.append(DayLog(day, grid, totals, miles, remarks))
    return result
