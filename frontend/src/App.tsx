import { useCallback, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import "./App.css";
import TripForm, { type TripFormFieldError, type TripFormHandle } from "./components/TripForm/TripForm";
import RouteMap from "./components/RouteMap/RouteMap";
import LogSheet from "./components/LogSheet/LogSheet";
import TripSummary from "./components/TripSummary/TripSummary";
import DayTabs from "./components/DayTabs/DayTabs";
import TripTimeline from "./components/TripTimeline/TripTimeline";
import LoadingSteps from "./components/LoadingSteps";
import RouteGlobe from "./components/RouteGlobe/RouteGlobe";
import RouteTakeover from "./components/RouteTakeover";
import KineticGrid from "./components/KineticGrid/KineticGrid";
import ThemeToggle from "./components/ThemeToggle";
import { ApiError, planTrip } from "./api/client";
import type { DayLogDto, TripPlan, TripRequest } from "./api/types";
import { EXAMPLE_TRIPS, type ExampleTrip } from "./data/exampleTrips";

gsap.registerPlugin(useGSAP);

// Dev-only preview: visiting the app at #map renders RouteMap against a
// fake TripPlan fixture instead of the real form/results flow, so the map
// can be exercised without a backend call. Inert in production builds
// (import.meta.env.DEV is false) and invisible unless the hash is set.
const isDevMapPreview = import.meta.env.DEV && window.location.hash === "#map";

// Same pattern, for LogSheet: visiting the app at #log renders a 3-day
// stack of log sheets against fake DayLogDto fixtures.
const isDevLogPreview = import.meta.env.DEV && window.location.hash === "#log";

// Dev-only preview for the assembled results dashboard (Task 16): renders
// TripSummary + RouteMap + DayTabs against fake fixtures so the whole
// assembly - including motion and the restart callout - is screenshot-
// checkable offline. Hash variants:
//   #dashboard         - multi-day trip, restart_inserted: true
//   #dashboard-short   - same-day trip, no restart, single log/tab
//   #dashboard-loading - LoadingSteps advancing while "awaiting" a plan
//   #dashboard-empty   - the first-run empty-state hint panel
const DASHBOARD_PREVIEW_HASHES = ["#dashboard", "#dashboard-short", "#dashboard-loading", "#dashboard-empty"];
const isDevDashboardPreview = import.meta.env.DEV && DASHBOARD_PREVIEW_HASHES.includes(window.location.hash);

// Dev-only preview for RouteTakeover (Polish J), exercised without a
// backend: `plan` resolves ~1.5s after mount (fake fixture), long enough to
// observe the "intro" globe/caption before the "ready" panel appears.
// `#takeover-failed` flips `failed` true instead, to exercise the fast
// error-exit path. `#takeover-stuck` never resolves `plan` at all, keeping
// "intro" open indefinitely - useful for exercising Skip/caption/chip-
// absence at leisure rather than racing the ~2.2s minimum-intro timer.
// `onDone`/`onUnsupported` write a plain status string into the DOM
// (`data-takeover-status`) rather than console.log, so it's assertable via
// the DOM/JS inspection tools (screenshots aren't reliable in this
// environment - see verification notes).
const TAKEOVER_PREVIEW_HASHES = ["#takeover", "#takeover-failed", "#takeover-stuck"];
const isDevTakeoverPreview = import.meta.env.DEV && TAKEOVER_PREVIEW_HASHES.includes(window.location.hash);

// App owns the ApiError from the last failed submission and decides how to
// surface it: a `field` error highlights the matching TripForm input, while
// a gateway/network failure (no matching field) surfaces as a dismissible,
// retry-able banner instead.
interface AppError {
  field?: string;
  detail: string;
}

function App() {
  if (isDevMapPreview) {
    return <DevMapPreview />;
  }
  if (isDevLogPreview) {
    return <DevLogPreview />;
  }
  if (isDevDashboardPreview) {
    return <DevDashboardPreview />;
  }
  if (isDevTakeoverPreview) {
    return <DevTakeoverPreview />;
  }

  return <TripPlannerApp />;
}

/**
 * Reveal state machine (Polish J): only two coarse phases live here -
 * `idle` (form + empty-state/dashboard, whichever `plan` says) and
 * `takeover` (the full-page RouteTakeover overlay is mounted). The finer
 * `intro -> ready -> explore` sub-machine described in the design brief
 * lives *inside* RouteTakeover itself (see its own top-of-file comment for
 * why) - App only needs to know whether the overlay should be up, and it
 * gets exactly one callback (`onDone`) back regardless of which of Skip /
 * Escape / "View trip details" / a failed request triggered it.
 *
 * `loading` is a separate boolean (not folded into `revealPhase`) for the
 * two paths that intentionally never enter `takeover` at all:
 *   - `prefers-reduced-motion` - skip the full-screen takeover entirely,
 *     straight back to the pre-Polish-J LoadingSteps -> dashboard flow.
 *   - WebGL context creation failing inside the takeover (rare) - it calls
 *     back via `onUnsupported` and App falls back the same way, picking up
 *     the *same* in-flight request rather than starting a new one.
 */
type RevealPhase = "idle" | "takeover";

function TripPlannerApp() {
  const [plan, setPlan] = useState<TripPlan | null>(null);
  // Separate from `plan`: on a resubmission, `plan` still holds the
  // *previous* trip (kept around so it stays visible under the form if the
  // new request fails, and so the old dashboard is what's dissolving away
  // rather than nothing). RouteTakeover must not mistake that stale value
  // for its own request having resolved, so it gets its own prop that's
  // explicitly cleared at the start of every submission and only set once
  // *this* request's result comes back.
  const [pendingPlan, setPendingPlan] = useState<TripPlan | null>(null);
  const [revealPhase, setRevealPhase] = useState<RevealPhase>("idle");
  const [loading, setLoading] = useState(false);
  const [submissionId, setSubmissionId] = useState(0);
  const [takeoverFailed, setTakeoverFailed] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [lastRequest, setLastRequest] = useState<TripRequest | null>(null);
  const tripFormRef = useRef<TripFormHandle>(null);
  const dissolveRef = useRef<HTMLDivElement>(null);

  const handleSelectExample = useCallback((trip: ExampleTrip) => {
    tripFormRef.current?.fillExample(trip);
  }, []);

  const submit = useCallback(async (req: TripRequest) => {
    setLastRequest(req);
    setError(null);
    setTakeoverFailed(false);
    setPendingPlan(null);

    // Decided once, up front, per submission - not re-read from state later
    // (which would risk a stale closure) - this is the one thing that
    // decides whether this submission ever shows the full-page takeover.
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      setRevealPhase("idle");
      setLoading(true);
    } else {
      setSubmissionId((id) => id + 1);
      setRevealPhase("takeover");
    }

    try {
      const result = await planTrip(req);
      setPlan(result);
      setPendingPlan(result);
      setLoading(false);
      // If the takeover is up, it already has `plan` as a prop and picks
      // this up itself (swaps in real markers/arcs, starts its "ready"
      // countdown) - nothing further to do here.
    } catch (err) {
      if (err instanceof ApiError) {
        setError({ field: err.field, detail: err.detail });
      } else if (err instanceof TypeError) {
        // fetch() rejects with a TypeError when the network request itself
        // fails (server unreachable, DNS, CORS) - there is no HTTP response.
        setError({ detail: "Could not reach the server. Check your connection and try again." });
      } else {
        setError({ detail: "Something went wrong. Please try again." });
      }
      setLoading(false);
      if (reducedMotion) {
        setRevealPhase("idle");
      } else {
        // Let RouteTakeover fade itself out (fast) rather than yanking it
        // away mid-animation - its own effect on this prop calls back via
        // onDone, which is what actually flips revealPhase to "idle".
        setTakeoverFailed(true);
      }
    }
  }, []);

  const handleRetry = useCallback(() => {
    if (lastRequest) {
      void submit(lastRequest);
    }
  }, [lastRequest, submit]);

  const handleTakeoverDone = useCallback(() => {
    setRevealPhase("idle");
  }, []);

  // WebGL couldn't create a context inside the takeover - bail out to the
  // old LoadingSteps flow instead of trapping the user behind a globe that
  // can't render. The in-flight request itself is untouched (no need to
  // resubmit); `loading` just picks up showing its fallback pipeline UI
  // until that same promise resolves.
  const handleTakeoverUnsupported = useCallback(() => {
    setRevealPhase("idle");
    setLoading(true);
  }, []);

  // The GSAP half of the "form should DISSOLVE" requirement - the fixed
  // RouteTakeover overlay fading in (its own entrance, scoped to itself)
  // is the other half. Scoped to `dissolveRef`, which wraps the form and
  // whatever's below it (empty-state or the previous dashboard, if this is
  // a resubmission) - both should visually recede together as the globe
  // takes over, and both should be back to normal the instant the
  // takeover ends (whether that's a graceful "View trip details" or a
  // fast failure bail-out) since the form must stay usable.
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        if (revealPhase === "takeover") {
          gsap.to(dissolveRef.current, {
            opacity: 0,
            scale: 0.97,
            filter: "blur(6px)",
            duration: 0.45,
            ease: "power2.in",
          });
        } else {
          gsap.to(dissolveRef.current, {
            opacity: 1,
            scale: 1,
            filter: "blur(0px)",
            duration: 0.4,
            ease: "power2.out",
          });
        }
      });
      mm.add("(prefers-reduced-motion: reduce)", () => {
        gsap.set(dissolveRef.current, { opacity: 1, scale: 1, filter: "none" });
      });
      return () => mm.revert();
    },
    { scope: dissolveRef, dependencies: [revealPhase] },
  );

  // Field-level errors (400s with a `field`) are handed to TripForm so the
  // offending input highlights. Everything else (502 from the geocoding/
  // routing services, or a network failure) has no matching input, so it
  // renders as a retry banner instead.
  const fieldError: TripFormFieldError | undefined = error?.field
    ? { field: error.field, detail: error.detail }
    : undefined;
  const bannerError = error && !error.field ? error : null;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__text">
          <h1 className="app-header__title">TripLogger</h1>
          <p className="app-header__tagline">
            Plan FMCSA-compliant routes and hours-of-service logs for any trip.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <main className="app-main">
        {bannerError && (
          <div className="app-banner" role="alert">
            <span className="app-banner__text">{bannerError.detail}</span>
            <div className="app-banner__actions">
              <button type="button" className="app-banner__retry" onClick={handleRetry}>
                Retry
              </button>
              <button
                type="button"
                className="app-banner__dismiss"
                aria-label="Dismiss"
                onClick={() => setError(null)}
              >
                &times;
              </button>
            </div>
          </div>
        )}

        <div className="app-dissolve" ref={dissolveRef}>
          <TripForm
            ref={tripFormRef}
            onSubmit={submit}
            loading={revealPhase === "takeover" || loading}
            fieldError={fieldError}
          />

          {revealPhase === "idle" &&
            !loading &&
            (plan ? <ResultsDashboard plan={plan} /> : <EmptyState onSelectExample={handleSelectExample} />)}
        </div>

        <LoadingSteps active={loading} />

        {revealPhase === "takeover" && (
          <RouteTakeover
            key={submissionId}
            plan={pendingPlan}
            failed={takeoverFailed}
            onDone={handleTakeoverDone}
            onUnsupported={handleTakeoverUnsupported}
          />
        )}
      </main>
    </div>
  );
}

/**
 * The assembled results dashboard: stat cards -> trip timeline -> route map
 * -> day tabs (each hosting that day's LogSheet), plus a print affordance.
 * Replaces the Task-15-era JSON placeholder. A stable `key` on the outer
 * section (the trip's arrival timestamp, unique per plan) forces a fresh
 * mount whenever a new plan comes back from a resubmission, which is what
 * makes TripSummary's stagger-in + count-up replay on every new result
 * rather than only once - it also resets `activeDayIndex` back to 0 for the
 * new trip, which is the behavior we want on a resubmission.
 *
 * `activeDayIndex` is lifted here (Polish D) rather than living inside
 * DayTabs, because TripTimeline's block clicks need to be able to switch the
 * active day too - both components are controlled from this single piece of
 * state, with DayTabs still falling back to its own internal state if ever
 * used standalone without these props.
 */
function ResultsDashboard({ plan }: { plan: TripPlan }) {
  const [activeDayIndex, setActiveDayIndex] = useState(0);

  return (
    <section className="app-dashboard" aria-label="Trip results" key={plan.summary.arrival}>
      <TripSummary summary={plan.summary} />
      <TripTimeline plan={plan} activeIndex={activeDayIndex} onSelectDay={setActiveDayIndex} />
      <RouteMap plan={plan} />
      <div className="app-dashboard__logs-header">
        <PrintButton />
      </div>
      <DayTabs logs={plan.logs} activeIndex={activeDayIndex} onChange={setActiveDayIndex} />

      {/* Print-only: every day's log sheet stacked, one per printed page
          (see the `@media print` rules in App.css) - never shown on screen,
          so the active DayTabs panel above is what a sighted user actually
          sees and interacts with. */}
      <div className="app-print-logs" aria-hidden="true">
        {plan.logs.map((log) => (
          <div className="app-print-logs__page" key={log.date}>
            <LogSheet day={log} date={log.date} />
          </div>
        ))}
      </div>
    </section>
  );
}

/** Printer-icon button that triggers the browser's native print dialog.
 *  The `@media print` stylesheet (App.css) does the actual layout swap - see
 *  the print-only stacked-logs container above. */
function PrintButton() {
  return (
    <button type="button" className="print-button" onClick={() => window.print()}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M7 8.5V3.75h10V8.5" />
        <rect x="4.5" y="8.5" width="15" height="8" rx="1.5" />
        <rect x="7" y="13" width="10" height="7.25" rx="0.75" />
        <path d="M7.5 16h9" />
      </svg>
      Print logs
    </button>
  );
}

/**
 * First-run hint panel, shown before any plan has been submitted (and while
 * not currently loading) so the page under the form isn't just blank.
 * `onSelectExample` (optional - the dev dashboard preview below has no live
 * TripForm to fill) wires the example-trip chips to TripForm's imperative
 * fillExample() ref method.
 */
function EmptyState({ onSelectExample }: { onSelectExample?: (trip: ExampleTrip) => void }) {
  const [globeSupported, setGlobeSupported] = useState(true);

  return (
    <div className="app-empty">
      {/* KineticGrid (Polish K) sits behind the hint/globe/chips, contained
          to this panel's own rounded bounds (`.app-empty` provides the
          `position: relative; overflow: hidden;` and border-radius - see
          App.css) - not the header/form above it, and not app-wide. */}
      <KineticGrid className="app-empty__grid" contentClassName="app-empty__grid-content">
        {globeSupported ? (
          <div className="app-empty__globe" aria-hidden="true">
            <RouteGlobe size={200} onSupportChange={setGlobeSupported} />
          </div>
        ) : (
          <span className="app-empty__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12h4l2-7 4 14 2-7h6" />
            </svg>
          </span>
        )}
        <p className="app-empty__title">Plan a trip to see your route and daily logs</p>
        <p className="app-empty__sub">
          Fill in the current, pickup, and dropoff locations above and TripLogger will map the route and build
          FMCSA-compliant driver&apos;s daily logs for every day of the trip.
        </p>
        {onSelectExample && (
          <div className="app-empty__chips" role="group" aria-label="Example trips">
            {EXAMPLE_TRIPS.map((trip) => (
              <button
                key={trip.id}
                type="button"
                className="example-chip"
                onClick={() => onSelectExample(trip)}
              >
                {trip.label}
              </button>
            ))}
          </div>
        )}
      </KineticGrid>
    </div>
  );
}

// Dynamically imported so the fixture never lands in the production bundle
// (the #map branch above is dead code once import.meta.env.DEV is false).
function DevMapPreview() {
  const [plan, setPlan] = useState<TripPlan | null>(null);

  useEffect(() => {
    void import("./dev/fakeTripPlan").then((mod) => setPlan(mod.fakeTripPlan));
  }, []);

  if (!plan) return null;

  return (
    <div style={{ padding: "2rem" }}>
      <RouteMap plan={plan} />
    </div>
  );
}

// Dynamically imported so the fixture never lands in the production bundle,
// same rationale as DevMapPreview above.
function DevLogPreview() {
  const [logs, setLogs] = useState<DayLogDto[] | null>(null);

  useEffect(() => {
    void import("./dev/fakeDayLogs").then((mod) => setLogs(mod.fakeDayLogs));
  }, []);

  if (!logs) return null;

  return (
    <div style={{ padding: "2rem", display: "flex", flexDirection: "column", gap: "2rem" }}>
      {logs.map((day) => (
        <LogSheet key={day.date} day={day} date={day.date} />
      ))}
    </div>
  );
}

type DashboardPreviewVariant = "restart" | "short" | "loading" | "empty";

function dashboardPreviewVariant(): DashboardPreviewVariant {
  switch (window.location.hash) {
    case "#dashboard-short":
      return "short";
    case "#dashboard-loading":
      return "loading";
    case "#dashboard-empty":
      return "empty";
    default:
      return "restart";
  }
}

// Dynamically imported so the fixtures never land in the production bundle,
// same rationale as DevMapPreview/DevLogPreview above. Exercises the real
// ResultsDashboard/EmptyState/LoadingSteps components (not a reimplemented
// copy), so this doubles as a visual smoke test of the production code path.
function DevDashboardPreview() {
  const variant = dashboardPreviewVariant();
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [loading, setLoading] = useState(variant === "loading");

  useEffect(() => {
    if (variant === "empty") return;

    if (variant === "loading") {
      // Simulate a slow in-flight request so LoadingSteps can be observed
      // advancing through all three phases before "resolving".
      const timer = setTimeout(() => {
        void import("./dev/fakeTripPlan").then((mod) => {
          setPlan(mod.fakeTripPlan);
          setLoading(false);
        });
      }, 5000);
      return () => clearTimeout(timer);
    }

    void import("./dev/fakeTripPlan").then((mod) => {
      setPlan(variant === "short" ? mod.fakeTripPlanShort : mod.fakeTripPlan);
    });
  }, [variant]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__text">
          <h1 className="app-header__title">TripLogger</h1>
          <p className="app-header__tagline">Dashboard dev preview - variant: {variant}</p>
        </div>
        <ThemeToggle />
      </header>
      <main className="app-main">
        <LoadingSteps active={loading} />
        {plan ? <ResultsDashboard plan={plan} /> : !loading && <EmptyState />}
      </main>
    </div>
  );
}

// Dynamically imported so the fixture never lands in the production bundle,
// same rationale as the other Dev*Preview components above.
function DevTakeoverPreview() {
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [status, setStatus] = useState("pending");
  const failed = window.location.hash === "#takeover-failed";
  const stuck = window.location.hash === "#takeover-stuck";

  useEffect(() => {
    if (failed || stuck) return;
    const timer = setTimeout(() => {
      void import("./dev/fakeTripPlan").then((mod) => setPlan(mod.fakeTripPlan));
    }, 1500);
    return () => clearTimeout(timer);
  }, [failed, stuck]);

  return (
    <div className="app-shell">
      {/* Plain-text status marker (not console.log) so the DOM/JS
          inspection tools this environment relies on for verification can
          read it directly - see the hash comment above. */}
      <p data-takeover-status={status}>Takeover dev preview - status: {status}</p>
      <RouteTakeover
        plan={plan}
        failed={failed}
        onDone={() => setStatus("done")}
        onUnsupported={() => setStatus("unsupported")}
      />
    </div>
  );
}

export default App;
