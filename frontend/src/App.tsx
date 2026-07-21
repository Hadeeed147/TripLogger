import { useCallback, useEffect, useState } from "react";
import "./App.css";
import TripForm, { type TripFormFieldError } from "./components/TripForm/TripForm";
import RouteMap from "./components/RouteMap/RouteMap";
import LogSheet from "./components/LogSheet/LogSheet";
import TripSummary from "./components/TripSummary/TripSummary";
import DayTabs from "./components/DayTabs/DayTabs";
import LoadingSteps from "./components/LoadingSteps";
import { ApiError, planTrip } from "./api/client";
import type { DayLogDto, TripPlan, TripRequest } from "./api/types";

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

  return <TripPlannerApp />;
}

function TripPlannerApp() {
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [lastRequest, setLastRequest] = useState<TripRequest | null>(null);

  const submit = useCallback(async (req: TripRequest) => {
    setLastRequest(req);
    setLoading(true);
    setError(null);
    try {
      const result = await planTrip(req);
      setPlan(result);
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
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRetry = useCallback(() => {
    if (lastRequest) {
      void submit(lastRequest);
    }
  }, [lastRequest, submit]);

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
        <h1 className="app-header__title">TripLogger</h1>
        <p className="app-header__tagline">
          Plan FMCSA-compliant routes and hours-of-service logs for any trip.
        </p>
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

        <TripForm onSubmit={submit} loading={loading} fieldError={fieldError} />

        <LoadingSteps active={loading} />

        {plan ? <ResultsDashboard plan={plan} /> : !loading && <EmptyState />}
      </main>
    </div>
  );
}

/**
 * The assembled results dashboard: stat cards -> route map -> day tabs
 * (each hosting that day's LogSheet). Replaces the Task-15-era JSON
 * placeholder. A stable `key` on the outer section (the trip's arrival
 * timestamp, unique per plan) forces a fresh mount whenever a new plan
 * comes back from a resubmission, which is what makes TripSummary's
 * stagger-in + count-up replay on every new result rather than only once.
 */
function ResultsDashboard({ plan }: { plan: TripPlan }) {
  return (
    <section className="app-dashboard" aria-label="Trip results" key={plan.summary.arrival}>
      <TripSummary summary={plan.summary} />
      <RouteMap plan={plan} />
      <DayTabs logs={plan.logs} />
    </section>
  );
}

/**
 * First-run hint panel, shown before any plan has been submitted (and while
 * not currently loading) so the page under the form isn't just blank.
 */
function EmptyState() {
  return (
    <div className="app-empty">
      <span className="app-empty__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12h4l2-7 4 14 2-7h6" />
        </svg>
      </span>
      <p className="app-empty__title">Plan a trip to see your route and daily logs</p>
      <p className="app-empty__sub">
        Fill in the current, pickup, and dropoff locations above and TripLogger will map the route and build
        FMCSA-compliant driver&apos;s daily logs for every day of the trip.
      </p>
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
        <h1 className="app-header__title">TripLogger</h1>
        <p className="app-header__tagline">Dashboard dev preview - variant: {variant}</p>
      </header>
      <main className="app-main">
        <LoadingSteps active={loading} />
        {plan ? <ResultsDashboard plan={plan} /> : !loading && <EmptyState />}
      </main>
    </div>
  );
}

export default App;
