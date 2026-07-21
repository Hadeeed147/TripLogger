import { useEffect, useState } from "react";
import RouteGlobe from "./RouteGlobe/RouteGlobe";
import "./LoadingSteps.css";

const STEPS = ["Geocoding", "Routing", "Planning HOS"];
const STEP_INTERVAL_MS = 1200;
/** Index of the "Routing" phase - the globe spins visibly faster while this
 *  step is active, a small nod to "the route is being drawn right now". */
const ROUTING_STEP_INDEX = 1;

interface LoadingStepsProps {
  /** Whether a plan request is currently in flight. */
  active: boolean;
}

/**
 * Loading overlay shown while POST /api/trips is in flight: a spinning cobe
 * globe with the three-phase pipeline caption list (geocode -> route -> plan
 * HOS) underneath, advancing roughly once per real backend phase on a fixed
 * timer since the client has no way to know the server's actual progress.
 * This is the primary loading indicator - TripForm's button spinner stays as
 * a secondary, always-visible cue on the control that was actually pressed.
 *
 * Falls back to the original flat pipeline pill (no globe) if WebGL context
 * creation fails - see RouteGlobe's onSupportChange.
 */
export default function LoadingSteps({ active }: LoadingStepsProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [globeSupported, setGlobeSupported] = useState(true);

  useEffect(() => {
    if (!active) {
      setStepIndex(0);
      return;
    }
    setStepIndex(0);
    const id = setInterval(() => {
      setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
    }, STEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [active]);

  if (!active) return null;

  if (!globeSupported) {
    return <PipelineFallback stepIndex={stepIndex} />;
  }

  const speed = stepIndex === ROUTING_STEP_INDEX ? 2.4 : 1;

  return (
    <div className="loading-steps loading-steps--globe" role="status" aria-live="polite">
      <div className="loading-steps__globe-wrap">
        <RouteGlobe size={240} speed={speed} onSupportChange={setGlobeSupported} />
      </div>
      <ol className="loading-steps__list">
        {STEPS.map((label, i) => (
          <li
            key={label}
            className={`loading-steps__item${
              i < stepIndex
                ? " loading-steps__item--done"
                : i === stepIndex
                  ? " loading-steps__item--active"
                  : ""
            }`}
          >
            <span className="loading-steps__marker" aria-hidden="true">
              {i < stepIndex ? <CheckIcon /> : <span className="loading-steps__marker-dot" />}
            </span>
            {label}
          </li>
        ))}
      </ol>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="11"
      height="11"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8.5 6.5 12 13 4.5" />
    </svg>
  );
}

/**
 * Pre-globe three-phase pill indicator, kept verbatim as the fallback for
 * browsers/environments where WebGL context creation fails.
 */
function PipelineFallback({ stepIndex }: { stepIndex: number }) {
  return (
    <div className="loading-steps loading-steps--pipeline" role="status" aria-live="polite">
      {STEPS.map((label, i) => (
        <div className="loading-steps__pipeline-item" key={label}>
          <span
            className={`loading-steps__step${
              i < stepIndex
                ? " loading-steps__step--done"
                : i === stepIndex
                  ? " loading-steps__step--active"
                  : ""
            }`}
          >
            <span className="loading-steps__dot" aria-hidden="true" />
            {label}
          </span>
          {i < STEPS.length - 1 && (
            <span className="loading-steps__arrow" aria-hidden="true">
              &rarr;
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
