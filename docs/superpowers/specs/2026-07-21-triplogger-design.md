# TripLogger — Design Spec

**Date:** 2026-07-21
**Status:** Approved by user (brainstorm + design review completed same day)

## What we're building

A full-stack assessment app for a trucking logistics company. Input: current location, pickup location, dropoff location, current cycle used (hrs), optional departure time. Output: (a) an interactive route map with all required stops/rests, (b) FMCSA-compliant ELD Daily Log sheets — one per calendar day — drawn programmatically as SVG replicas of the official paper form.

Deliverables: live hosted version (Vercel + Render), GitHub repo, 3–5 min Loom. Grading weights UI/UX heavily; accuracy of HOS output matters.

## Assumptions (stated in README too)

- Property-carrying driver, 70 hr/8-day cycle, no adverse driving conditions.
- **Cycle budget simplification:** input is a single "cycle used" number, not 8 days of history, so `70 − cycle_used` is treated as a fixed budget replenished only by a 34-hour restart. True rolling drop-off is impossible from the given inputs.
- **Auto 34-hour restart:** when the cycle budget exhausts mid-trip, the engine inserts a 34 h off-duty restart (flagged in UI + summary) rather than rejecting the trip.
- **Single clock:** entire timeline runs in the current location's timezone ("home terminal time" per FMCSA § 395.8). No per-state DST handling.
- **Truck speed floor:** OSRM car-profile durations are floored at distance ÷ 55 mph.
- **Departure time:** optional input, defaults to "now" rounded up to the next 15 min.
- 1 h on-duty (not driving) for pickup and for dropoff. Fuel stop = 30 min on-duty every 1,000 cumulative route-miles.
- Trips over 5,000 route-miles or unroutable pairs are rejected with 422.

## HOS rules implemented

1. 11-hour driving limit per shift; 14-hour on-duty window from shift start (rest does not extend it); both reset only by ≥10 consecutive hours off duty.
2. 30-minute break from driving after 8 cumulative driving hours; satisfied by ANY ≥30 min consecutive non-driving period (on-duty fuel stops and 1 h pickup/dropoff qualify — engine must not schedule redundant breaks).
3. 70-hour/8-day on-duty cycle, seeded from input; driving forbidden at/after 70; 34 h restart resets to zero.
4. Engine advances by `min(remaining_drive_11, remaining_window_14, remaining_break_8, miles_to_fuel, miles_to_leg_end, remaining_cycle_70)` and never emits a driving chunk that crosses a limit.

## Architecture

Monorepo:

```
TripLogger/
├── backend/                  # Django 5 + DRF, Python 3.13, venv at backend/.venv (gitignored)
│   ├── config/               # settings (base/dev/prod), urls, wsgi
│   ├── trips/
│   │   ├── hos/              # PURE PYTHON — no Django imports, no I/O
│   │   │   ├── models.py     # dataclasses: DutyStatus enum, Leg, Segment, Timeline, DayLog
│   │   │   ├── engine.py     # plan_trip(legs, cycle_used_hrs, start_dt) -> Timeline
│   │   │   └── logsheets.py  # build_day_logs(timeline) -> list[DayLog]
│   │   ├── services/
│   │   │   ├── geocoding.py  # Nominatim: geocode + reverse; server-side, cached, 1 rps, custom UA
│   │   │   └── routing.py    # OSRM public demo behind RoutingService interface; 1 retry then 502
│   │   ├── views.py serializers.py urls.py
│   │   └── tests/            # pytest + pytest-django; fixtures mock all network
│   └── requirements.txt
├── frontend/                 # React 18 + Vite + TypeScript
│   └── src/
│       ├── api/              # typed client, response types mirror API contract
│       ├── components/       # TripForm, RouteMap, LogSheet, TripSummary, DayTabs
│       └── styles/           # tokens: FMCSA navy palette, Inter, tabular-nums
└── README.md
```

No database persistence — trips are computed per-request, nothing stored. SQLite exists only for Django internals.

Request flow: `POST /api/trips` → geocode 3 locations (Nominatim, cached) → route 2 legs (current→pickup, pickup→dropoff via OSRM) → `plan_trip()` → `build_day_logs()` → reverse-geocode stop coordinates for Remarks → single JSON response consumed by map, stat cards, and log sheets (single source of truth).

## API contract

`POST /api/trips`

Request:
```json
{
  "current_location": "Chicago, IL",
  "pickup_location": "Denver, CO",
  "dropoff_location": "Los Angeles, CA",
  "current_cycle_used": 12.5,
  "departure_time": "2026-07-21T08:00:00-05:00"   // optional
}
```

Response 200:
```jsonc
{
  "locations": {
    "current":  { "query": "...", "display_name": "...", "lat": 0, "lng": 0 },
    "pickup":   { ... }, "dropoff": { ... }
  },
  "route": { "geometry": [[lat, lng], ...], "total_miles": 2789.4, "total_duration_hrs": 50.7 },
  "summary": {
    "total_days": 5, "total_miles": 2789.4, "driving_hrs": 50.7,
    "on_duty_hrs": 55.2, "rest_stops": 4, "fuel_stops": 2, "breaks": 3,
    "restart_inserted": false, "arrival": "2026-07-26T14:30:00-05:00"
  },
  "stops": [
    { "type": "pickup", "lat": 0, "lng": 0, "arrival": "...", "duration_min": 60,
      "label": "Pickup — Denver, CO", "miles_from_origin": 1003.2 }
    // types: pickup | dropoff | fuel | break | rest | restart
  ],
  "segments": [
    { "status": "driving", "start": "...", "end": "...", "miles": 312.0,
      "start_miles_from_origin": 0, "location_hint": "Chicago, IL" }
    // status: off | sleeper | driving | on_duty
  ],
  "logs": [
    {
      "date": "2026-07-21",
      "grid": [ { "status": "off", "start_min": 0, "end_min": 480 }, ... ],  // 15-min-snapped, covers 0–1440
      "totals": { "off": 615, "sleeper": 0, "driving": 660, "on_duty": 165 },  // minutes, sums to 1440
      "total_miles": 472.0,
      "remarks": [ { "time_min": 480, "city_state": "Chicago, IL", "note": "Pre-trip / depart" } ]
    }
  ]
}
```

Errors: `400` (validation: missing fields, cycle outside 0–70), `422` (geocode not found — names the offending field; unroutable pair; trip > 5,000 mi), `502` (Nominatim/OSRM down after retry). All errors: `{ "detail": "...", "field": "..."? }` rendered verbatim by the UI.

## HOS engine detail

- Minute-resolution simulation; deterministic; pure functions over dataclasses.
- Accumulators: `drive_since_break` (limit 8 h), `drive_since_rest` (11 h), `window_elapsed` (14 h from shift start), `cycle_used` (70 h). Reset rules as in "HOS rules" above.
- Events, in priority order at each step: leg end (emit 1 h ON_DUTY pickup/dropoff), fuel due (30 min ON_DUTY), break due (30 min OFF), 11 h/14 h due (10 h rest emitted as SLEEPER), cycle exhausted (34 h restart emitted as OFF).
- Status mapping is fixed: 10 h rests → SLEEPER row; 30 min breaks → OFF row; 34 h restart → OFF row; pickup/dropoff/fuel → ON_DUTY row. This exercises all four grid rows and matches how drivers actually log.
- Merge rule: after ANY non-driving segment ≥ 30 min, `drive_since_break` resets — fuel and pickup stops double as breaks.
- Stop coordinates: interpolate route polyline at cumulative-mile mark (haversine along geometry); no extra routing calls.
- `logsheets.py`: split segments at midnight boundaries; pad first day from 00:00 and last day to 24:00 with OFF; snap every transition to 15-min grid; recompute totals from snapped grid so they sum to exactly 1440 min/day.

## ELD log sheet rendering (frontend)

Hand-built React SVG component replicating the official FMCSA Driver's Daily Log:

- Header: date, total miles driving today, carrier name ("TripLogger Freight Co."), main office address, vehicle numbers — filled from API data.
- 24-hour grid: hour labels Midnight→Noon→11 PM, 15-min tick marks, four duty rows (Off Duty, Sleeper Berth, Driving, On Duty Not Driving).
- Duty step-line: single SVG `<path>` — horizontal runs on the active row, vertical strokes at each status change. GSAP animates `stroke-dashoffset` so it draws itself in on load/tab-switch.
- Per-row total hours column at right; footer recap; Remarks section with 45° flag marks + city/state + note at each duty change.
- Print-friendly (crisp vectors), one component instance per day, day navigation via tabs.

## Frontend

- React 18 + Vite + TS. Map: react-leaflet + OSM raster tiles; polyline route; custom-styled markers per stop type; popups with ETA + duration; auto fit-bounds.
- Design (taste-skill governs details): FMCSA-inspired navy primary + signal-blue accent, Inter with `tabular-nums` for all figures, generous spacing, custom-styled components (21st.dev MCP as baseline, restyled to tokens) — explicitly not default-Bootstrap/Material.
- Motion (GSAP skills): log step-line draw-in; stagger-in for stat cards and markers; animated day-tab transitions; count-up on stat numbers. Respect `prefers-reduced-motion` via `gsap.matchMedia`.
- States: multi-step skeleton loader ("Geocoding → Routing → Planning HOS"), per-error-class banners, empty/first-run state.

## Testing

Engine tests are the correctness backbone (~20 pytest cases):

1. Short same-day trip: pickup + dropoff only, no break (< 8 h driving), single log sheet.
2. Exactly 8 h driving → break inserted at 8:00; 7 h 59 m → none.
3. 14 h window expires before 11 h driving consumed (stops eat the window) → rest at window expiry.
4. 11 h driving consumed before window → rest at 11 h.
5. Fuel at 999 mi (none) vs 1,001 mi (one); fuel accumulator carries across rests.
6. Fuel stop at break-due time satisfies the break (no redundant break).
7. 1 h pickup resets `drive_since_break`.
8. Multi-day LA→NY: correct sheet count, rest spans midnight and splits across sheets.
9. Cycle = 69 h → 34 h restart inserted, `restart_inserted: true`.
10. Cycle boundaries: 0 (full budget) and 70 (restart before any driving).
11. Zero-mile deadhead (current == pickup): no zero-length driving segment.
12. Invariants across ALL scenarios: every day's totals sum to 1440 min; segments contiguous & non-overlapping; no driving segment violates 8/11/14/70; miles conserved.

API tests: mocked Nominatim/OSRM fixtures (no live network), happy path + each error class. Frontend: type-checked API client; visual correctness verified in browser during development.

## Deployment

- Frontend → Vercel; `VITE_API_URL` env var.
- Backend → Render free tier: gunicorn + whitenoise, env vars `SECRET_KEY`, `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `DEBUG=0`. (Render over Railway: Railway free tier expires.)
- README: architecture overview, HOS assumptions list (from this spec), local run instructions, live URLs.
- Git: conventional commits, frequent; engine-first build order.

## Build order

1. Scaffold backend + `hos/` package with tests (TDD) → 2. log-sheet builder + tests → 3. services (geocode/route) + API view + mocked API tests → 4. frontend scaffold, form, map → 5. SVG log sheet → 6. summary cards, tabs, motion polish → 7. deploy + README + Loom outline.
