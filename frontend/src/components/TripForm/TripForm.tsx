import {
  useEffect,
  useId,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import type { TripRequest } from "../../api/types";
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

/* -------------------------------------------------------------------------
   TextField - label above input, inline icon, error text below.
------------------------------------------------------------------------- */

interface TextFieldProps {
  id: string;
  label: string;
  icon: ReactNode;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  error?: string;
  placeholder?: string;
  autoComplete?: string;
}

function TextField({ id, label, icon, value, onChange, error, placeholder, autoComplete }: TextFieldProps) {
  const errorId = `${id}-error`;
  return (
    <div className="trip-field">
      <label htmlFor={id} className="trip-field__label">
        {label}
      </label>
      <div className={`trip-field__control${error ? " trip-field__control--error" : ""}`}>
        <span className="trip-field__icon" aria-hidden="true">
          {icon}
        </span>
        <input
          id={id}
          name={id}
          type="text"
          className="trip-field__input"
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
        />
      </div>
      {error && (
        <p id={errorId} className="trip-field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export default function TripForm({ onSubmit, loading, fieldError }: TripFormProps) {
  const [values, setValues] = useState<FormValues>(INITIAL_VALUES);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [departureOpen, setDepartureOpen] = useState(false);
  const [departureTime, setDepartureTime] = useState(() =>
    toDatetimeLocalValue(roundUpToNext15Minutes(new Date())),
  );
  const cycleId = useId();
  const departureId = useId();

  // Sync a server-reported field error into local error state so the
  // matching input highlights and shows the server's detail message.
  useEffect(() => {
    if (fieldError) {
      setErrors((prev) => ({ ...prev, [fieldError.field]: fieldError.detail }));
    }
  }, [fieldError]);

  function handleChange(name: keyof FormValues) {
    return (e: ChangeEvent<HTMLInputElement>) => {
      const { value } = e.target;
      setValues((prev) => ({ ...prev, [name]: value }));
      setErrors((prev) => {
        if (!(name in prev)) return prev;
        const next = { ...prev };
        delete next[name];
        return next;
      });
    };
  }

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
        <TextField
          id="current_location"
          label="Current location"
          icon={<TruckIcon />}
          value={values.current_location}
          onChange={handleChange("current_location")}
          error={errors.current_location}
          placeholder="Chicago, IL"
          autoComplete="off"
        />
        <TextField
          id="pickup_location"
          label="Pickup location"
          icon={<PackageUpIcon />}
          value={values.pickup_location}
          onChange={handleChange("pickup_location")}
          error={errors.pickup_location}
          placeholder="Denver, CO"
          autoComplete="off"
        />
        <TextField
          id="dropoff_location"
          label="Dropoff location"
          icon={<PackageDownIcon />}
          value={values.dropoff_location}
          onChange={handleChange("dropoff_location")}
          error={errors.dropoff_location}
          placeholder="Los Angeles, CA"
          autoComplete="off"
        />
      </div>

      <div className="trip-field trip-field--cycle">
        <label htmlFor={cycleId} className="trip-field__label">
          Cycle used (last 8 days)
        </label>
        <div className={`trip-cycle-control${errors.current_cycle_used ? " trip-field__control--error" : ""}`}>
          <input
            id={cycleId}
            name="current_cycle_used"
            type="number"
            className="trip-cycle-control__input num"
            min={0}
            max={70}
            step={0.5}
            value={values.current_cycle_used}
            onChange={handleChange("current_cycle_used")}
            aria-invalid={Boolean(errors.current_cycle_used)}
            aria-describedby={errors.current_cycle_used ? `${cycleId}-error` : undefined}
          />
          <span className="trip-cycle-control__suffix">hrs</span>
        </div>
        {errors.current_cycle_used && (
          <p id={`${cycleId}-error`} className="trip-field__error" role="alert">
            {errors.current_cycle_used}
          </p>
        )}
      </div>

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
              onChange={(e) => setDepartureTime(e.target.value)}
            />
          </div>
        )}
      </div>

      <button type="submit" className="trip-submit" disabled={loading}>
        {loading && (
          <span className="trip-submit__spinner" aria-hidden="true">
            <SpinnerIcon />
          </span>
        )}
        {loading ? "Planning route..." : "Plan trip"}
      </button>
    </form>
  );
}
