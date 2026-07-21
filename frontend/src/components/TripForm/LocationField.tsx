import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useLocationSuggestions } from "./useLocationSuggestions";
import "./TripForm.css";
import "./LocationField.css";

interface LocationFieldProps {
  id: string;
  label: string;
  icon: ReactNode;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  placeholder?: string;
}

/**
 * Location text input with a Photon-backed autocomplete dropdown (ARIA
 * combobox pattern). Selecting a suggestion just fills the input with its
 * label - the backend still geocodes the final string via Nominatim on
 * submit, so this is a pure client-side typing aid with no server contract
 * change.
 */
export default function LocationField({ id, label, icon, value, onChange, error, placeholder }: LocationFieldProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const comboRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestions = useLocationSuggestions(value);

  const errorId = `${id}-error`;
  const listboxId = `${id}-listbox`;
  const showDropdown = isOpen && suggestions.length > 0;
  const activeId =
    showDropdown && highlighted >= 0 && highlighted < suggestions.length
      ? `${id}-option-${highlighted}`
      : undefined;

  // A fresh suggestion list (new query, or Photon just answered) always
  // starts with nothing highlighted so a stale index never points past the
  // new list's end.
  useEffect(() => {
    setHighlighted(-1);
  }, [suggestions]);

  // Click-outside closes the dropdown without touching the input's value.
  useEffect(() => {
    if (!isOpen) return;
    function handlePointerDown(e: MouseEvent) {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen]);

  function selectSuggestion(label: string) {
    onChange(label);
    setIsOpen(false);
    setHighlighted(-1);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      if (suggestions.length === 0) return;
      e.preventDefault();
      setIsOpen(true);
      setHighlighted((prev) => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      if (suggestions.length === 0) return;
      e.preventDefault();
      setIsOpen(true);
      setHighlighted((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      if (isOpen && highlighted >= 0 && highlighted < suggestions.length) {
        e.preventDefault();
        selectSuggestion(suggestions[highlighted]);
      }
    } else if (e.key === "Escape") {
      if (isOpen) {
        setIsOpen(false);
        setHighlighted(-1);
      }
    }
  }

  return (
    <div className="trip-field">
      <label htmlFor={id} className="trip-field__label">
        {label}
      </label>
      <div className="location-field__combo" ref={comboRef}>
        <div className={`trip-field__control${error ? " trip-field__control--error" : ""}`}>
          <span className="trip-field__icon" aria-hidden="true">
            {icon}
          </span>
          <input
            ref={inputRef}
            id={id}
            name={id}
            type="text"
            className="trip-field__input"
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              setIsOpen(true);
            }}
            onFocus={() => {
              if (suggestions.length > 0) setIsOpen(true);
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            autoComplete="off"
            role="combobox"
            aria-expanded={showDropdown}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
          />
        </div>
        {showDropdown && (
          <ul className="location-listbox" id={listboxId} role="listbox">
            {suggestions.map((suggestion, index) => (
              <li
                key={suggestion}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={index === highlighted}
                className={`location-listbox__option${
                  index === highlighted ? " location-listbox__option--active" : ""
                }`}
                onMouseDown={(e) => {
                  // Prevent the input from blurring before the click
                  // registers, which would close the dropdown first.
                  e.preventDefault();
                  selectSuggestion(suggestion);
                }}
                onMouseEnter={() => setHighlighted(index)}
              >
                {suggestion}
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && (
        <p id={errorId} className="trip-field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
