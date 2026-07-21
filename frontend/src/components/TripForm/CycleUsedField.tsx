import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import "./TripForm.css";
import "./CycleUsedField.css";

interface CycleUsedFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

const MIN = 0;
const MAX = 70;
const STEP = 0.5;
const WARNING_REMAINING = 20;
const DANGER_REMAINING = 10;

const TOOLTIP_COPY =
  "FMCSA 70-hour/8-day rule: a driver may be on duty at most 70 hours in any 8 consecutive days; " +
  "hours you've already used come off this trip's budget. Exhausting it forces a 34-hour restart.";

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <circle cx="12" cy="7.6" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * Cycle-used input: a slider + numeric readout bound to the same value,
 * a live "used / remaining" helper line that shifts tone as the 70-hour
 * budget shrinks, and an info tooltip explaining the FMCSA rule behind it.
 */
export default function CycleUsedField({ id, value, onChange, error }: CycleUsedFieldProps) {
  const [tooltipPinned, setTooltipPinned] = useState(false);
  const infoRef = useRef<HTMLDivElement>(null);

  const numeric = Number(value);
  const safeNumeric = Number.isFinite(numeric) ? Math.min(Math.max(numeric, MIN), MAX) : 0;
  const remaining = Math.max(MAX - safeNumeric, 0);
  const pct = (safeNumeric / MAX) * 100;

  let tone: "normal" | "warning" | "danger" = "normal";
  if (remaining < DANGER_REMAINING) tone = "danger";
  else if (remaining < WARNING_REMAINING) tone = "warning";

  const numberId = `${id}-number`;
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;
  const tooltipId = `${id}-tooltip`;

  useEffect(() => {
    if (!tooltipPinned) return;
    function handlePointerDown(e: MouseEvent) {
      if (infoRef.current && !infoRef.current.contains(e.target as Node)) {
        setTooltipPinned(false);
      }
    }
    function handleKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setTooltipPinned(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [tooltipPinned]);

  function handleInputChange(e: ChangeEvent<HTMLInputElement>) {
    onChange(e.target.value);
  }

  return (
    <div className="cycle-field">
      <div className="cycle-field__header">
        <label htmlFor={id} className="trip-field__label">
          Cycle used (last 8 days)
        </label>
        <div className="cycle-field__info" ref={infoRef}>
          <button
            type="button"
            className={`cycle-field__info-btn${tooltipPinned ? " cycle-field__info-btn--pinned" : ""}`}
            aria-describedby={tooltipId}
            aria-expanded={tooltipPinned}
            aria-label="About the 70-hour cycle rule"
            onClick={() => setTooltipPinned((pinned) => !pinned)}
          >
            <InfoIcon />
          </button>
          <span role="tooltip" id={tooltipId} className={`cycle-field__tooltip${tooltipPinned ? " cycle-field__tooltip--pinned" : ""}`}>
            {TOOLTIP_COPY}
          </span>
        </div>
      </div>

      <div className={`cycle-field__control${error ? " trip-field__control--error" : ""}`}>
        <input
          id={id}
          type="range"
          className="cycle-field__slider"
          min={MIN}
          max={MAX}
          step={STEP}
          value={safeNumeric}
          onChange={handleInputChange}
          style={{ "--cycle-pct": `${pct}%` } as CSSProperties}
          aria-describedby={helperId}
        />
        <div className="cycle-field__number-wrap">
          <input
            id={numberId}
            name="current_cycle_used"
            type="number"
            className="cycle-field__number num"
            min={MIN}
            max={MAX}
            step={STEP}
            value={value}
            onChange={handleInputChange}
            aria-label="Cycle used, hours (precise entry)"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : helperId}
          />
          <span className="cycle-field__suffix">hrs</span>
        </div>
      </div>

      <p className={`cycle-field__helper cycle-field__helper--${tone}`} id={helperId}>
        <span className="num">{safeNumeric.toFixed(1)}</span> hrs used - <span className="num">{remaining.toFixed(1)}</span> hrs of 70
        remaining
      </p>

      {error && (
        <p id={errorId} className="trip-field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
