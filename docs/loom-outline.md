# Loom walkthrough outline (3–5 min)

Recording checklist: screen share the deployed frontend + a code editor tab for the "engine + tests" section; have a terminal ready in `backend/` with the venv activated for a live `pytest` run.

## (0:00) Happy-path demo — LA trip

- Open the live app (or `npm run dev` if not yet deployed) and show the empty first-run state.
- Talking points while filling the form:
  - "This is TripLogger — a trip planner for property-carrying truck drivers. You give it a current location, a pickup, a dropoff, and how much of your 70-hour cycle you've already used, and it plans the whole trip for you."
  - Fill in something like: current = Los Angeles, CA; pickup = Barstow, CA; dropoff = Las Vegas, NV; cycle used = 20.
  - "No login, no saved trips — every request is computed fresh from these four fields, nothing is persisted server-side."
  - Submit and narrate the loading skeleton: "Geocoding → Routing → Planning HOS — that's the three backend calls: Nominatim resolves the addresses, OSRM builds the route, then the HOS engine simulates the whole shift minute by minute."
- On results: point at the map (polyline + stop markers), then the stat cards (total miles, driving hours, on-duty hours, rest/fuel/break counts).
  - "Every stop you see on the map — pickup, dropoff, fuel, break, rest — comes from the same JSON response that drives the log sheets below. One source of truth."

## (1:00) Log sheet walkthrough vs. real FMCSA form

- Switch to the log sheet section, pull up a reference image of the official FMCSA Driver's Daily Log paper form side by side if possible (or just describe it).
- Talking points:
  - "This is a hand-built SVG replica of the actual FMCSA paper log — same four duty rows: Off Duty, Sleeper Berth, Driving, On Duty Not Driving. Same 24-hour grid with 15-minute ticks, midnight to midnight."
  - Point at the step-line: "This single path draws itself in with GSAP when the tab loads — it's one continuous line that jumps between rows at every duty change, exactly like a driver's pen strokes on the paper form."
  - Point at Remarks: "Every duty change gets a remark — city, state, and a note — same as a real log's remarks section."
  - Switch day tabs if it's a multi-day trip: "Multi-day trips split at midnight — each day gets its own sheet, and if a rest period spans midnight it's split correctly across both sheets with totals still summing to exactly 1440 minutes a day."

## (2:00) HOS engine + tests tour

- Switch to the editor, open `backend/trips/hos/engine.py`.
- Talking points:
  - "The engine is pure Python — no Django imports, no I/O — so it's fully unit-testable and deterministic."
  - "At every step it advances by the minimum of: remaining drive time before the 11-hour limit, remaining time in the 14-hour window, remaining drive time before a break is due, miles to the next fuel stop, miles to the end of the leg, and remaining hours in the 70-hour cycle. Whichever is smallest wins, and it never emits a driving chunk that would cross a limit."
  - Open `trips/tests/test_engine.py`, scroll through a few describe blocks: "These ~20 cases are the correctness backbone — 8-hour break boundaries, 11-versus-14-hour rest triggers, fuel-stop accounting, cycle exhaustion and restarts, multi-day splits, plus invariant checks that run across every scenario: totals sum to 1440 minutes, segments never overlap, no limit is ever violated."
  - Flip to the terminal and run `python -m pytest -q` live: "36 tests, all green."

## (3:30) Architecture + deploy

- Show the README's mermaid diagram (or describe it): "Form submits to a single endpoint, POST /api/trips. That view geocodes three locations through Nominatim, routes two legs through OSRM, runs plan_trip to get a full timeline, then build_day_logs to slice that timeline into calendar-day log sheets. One JSON response comes back and feeds the map, the summary cards, and the log sheets."
- Mention the split repo: "Django/DRF backend, React/Vite/TypeScript frontend, no shared runtime — just a typed API contract between them."
- Deploy: "Frontend is on Vercel, backend on Render's free tier behind gunicorn and whitenoise. Render over something like Railway because Railway's free tier expires — this needs to stay up for grading."
- If already deployed, click through to the live URLs; if not, note: "the deploy step is queued right after this recording."

## (4:30) Edge case demo — cycle = 69 restart

- Go back to the form, fill in a new trip but set current cycle used = 69.
- Talking points:
  - "This is one of the trickiest rules: if the driver's already used 69 of their 70 cycle hours, there's almost no budget left to finish a normal trip. Rather than reject the trip outright, the engine detects the cycle's about to run out and inserts a mandatory 34-hour restart automatically."
- Submit and point at the summary card: "restart_inserted is true, and you can see the 34-hour off-duty block right there in the stops list and on the log sheet — a full day (or more) of Off Duty logged before driving resumes."
- Close: "That's the full loop — form to map to compliant paper-accurate log sheets, with the HOS math verified by 36 backend tests. Thanks for watching."
