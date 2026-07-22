import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import type { TripRequest } from "../../api/types";
import LocationField from "./LocationField";
import CycleUsedField from "./CycleUsedField";
import "./TripForm.css";

/**
 * Field-scoped error handed down from App, which owns the ApiError from the
 * last failed submission. `field` matches one of the FormValues keys below
 * ("current_location" | "pickup_location" | "dropoff_location" |
 * "current_cycle_used"); `detail` is the server's human-readable message.
 */
export interface TripFormFieldError {
  field: string;
  detail: string;
}

/** Shape an example-trip chip (see src/data/exampleTrips.ts) must satisfy to be handed to fillExample(). */
export interface TripFormPrefill {
  current_location: string;
  pickup_location: string;
  dropoff_location: string;
  current_cycle_used: number;
}

/** Imperative handle exposed via ref so App can fill the form from an example-trip chip click and focus submit. */
export interface TripFormHandle {
  fillExample: (values: TripFormPrefill) => void;
}

interface TripFormProps {
  onSubmit: (req: TripRequest) => void;
  loading: boolean;
  fieldError?: TripFormFieldError;
}

interface FormValues {
  current_location: string;
  pickup_location: string;
  dropoff_location: string;
  current_cycle_used: string;
}

const INITIAL_VALUES: FormValues = {
  current_location: "",
  pickup_location: "",
  dropoff_location: "",
  current_cycle_used: "0",
};

function roundUpToNext15Minutes(date: Date): Date {
  const stepMs = 15 * 60 * 1000;
  return new Date(Math.ceil(date.getTime() / stepMs) * stepMs);
}

/** Formats a Date as a local "YYYY-MM-DDTHH:mm" string for <input type="datetime-local">. */
function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function validate(values: FormValues): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!values.current_location.trim()) {
    errors.current_location = "Current location is required.";
  }
  if (!values.pickup_location.trim()) {
    errors.pickup_location = "Pickup location is required.";
  }
  if (!values.dropoff_location.trim()) {
    errors.dropoff_location = "Dropoff location is required.";
  }

  const cycleRaw = values.current_cycle_used.trim();
  if (cycleRaw === "") {
    errors.current_cycle_used = "Cycle used is required.";
  } else {
    const cycle = Number(cycleRaw);
    if (Number.isNaN(cycle)) {
      errors.current_cycle_used = "Enter a number.";
    } else if (cycle < 0 || cycle > 70) {
      errors.current_cycle_used = "Must be between 0 and 70 hours.";
    }
  }

  return errors;
}

/* -------------------------------------------------------------------------
   Icons - hand-rolled inline SVG per the task brief (truck / package-up /
   package-down / chevron / spinner). Consistent 1.75px round-cap stroke set,
   sized by the parent via CSS so they inherit currentColor.
------------------------------------------------------------------------- */

function TruckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 7h11v9H2z" />
      <path d="M13 10h4l4 3v3h-8z" />
      <circle cx="6.5" cy="18.5" r="1.6" />
      <circle cx="17" cy="18.5" r="1.6" />
      <path d="M2 12h6" />
    </svg>
  );
}

function PackageUpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="10.5" width="16" height="9.5" rx="1.4" />
      <path d="M4 10.5l8-5 8 5" />
      <path d="M12 9V2.5" />
      <path d="M8.75 5.75L12 2.5l3.25 3.25" />
    </svg>
  );
}

function PackageDownIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="10.5" width="16" height="9.5" rx="1.4" />
      <path d="M4 10.5l8-5 8 5" />
      <path d="M12 2.5V9" />
      <path d="M8.75 5.75L12 9l3.25-3.25" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="trip-spinner-icon">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.25" opacity="0.28" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
    </svg>
  );
}

const TripForm = forwardRef<TripFormHandle, TripFormProps>(function TripForm(
  { onSubmit, loading, fieldError },
  ref,
) {
  const [values, setValues] = useState<FormValues>(INITIAL_VALUES);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [departureOpen, setDepartureOpen] = useState(false);
  const [departureTime, setDepartureTime] = useState(() =>
    toDatetimeLocalValue(roundUpToNext15Minutes(new Date())),
  );
  const cycleId = useId();
  const departureId = useId();
  const submitRef = useRef<HTMLButtonElement>(null);

  // Sync a server-reported field error into local error state so the
  // matching input highlights and shows the server's detail message.
  useEffect(() => {
    if (fieldError) {
      setErrors((prev) => ({ ...prev, [fieldError.field]: fieldError.detail }));
    }
  }, [fieldError]);

  function setField(name: keyof FormValues, value: string) {
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => {
      if (!(name in prev)) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }

  useImperativeHandle(
    ref,
    () => ({
      fillExample(trip: TripFormPrefill) {
        setValues({
          current_location: trip.current_location,
          pickup_location: trip.pickup_location,
          dropoff_location: trip.dropoff_location,
          current_cycle_used: String(trip.current_cycle_used),
        });
        setErrors({});
        // React flushes the state update above synchronously within this
        // same event-handler call (automatic batching still commits before
        // control returns to the browser here), so the DOM already reflects
        // the new values by the time we scroll/focus - no rAF/timeout needed.
        submitRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        submitRef.current?.focus();
      },
    }),
    [],
  );

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const nextErrors = validate(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const req: TripRequest = {
      current_location: values.current_location.trim(),
      pickup_location: values.pickup_location.trim(),
      dropoff_location: values.dropoff_location.trim(),
      current_cycle_used: Number(values.current_cycle_used),
    };

    // The datetime-local input value ("YYYY-MM-DDTHH:mm") is naive
    // home-terminal wall-clock time, not a timezone-aware instant. Sending
    // it through `new Date(...).toISOString()` would convert it to UTC
    // using the browser's local offset, shifting the planned timeline by
    // that offset once the backend strips tzinfo. Send it as-is (with
    // seconds appended) so the engine plans from the same wall-clock time
    // the user picked.
    if (departureOpen && departureTime) {
      req.departure_time = `${departureTime}:00`;
    }

    onSubmit(req);
  }

  return (
    <form className="trip-form" onSubmit={handleSubmit} noValidate>
      <div className="trip-form__row">
        <LocationField
          id="current_location"
          label="Current location"
          icon={<TruckIcon />}
          value={values.current_location}
          onChange={(value) => setField("current_location", value)}
          error={errors.current_location}
          placeholder="Chicago, IL"
        />
        <LocationField
          id="pickup_location"
          label="Pickup location"
          icon={<PackageUpIcon />}
          value={values.pickup_location}
          onChange={(value) => setField("pickup_location", value)}
          error={errors.pickup_location}
          placeholder="Denver, CO"
        />
        <LocationField
          id="dropoff_location"
          label="Dropoff location"
          icon={<PackageDownIcon />}
          value={values.dropoff_location}
          onChange={(value) => setField("dropoff_location", value)}
          error={errors.dropoff_location}
          placeholder="Los Angeles, CA"
        />
      </div>

      <CycleUsedField
        id={cycleId}
        value={values.current_cycle_used}
        onChange={(value) => setField("current_cycle_used", value)}
        error={errors.current_cycle_used}
      />

      <div className="trip-departure">
        <button
          type="button"
          className="trip-departure__toggle"
          aria-expanded={departureOpen}
          aria-controls={`${departureId}-panel`}
          onClick={() => setDepartureOpen((open) => !open)}
        >
          <span className={`trip-departure__chevron${departureOpen ? " trip-departure__chevron--open" : ""}`}>
            <ChevronIcon />
          </span>
          <span className="trip-departure__label">Departure time</span>
          <span className="trip-departure__hint">optional, defaults to now</span>
        </button>
        {departureOpen && (
          <div className="trip-departure__panel" id={`${departureId}-panel`}>
            <label htmlFor={departureId} className="trip-field__label">
              Depart at
            </label>
            <input
              id={departureId}
              name="departure_time"
              type="datetime-local"
              className="trip-departure__input num"
              value={departureTime}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setDepartureTime(e.target.value)}
            />
          </div>
        )}
      </div>

      <button ref={submitRef} type="submit" className="trip-submit" disabled={loading}>
        {loading && (
          <span className="trip-submit__spinner" aria-hidden="true">
            <SpinnerIcon />
          </span>
        )}
        {loading ? "Planning route..." : "Plan trip"}
      </button>
    </form>
  );
});

export default TripForm;
