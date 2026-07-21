# TripLogger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Django + React app that takes trip inputs (locations + cycle hours) and outputs an interactive route map with HOS-mandated stops plus FMCSA ELD daily log sheets drawn as SVG.

**Architecture:** Pure-Python HOS engine (`trips/hos/`, no Django imports) consumed by a single `POST /api/trips` DRF endpoint that geocodes (Nominatim), routes (OSRM), plans the duty timeline, and returns route + stops + segments + per-day log grids in one JSON payload. React/Vite frontend renders map (react-leaflet), stat cards, and an SVG replica of the official paper log.

**Tech Stack:** Python 3.13, Django 5, DRF, requests, pytest; React 18 + Vite + TypeScript, react-leaflet, GSAP. Deploy: Render (backend) + Vercel (frontend).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-21-triplogger-design.md` — authoritative for all rules.
- HOS constants (minutes/miles, exact): drive limit 660, window 840, break-after-drive 480, break 30, rest 600, restart 2040, cycle 4200, fuel interval 1000 mi, fuel stop 30, pickup/dropoff service 60. Max trip 5,000 route-miles.
- Any ≥30 min consecutive non-driving period resets the 8-hour break accumulator.
- Cycle budget = `70h − current_cycle_used`, replenished ONLY by auto-inserted 34 h restart. `restart_inserted` surfaced in summary.
- Duty-status → grid-row mapping: 10 h rest → `sleeper`; 30 min break → `off`; 34 h restart → `off`; pickup/dropoff/fuel → `on_duty`.
- Truck duration floor: `minutes = max(provider_minutes, miles / 55 * 60)` applied per leg in routing service.
- All engine datetimes are naive "home terminal time". Log grids are 15-min snapped and every day totals exactly 1440 min.
- No live network in tests — mock Nominatim/OSRM with `monkeypatch`.
- Nominatim: custom `User-Agent: TripLogger/1.0 (mohammadhadeed8@gmail.com)`, server-side only, cached via Django locmem cache.
- Commits: conventional messages (`feat:`, `test:`, `chore:`, `docs:`), one per task minimum, each ends with the Claude co-author trailer.
- Backend venv lives at `backend/.venv` (root `Lib/`+`Scripts/` are a stray venv, already gitignored — ignore them).
- Frontend styling decisions during Tasks 13–17 MUST be made by invoking the `design-taste-frontend` skill; motion via `gsap-react` skill; component baselines may come from 21st.dev MCP (`mcp__21st__search`). Palette tokens: navy `#1B2A5E` primary, signal blue `#2F6FED` accent, Inter, `font-variant-numeric: tabular-nums` on all figures.

---

### Task 1: Backend scaffold

**Files:**
- Create: `backend/requirements.txt`, `backend/pytest.ini`, `backend/config/*` (startproject), `backend/trips/*` (startapp)

**Interfaces:**
- Produces: Django project `config`, app `trips` registered, `pytest` green from `backend/`.

- [ ] **Step 1: Create venv + install deps**

```bash
cd /d/Projects/TripLogger
python -m venv backend/.venv
backend/.venv/Scripts/python -m pip install --upgrade pip
```

Create `backend/requirements.txt`:

```
Django>=5.0,<6
djangorestframework>=3.15
django-cors-headers>=4.4
requests>=2.32
gunicorn>=22
whitenoise>=6.7
pytest>=8
pytest-django>=4.8
```

```bash
backend/.venv/Scripts/python -m pip install -r backend/requirements.txt
```

- [ ] **Step 2: Scaffold project + app**

```bash
cd backend
.venv/Scripts/django-admin startproject config .
.venv/Scripts/python manage.py startapp trips
mkdir -p trips/hos trips/services trips/tests
touch trips/hos/__init__.py trips/services/__init__.py trips/tests/__init__.py
rm trips/tests.py trips/models.py trips/admin.py
```

In `config/settings.py`: add `"rest_framework"`, `"corsheaders"`, `"trips"` to `INSTALLED_APPS`; add `"corsheaders.middleware.CorsMiddleware"` at top of `MIDDLEWARE`; append:

```python
CORS_ALLOW_ALL_ORIGINS = True  # tightened in Task 18
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
```

Create `backend/pytest.ini`:

```ini
[pytest]
DJANGO_SETTINGS_MODULE = config.settings
python_files = test_*.py
testpaths = trips/tests
```

- [ ] **Step 3: Smoke test**

`trips/tests/test_smoke.py`:

```python
def test_math():
    assert 1 + 1 == 2
```

Run: `.venv/Scripts/python -m pytest -q` → Expected: `1 passed`.

- [ ] **Step 4: Commit**

```bash
git add backend/ && git commit -m "chore: scaffold Django backend with DRF, pytest"
```

---

### Task 2: HOS dataclasses

**Files:**
- Create: `backend/trips/hos/models.py`
- Test: `backend/trips/tests/test_hos_models.py`

**Interfaces:**
- Produces (exact, used by every later backend task):

```python
class DutyStatus(str, Enum): OFF="off"; SLEEPER="sleeper"; DRIVING="driving"; ON_DUTY="on_duty"

@dataclass(frozen=True)
class Leg:            # one routed hop
    miles: float
    minutes: float

@dataclass
class Segment:
    status: DutyStatus
    start: datetime          # naive terminal time
    end: datetime
    miles: float = 0.0       # driven during this segment (0 for stops)
    start_odometer: float = 0.0   # route-miles from origin at segment start
    label: str = ""          # "Driving"|"Pickup"|"Dropoff"|"Fuel stop"|"30-min break"|"10-hour rest"|"34-hour restart"
    location: str = ""       # city/state; filled by API layer
    # properties: minutes (float), end_odometer (float)

@dataclass
class Timeline:
    segments: list[Segment]
    restart_inserted: bool = False
```

- [ ] **Step 1: Write failing test** — `trips/tests/test_hos_models.py`:

```python
from datetime import datetime
from trips.hos.models import DutyStatus, Segment

def test_segment_minutes_and_end_odometer():
    s = Segment(DutyStatus.DRIVING, datetime(2026, 7, 21, 8), datetime(2026, 7, 21, 9, 30),
                miles=90.0, start_odometer=10.0)
    assert s.minutes == 90.0
    assert s.end_odometer == 100.0
```

- [ ] **Step 2: Run** `.venv/Scripts/python -m pytest trips/tests/test_hos_models.py -q` → FAIL (ModuleNotFoundError).

- [ ] **Step 3: Implement** `trips/hos/models.py` exactly per the Interfaces block above, with:

```python
    @property
    def minutes(self) -> float:
        return (self.end - self.start).total_seconds() / 60.0

    @property
    def end_odometer(self) -> float:
        return self.start_odometer + self.miles
```

- [ ] **Step 4: Run** same command → PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: HOS domain dataclasses"`

---

### Task 3: Engine — basic trip flow (drive, pickup, dropoff)

**Files:**
- Create: `backend/trips/hos/engine.py`
- Test: `backend/trips/tests/test_engine.py`

**Interfaces:**
- Produces: `plan_trip(legs: list[Leg], cycle_used_hrs: float, start: datetime) -> Timeline` and `TripTooLongError(ValueError)`. Constants module-level, names exactly: `MAX_DRIVE_MIN=660, WINDOW_MIN=840, DRIVE_BEFORE_BREAK_MIN=480, BREAK_MIN=30, REST_MIN=600, RESTART_MIN=2040, CYCLE_MIN=4200, FUEL_INTERVAL_MILES=1000.0, FUEL_STOP_MIN=30, SERVICE_STOP_MIN=60, MAX_TRIP_MILES=5000.0, EPS=1e-6`.

- [ ] **Step 1: Failing tests** — `trips/tests/test_engine.py`:

```python
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
```

- [ ] **Step 2: Run** → FAIL (no engine module).

- [ ] **Step 3: Implement** `trips/hos/engine.py` (complete file — later tasks only make its limit branches reachable, the structure is final now):

```python
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
```

- [ ] **Step 4: Run** `.venv/Scripts/python -m pytest trips/tests/test_engine.py -q` → 4 passed.
- [ ] **Step 5: Commit** `git commit -am "feat: HOS engine core trip flow"`

---

### Task 4: Engine — 30-minute break rule

**Files:**
- Modify: none expected (branches exist); Test: append to `backend/trips/tests/test_engine.py`

**Interfaces:**
- Consumes: `plan_trip`, constants from Task 3.

- [ ] **Step 1: Failing tests** (append):

```python
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
```

- [ ] **Step 2: Run** → these should PASS already if Task 3 was implemented exactly as written (the branches exist). If any fail, fix `engine.py` — do NOT weaken assertions.
- [ ] **Step 3: Commit** `git commit -am "test: 30-minute break rule coverage"`

---

### Task 5: Engine — 11-hour / 14-hour limits and 10-hour rest

**Files:**
- Test: append to `backend/trips/tests/test_engine.py`

- [ ] **Step 1: Failing tests** (append):

```python
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
```

Note for the 1,320-mile case: fuel fires at 1,000 mi — the third assertion only checks the first post-rest driving chunk is long, which holds (340 min to the fuel stop).

- [ ] **Step 2: Run** → all PASS with Task 3 code (branches already exist); fix engine if not.
- [ ] **Step 3: Commit** `git commit -am "test: 11h/14h limits and 10h rest coverage"`

---

### Task 6: Engine — fuel stops and break-merge rule

**Files:**
- Test: append to `backend/trips/tests/test_engine.py`

- [ ] **Step 1: Failing tests** (append):

```python
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
```

- [ ] **Step 2: Run** → PASS (branches exist); fix engine if not.
- [ ] **Step 3: Commit** `git commit -am "test: fuel scheduling and break-merge rule"`

---

### Task 7: Engine — 70-hour cycle and 34-hour restart

**Files:**
- Test: append to `backend/trips/tests/test_engine.py`

- [ ] **Step 1: Failing tests** (append):

```python
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
```

- [ ] **Step 2: Run** `.venv/Scripts/python -m pytest trips/tests/test_engine.py -q` → all PASS; debug engine against spec if not (use superpowers:systematic-debugging).
- [ ] **Step 3: Commit** `git commit -am "test: cycle exhaustion, 34h restart, timeline invariants"`

---

### Task 8: Route polyline interpolation

**Files:**
- Create: `backend/trips/services/polyline.py`
- Test: `backend/trips/tests/test_polyline.py`

**Interfaces:**
- Produces: `point_at_mile(geometry: list[tuple[float, float]], mile: float) -> tuple[float, float]` — geometry is `[(lat, lng), ...]`; clamps to endpoints; linear interpolation between vertices by haversine distance. Also `total_miles(geometry) -> float`.

- [ ] **Step 1: Failing test** — `trips/tests/test_polyline.py`:

```python
from trips.services.polyline import point_at_mile, total_miles

# ~69.1 miles per degree of latitude; two-point north-south line
GEOM = [(35.0, -100.0), (36.0, -100.0)]

def test_total_miles_close_to_69():
    assert abs(total_miles(GEOM) - 69.1) < 0.5

def test_midpoint():
    lat, lng = point_at_mile(GEOM, total_miles(GEOM) / 2)
    assert abs(lat - 35.5) < 0.01 and abs(lng + 100.0) < 0.01

def test_clamps_beyond_ends():
    assert point_at_mile(GEOM, -5) == GEOM[0]
    assert point_at_mile(GEOM, 10_000) == GEOM[-1]
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement:**

```python
from __future__ import annotations
import math

EARTH_MILES = 3958.8


def _haversine(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lng1, lat2, lng2 = map(math.radians, (*a, *b))
    h = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2)
    return 2 * EARTH_MILES * math.asin(math.sqrt(h))


def total_miles(geometry: list[tuple[float, float]]) -> float:
    return sum(_haversine(a, b) for a, b in zip(geometry, geometry[1:]))


def point_at_mile(geometry: list[tuple[float, float]], mile: float) -> tuple[float, float]:
    if mile <= 0:
        return geometry[0]
    acc = 0.0
    for a, b in zip(geometry, geometry[1:]):
        d = _haversine(a, b)
        if acc + d >= mile and d > 0:
            f = (mile - acc) / d
            return (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)
        acc += d
    return geometry[-1]
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `git commit -am "feat: polyline mile interpolation"`

---

### Task 9: Log sheet builder (midnight split, snap, pad, totals)

**Files:**
- Create: `backend/trips/hos/logsheets.py`
- Test: `backend/trips/tests/test_logsheets.py`

**Interfaces:**
- Produces:

```python
@dataclass
class GridEntry:
    status: DutyStatus
    start_min: int   # 0..1440, multiples of 15
    end_min: int

@dataclass
class Remark:
    time_min: int
    location: str
    note: str        # segment label

@dataclass
class DayLog:
    date: date
    grid: list[GridEntry]        # covers exactly 0..1440, contiguous
    totals: dict[str, int]       # minutes per status value ("off", ...), sums to 1440
    total_miles: float
    remarks: list[Remark]

def build_day_logs(timeline: Timeline) -> list[DayLog]
```

Algorithm: 1) pad timeline with leading OFF from midnight of day one to first segment start, and trailing OFF to midnight after last segment end; 2) split every segment at midnight boundaries, prorating `miles` by time fraction; 3) per day, snap each boundary to `round(minute / 15) * 15` keeping 0 and 1440 fixed and enforcing monotonicity, drop zero-length entries, merge adjacent same-status entries; 4) totals from snapped grid; per-day `total_miles` = sum of prorated driving miles (unsnapped, rounded to 0.1); 5) remarks: one per labeled non-`Driving` segment at its snapped start. Full implementation in Step 3.

- [ ] **Step 1: Failing tests** — `trips/tests/test_logsheets.py`:

```python
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
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** `trips/hos/logsheets.py`:

```python
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
                remarks.append(Remark(min(start_m, 1425), s.location, s.label))
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
```
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `git commit -am "feat: per-day ELD log sheet builder"`

---

### Task 10: Geocoding + routing services (mocked)

**Files:**
- Create: `backend/trips/services/geocoding.py`, `backend/trips/services/routing.py`
- Test: `backend/trips/tests/test_services.py`

**Interfaces:**
- Produces:

```python
# geocoding.py
class GeocodeError(Exception):     # .query attribute
def geocode(query: str) -> dict    # {"query", "display_name", "lat": float, "lng": float}
def reverse(lat: float, lng: float) -> str   # "City, ST" best-effort, "" on failure (never raises)

# routing.py
class RoutingError(Exception): ...
def get_route(a: tuple[float, float], b: tuple[float, float]) -> dict
# {"miles": float, "minutes": float (55mph-floored), "geometry": [(lat, lng), ...]}
```

Implementation notes (bake in): base URLs `https://nominatim.openstreetmap.org` and `https://router.project-osrm.org`; `HEADERS = {"User-Agent": "TripLogger/1.0 (mohammadhadeed8@gmail.com)"}`; timeout 10 s; `geocode` caches by `f"geo:{query.strip().lower()}"` and `reverse` by rounded 3-dp coords via `django.core.cache`; `reverse` uses `zoom=10` and assembles `city, state-abbrev` (state abbrev from `address["ISO3166-2-lvl4"].split("-")[1]` fallback full state name, city from first of `city|town|village|hamlet|county`); OSRM path `/route/v1/driving/{lng_a},{lat_a};{lng_b},{lat_b}?overview=full&geometries=geojson`, meters→miles `/1609.344`, seconds→minutes `/60`, then `minutes = max(minutes, miles / 55 * 60)`, geojson `[lng,lat]` flipped to `(lat,lng)`; one retry on `requests.RequestException`/5xx then raise `RoutingError`.

- [ ] **Step 1: Failing tests** — `trips/tests/test_services.py` (mock `requests.get` with `monkeypatch`; use `django.core.cache.cache.clear()` in a fixture):

```python
import pytest
from django.core.cache import cache
from trips.services import geocoding, routing

class FakeResp:
    def __init__(self, payload, status=200):
        self._p, self.status_code = payload, status
    def json(self):
        return self._p
    def raise_for_status(self):
        if self.status_code >= 400:
            import requests
            raise requests.HTTPError(str(self.status_code))

@pytest.fixture(autouse=True)
def clear_cache():
    cache.clear()

def test_geocode_success_and_cache(monkeypatch):
    calls = []
    monkeypatch.setattr(geocoding.requests, "get",
        lambda url, **kw: calls.append(url) or FakeResp([{"display_name": "Chicago, Cook County, Illinois", "lat": "41.88", "lon": "-87.63"}]))
    r1 = geocoding.geocode("chicago")
    r2 = geocoding.geocode("Chicago ")          # cache hit — same normalized key
    assert r1["lat"] == 41.88 and r1["lng"] == -87.63
    assert len(calls) == 1 and r1 == r2 | {"query": "chicago"}

def test_geocode_not_found(monkeypatch):
    monkeypatch.setattr(geocoding.requests, "get", lambda url, **kw: FakeResp([]))
    with pytest.raises(geocoding.GeocodeError):
        geocoding.geocode("zzzzplace")

def test_reverse_never_raises(monkeypatch):
    def boom(url, **kw):
        raise Exception("network down")
    monkeypatch.setattr(geocoding.requests, "get", boom)
    assert geocoding.reverse(41.88, -87.63) == ""

def test_route_flips_geometry_and_floors_speed(monkeypatch):
    payload = {"code": "Ok", "routes": [{
        "distance": 1609344.0,                      # 1000 miles
        "duration": 12 * 3600,                      # 12h — car-optimistic
        "geometry": {"coordinates": [[-87.63, 41.88], [-104.99, 39.74]]},
    }]}
    monkeypatch.setattr(routing.requests, "get", lambda url, **kw: FakeResp(payload))
    r = routing.get_route((41.88, -87.63), (39.74, -104.99))
    assert round(r["miles"]) == 1000
    assert round(r["minutes"]) == round(1000 / 55 * 60)   # floored, not 720
    assert r["geometry"][0] == (41.88, -87.63)

def test_route_retries_then_raises(monkeypatch):
    calls = []
    def flaky(url, **kw):
        calls.append(1)
        return FakeResp({}, status=502)
    monkeypatch.setattr(routing.requests, "get", flaky)
    with pytest.raises(routing.RoutingError):
        routing.get_route((0, 0), (1, 1))
    assert len(calls) == 2
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** both services per notes. **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: Nominatim geocoding and OSRM routing services"`

---

### Task 11: POST /api/trips endpoint

**Files:**
- Create: `backend/trips/serializers.py`, `backend/trips/views.py`, `backend/trips/urls.py`; Modify: `backend/config/urls.py`
- Test: `backend/trips/tests/test_api.py`

**Interfaces:**
- Consumes: everything above. Produces the exact response contract from the spec ("API contract" section) — field names verbatim; frontend types in Task 12 mirror it.

View flow (implement in `TripPlanView(APIView).post`): validate via `TripRequestSerializer` (`current_location`/`pickup_location`/`dropoff_location`: CharField; `current_cycle_used`: FloatField 0–70; `departure_time`: DateTimeField optional → default `datetime.now()` rounded UP to next 15 min, tz stripped) → `geocode()` ×3 (on `GeocodeError` → 422 `{"detail": "...", "field": "pickup_location"}`) → `get_route()` ×2 (on `RoutingError` → 502) → build `legs`, concatenate geometries → `plan_trip()` (on `TripTooLongError` → 422) → for each non-Driving segment compute `(lat, lng) = point_at_mile(geometry, seg.start_odometer)`, set `seg.location = reverse(lat, lng) or nearest_endpoint_name`, collect into `stops` list (`type` map: `Pickup→pickup, Dropoff→dropoff, Fuel stop→fuel, 30-min break→break, 10-hour rest→rest, 34-hour restart→restart`) → `build_day_logs()` → assemble response dict exactly per spec.

- [ ] **Step 1: Failing tests** — `trips/tests/test_api.py` (mock `trips.views.geocode`, `trips.views.reverse`, `trips.views.get_route` with monkeypatch; straight-line geometry Chicago→Denver→LA):

```python
import pytest
from rest_framework.test import APIClient

GEO = {
    "chicago, il": {"query": "Chicago, IL", "display_name": "Chicago, Illinois", "lat": 41.88, "lng": -87.63},
    "denver, co": {"query": "Denver, CO", "display_name": "Denver, Colorado", "lat": 39.74, "lng": -104.99},
    "los angeles, ca": {"query": "Los Angeles, CA", "display_name": "Los Angeles, California", "lat": 34.05, "lng": -118.24},
}

@pytest.fixture
def client(monkeypatch):
    from trips import views
    monkeypatch.setattr(views, "geocode", lambda q: GEO[q.strip().lower()])
    monkeypatch.setattr(views, "reverse", lambda lat, lng: "Somewhere, US")
    def fake_route(a, b):
        import math
        miles = math.dist(a, b) * 69.0
        return {"miles": miles, "minutes": miles / 55 * 60, "geometry": [a, b]}
    monkeypatch.setattr(views, "get_route", fake_route)
    return APIClient()

BODY = {
    "current_location": "Chicago, IL",
    "pickup_location": "Denver, CO",
    "dropoff_location": "Los Angeles, CA",
    "current_cycle_used": 10.0,
    "departure_time": "2026-07-21T08:00:00",
}

def test_happy_path_contract(client):
    r = client.post("/api/trips", BODY, format="json")
    assert r.status_code == 200
    data = r.json()
    for key in ("locations", "route", "summary", "stops", "segments", "logs"):
        assert key in data
    assert data["summary"]["total_days"] == len(data["logs"])
    for day in data["logs"]:
        assert sum(day["totals"].values()) == 1440
    types = {s["type"] for s in data["stops"]}
    assert {"pickup", "dropoff"} <= types
    assert data["route"]["total_miles"] > 1500

def test_validation_errors(client):
    r = client.post("/api/trips", {**BODY, "current_cycle_used": 71}, format="json")
    assert r.status_code == 400
    r = client.post("/api/trips", {k: v for k, v in BODY.items() if k != "pickup_location"}, format="json")
    assert r.status_code == 400

def test_geocode_failure_names_field(client, monkeypatch):
    from trips import views
    from trips.services.geocoding import GeocodeError
    def failing(q):
        if "denver" in q.lower():
            raise GeocodeError(f"No results for {q}")
        return GEO[q.strip().lower()]
    monkeypatch.setattr(views, "geocode", failing)
    r = client.post("/api/trips", BODY, format="json")
    assert r.status_code == 422
    assert r.json()["field"] == "pickup_location"

def test_routing_failure_returns_502(client, monkeypatch):
    from trips import views
    from trips.services.routing import RoutingError
    def down(a, b):
        raise RoutingError("OSRM unavailable")
    monkeypatch.setattr(views, "get_route", down)
    r = client.post("/api/trips", BODY, format="json")
    assert r.status_code == 502
    assert "detail" in r.json()
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** serializer/view/urls (`path("api/trips", TripPlanView.as_view())` in `trips/urls.py`, included from `config/urls.py`). Import services at module level (`from trips.services.geocoding import geocode, reverse` etc.) so monkeypatching `trips.views.geocode` works.
- [ ] **Step 4: Run** full suite `.venv/Scripts/python -m pytest -q` → all PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: POST /api/trips endpoint"`

---

### Task 12: Frontend scaffold + typed API client

**Files:**
- Create: `frontend/` (Vite react-ts), `frontend/src/api/types.ts`, `frontend/src/api/client.ts`, `frontend/src/styles/tokens.css`

**Interfaces:**
- Produces: `planTrip(req: TripRequest): Promise<TripPlan>` throwing `ApiError {status, detail, field?}`; TS types mirroring the API contract EXACTLY (`TripPlan`, `Stop`, `SegmentDto`, `DayLogDto`, `GridEntryDto {status: "off"|"sleeper"|"driving"|"on_duty", start_min, end_min}`).

- [ ] **Step 1: Scaffold**

```bash
cd /d/Projects/TripLogger
npm create vite@latest frontend -- --template react-ts
cd frontend && npm install && npm install leaflet react-leaflet gsap && npm install -D @types/leaflet
```

- [ ] **Step 2: Write `src/api/types.ts` + `src/api/client.ts`** — types transcribed from the spec contract; client:

```ts
const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(public status: number, public detail: string, public field?: string) {
    super(detail);
  }
}

export async function planTrip(req: TripRequest): Promise<TripPlan> {
  const res = await fetch(`${BASE}/api/trips`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(res.status, body.detail ?? "Request failed", body.field);
  }
  return res.json();
}
```

- [ ] **Step 3: `src/styles/tokens.css`** — CSS custom properties: `--navy: #1B2A5E; --accent: #2F6FED;` plus surface/ink/success/warning scale, Inter via `@font-face`/fontsource, global `font-variant-numeric: tabular-nums` on `.num`. (Final values: invoke `design-taste-frontend` skill now and lock the token set it produces.)
- [ ] **Step 4: Verify** `npm run build` → succeeds; `npx tsc --noEmit` → clean.
- [ ] **Step 5: Commit** `git add frontend && git commit -m "feat: frontend scaffold with typed API client and design tokens"`

---

### Task 13: TripForm

**Files:**
- Create: `frontend/src/components/TripForm/TripForm.tsx` (+ `.css`)
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Produces: `<TripForm onSubmit={(req: TripRequest) => void} loading: boolean />` — three location text inputs (icons: truck / package-up / package-down), cycle-used number input 0–70 step 0.5, collapsible "departure time" `datetime-local` defaulting to now-rounded-up-15-min, submit button with loading state. Client-side validation mirrors server (required fields, 0 ≤ cycle ≤ 70) with inline error text. `App.tsx` holds `{plan, loading, error}` state: form → `planTrip` → results area; `ApiError.field` highlights the matching input; 502/network shows a retry banner.

- [ ] **Step 1: Implement** form + wire into App with a results placeholder (`<pre>{JSON.stringify(plan.summary)}</pre>` for now). Baseline input/button components: query 21st.dev MCP (`mcp__21st__search` "input with icon", "primary button") and restyle with tokens; if MCP results don't fit, hand-roll — tokens rule either way.
- [ ] **Step 2: Verify** against local backend: `backend/.venv/Scripts/python manage.py runserver` + `npm run dev`, submit Chicago→Denver→LA, cycle 10 → summary JSON renders; bad city shows field error. (Live Nominatim/OSRM here — manual check only, not CI.)
- [ ] **Step 3: Commit** `git commit -am "feat: trip input form with validation and error states"`

---

### Task 14: RouteMap

**Files:**
- Create: `frontend/src/components/RouteMap/RouteMap.tsx`, `frontend/src/components/RouteMap/markers.ts`

**Interfaces:**
- Consumes: `plan.route.geometry`, `plan.stops`, `plan.locations`.
- Produces: `<RouteMap plan={TripPlan} />` — react-leaflet `MapContainer` + OSM `TileLayer` (attribution required), route `Polyline` in `--navy`, `divIcon` markers per stop type (distinct glyph + color: pickup ▲ accent, dropoff ■ navy, fuel ⛽ amber, break ● slate, rest ☾ indigo, restart ⏸ red), `Popup` per marker: label, arrival (formatted `EEE HH:mm`), duration, miles-from-origin. Auto `fitBounds` on plan change via a `useMap()` child effect.

- [ ] **Step 1: Implement** (include `import "leaflet/dist/leaflet.css"` in component; set container height via CSS or map renders 0-tall — classic Leaflet gotcha).
- [ ] **Step 2: Verify** in dev: full route visible, all stop types render popups with sane ETAs.
- [ ] **Step 3: Commit** `git commit -am "feat: interactive route map with typed stop markers"`

---

### Task 15: LogSheet SVG (the wow factor)

**Files:**
- Create: `frontend/src/components/LogSheet/LogSheet.tsx`, `frontend/src/components/LogSheet/stepPath.ts`, `frontend/src/components/LogSheet/LogSheet.css`
- Test: `frontend/src/components/LogSheet/stepPath.test.ts` (add `vitest` as dev dep; `npx vitest run`)

**Interfaces:**
- Consumes: `DayLogDto`.
- Produces: `<LogSheet day={DayLogDto} date={string} />` and pure helper `buildStepPath(grid: GridEntryDto[], x0: number, colWidth: number, rowY: Record<Status, number>): string` returning one SVG path `M/H/V` string: horizontal run on each entry's row at `x = x0 + min/1440 * (colWidth*24)... `, vertical line at each status change.

Layout (viewBox `0 0 1000 620`): header block (date, total miles driving today, carrier "TripLogger Freight Co.", main office "Chicago, IL", vehicle "TRK-001"); grid at y 180–420: 24 hour columns with labels `Mid-night, 1..11, Noon, 1..11`, 15-min minor ticks, 4 duty rows labeled exactly `1. Off Duty / 2. Sleeper Berth / 3. Driving / 4. On Duty (not driving)`; right-edge per-row totals column (`h:mm`, from `day.totals`, sums caption `= 24:00`); remarks band y 440–560: 45°-rotated tick + city/state + note text at each remark's x-position, staggered to avoid overlap.

- [ ] **Step 1: Failing test** for `buildStepPath`:

```ts
import { buildStepPath } from "./stepPath";

test("two-status day produces one vertical transition", () => {
  const grid = [
    { status: "off", start_min: 0, end_min: 720 },
    { status: "driving", start_min: 720, end_min: 1440 },
  ] as const;
  const d = buildStepPath([...grid], 0, 10, { off: 100, sleeper: 120, driving: 140, on_duty: 160 });
  expect(d).toBe("M 0 100 H 120 V 140 H 240");
});
```

(x scale: `min / 1440 * (colWidth * 24)` → 720 min = 120 when colWidth=10.)

- [ ] **Step 2: Run** `npx vitest run` → FAIL. **Step 3: Implement** `stepPath.ts` (pure string builder). **Step 4:** PASS.
- [ ] **Step 5: Implement `LogSheet.tsx`** rendering the full form around the path; step-line `stroke: var(--navy); stroke-width: 2.5; fill: none`.
- [ ] **Step 6: Verify** in dev against a 3-day trip — compare side-by-side with the FMCSA sample grid (spec: "A Completed Grid"); totals column must equal 24:00 every day.
- [ ] **Step 7: Commit** `git commit -am "feat: SVG ELD daily log sheet replica"`

---

### Task 16: Results dashboard — summary cards, day tabs, motion

**Files:**
- Create: `frontend/src/components/TripSummary/TripSummary.tsx`, `frontend/src/components/DayTabs/DayTabs.tsx`, `frontend/src/components/LoadingSteps.tsx`
- Modify: `frontend/src/App.tsx` (replace placeholder with dashboard layout)

**Interfaces:**
- Consumes: full `TripPlan`.
- Produces: dashboard = summary stat cards row (total miles, days, driving hrs, rests, fuel stops, arrival; `restart_inserted` ⇒ amber "34-hr restart required" callout card), `RouteMap`, `DayTabs` (one tab per log, `Mon 7/21` labels) hosting `LogSheet`. `LoadingSteps` shows the three pipeline phases ("Geocoding → Routing → Planning HOS") advanced on a timer while awaiting the API.

- [ ] **Step 1: Implement** components (21st.dev MCP for stat-card/tab baselines, restyled).
- [ ] **Step 2: Motion** — invoke `gsap-react` skill; implement with `useGSAP`: stagger-in stat cards (y+opacity, 0.06 s stagger), log step-line draw-in via `stroke-dasharray/dashoffset` tween on tab mount/switch (0.9 s, `power2.out`), number count-up on stat values, marker drop-in stagger. Wrap in `gsap.matchMedia()` honoring `prefers-reduced-motion`.
- [ ] **Step 3: Design pass** — re-invoke `design-taste-frontend` skill against the assembled dashboard; fix spacing/hierarchy/empty+error states.
- [ ] **Step 4: Verify** `npm run build` + `npx tsc --noEmit` clean; manual run-through of happy path, geocode error, cycle=69 restart trip, same-day short trip.
- [ ] **Step 5: Commit** `git commit -am "feat: results dashboard with stat cards, day tabs, GSAP motion"`

---

### Task 17: Production settings + deploy

**Files:**
- Create: `backend/build.sh`, `render.yaml`, `frontend/vercel.json` (only if SPA rewrites needed)
- Modify: `backend/config/settings.py`

**Interfaces:**
- Produces: live URLs. Frontend env `VITE_API_URL=https://<render-app>.onrender.com`.

- [ ] **Step 1: Settings hardening** — env-driven `SECRET_KEY`, `DEBUG` (default `"0"`), `ALLOWED_HOSTS` (comma-split), `CORS_ALLOWED_ORIGINS` env-driven replacing allow-all when `DEBUG=0`; whitenoise middleware + `STATIC_ROOT`.
- [ ] **Step 2: `render.yaml`** — python web service, `buildCommand: pip install -r backend/requirements.txt && python backend/manage.py collectstatic --noinput`, `startCommand: cd backend && gunicorn config.wsgi`, env vars listed with `sync: false` for secrets.
- [ ] **Step 3: Deploy** backend → Render, frontend → Vercel (`npx vercel --prod` from `frontend/` or dashboard; set `VITE_API_URL`). Add Vercel domain to backend CORS env.
- [ ] **Step 4: Verify live** — hosted frontend plans Chicago→Denver→LA end-to-end; check Render logs for Nominatim/OSRM errors.
- [ ] **Step 5: Commit** `git commit -am "chore: production settings and deploy configs"`

---

### Task 18: README + Loom outline

**Files:**
- Create: `README.md`, `docs/loom-outline.md`

- [ ] **Step 1: README** — live URLs, screenshot/GIF, architecture diagram (mermaid), the full HOS assumptions list copied from spec "Assumptions", local dev quickstart (backend + frontend), test instructions, API contract summary.
- [ ] **Step 2: `docs/loom-outline.md`** — 3–5 min script: (0:00) demo happy path LA trip, (1:00) log sheet walkthrough vs. real FMCSA form, (2:00) HOS engine + tests tour, (3:30) architecture + deploy, (4:30) edge cases (cycle=69 restart demo).
- [ ] **Step 3: Final check** — `pytest -q` all green, `npm run build` clean, push to GitHub (`gh repo create` — ask user for repo visibility/name if not specified).
- [ ] **Step 4: Commit** `git commit -am "docs: README and Loom outline"`
