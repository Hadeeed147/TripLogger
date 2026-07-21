import { useEffect, useState } from "react";
import "./LoadingSteps.css";

const STEPS = ["Geocoding", "Routing", "Planning HOS"];
const STEP_INTERVAL_MS = 1200;

interface LoadingStepsProps {
  /** Whether a plan request is currently in flight. */
  active: boolean;
}

/**
 * Three-phase pipeline indicator shown while POST /api/trips is in flight,
 * advancing roughly once per real backend phase (geocode -> route -> plan
 * HOS) on a fixed timer since the client has no way to know the server's
 * actual progress. The timer caps at the last step and simply waits there
 * rather than looping, so it never implies a phase repeated. This is the
 * primary loading indicator - TripForm's button spinner stays as a
 * secondary, always-visible cue on the control that was actually pressed.
 */
export default function LoadingSteps({ active }: LoadingStepsProps) {
  const [stepIndex, setStepIndex] = useState(0);

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

  return (
    <div className="loading-steps" role="status" aria-live="polite">
      {STEPS.map((label, i) => (
        <div className="loading-steps__item" key={label}>
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
