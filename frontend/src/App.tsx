import { useCallback, useEffect, useState } from "react";
import "./App.css";
import TripForm, { type TripFormFieldError } from "./components/TripForm/TripForm";
import RouteMap from "./components/RouteMap/RouteMap";
import { ApiError, planTrip } from "./api/client";
import type { TripPlan, TripRequest } from "./api/types";

// Dev-only preview: visiting the app at #map renders RouteMap against a
// fake TripPlan fixture instead of the real form/results flow, so the map
// can be exercised without a backend call. Inert in production builds
// (import.meta.env.DEV is false) and invisible unless the hash is set.
const isDevMapPreview = import.meta.env.DEV && window.location.hash === "#map";

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

        {plan && (
          <section className="app-results" aria-label="Trip summary">
            <h2 className="app-results__title">Trip summary</h2>
            {/* Placeholder result view - Task 16 replaces this with the full
                results dashboard (route map, log sheets, motion). */}
            <pre className="num app-results__json">{JSON.stringify(plan.summary, null, 2)}</pre>
          </section>
        )}
      </main>
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

export default App;
