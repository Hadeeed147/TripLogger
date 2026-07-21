// Marker factories + popup formatting helpers for RouteMap.
//
// Design: every stop type gets a custom L.divIcon (never the default Leaflet
// pin) - a small circular "head" with a triangular tail, tinted per type,
// holding a hand-rolled glyph. Colors are pulled exclusively from the locked
// token system (tokens.css); "rest" and "restart" don't have dedicated
// brand tokens for indigo/red, so rest reuses --navy-600 (already the HOS
// "sleeper" duty-status color - a semantically apt match since rest stops
// are sleeper-berth time) and restart uses --danger-500.

import L from "leaflet";
import type { StopType } from "../../api/types";

interface StopMeta {
  /** CSS custom property to read the fill color from. */
  colorVar: string;
  /** Inline SVG markup (24x24 viewBox), single color via currentColor/fill. */
  glyph: string;
  /** Human label, used for a11y title attributes. */
  label: string;
}

const STOP_META: Record<StopType, StopMeta> = {
  pickup: {
    colorVar: "--accent-500",
    label: "Pickup",
    glyph: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5l8.5 15h-17z"/></svg>`,
  },
  dropoff: {
    colorVar: "--navy-700",
    label: "Dropoff",
    glyph: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2.5"/></svg>`,
  },
  fuel: {
    colorVar: "--warning-500",
    label: "Fuel stop",
    glyph: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="9" height="18" rx="1.5"/><line x1="4" y1="9" x2="13" y2="9"/><path d="M13 8h3l3 3v6.5a1.5 1.5 0 0 1-3 0V13"/></svg>`,
  },
  break: {
    colorVar: "--surface-500",
    label: "Break",
    glyph: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="7"/></svg>`,
  },
  rest: {
    // No dedicated "indigo" token in the locked system - --navy-600 doubles
    // as the HOS sleeper-status color, which is exactly what a rest stop is.
    colorVar: "--navy-600",
    label: "10-hour rest",
    glyph: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 14.7A8.5 8.5 0 1 1 9.3 4a6.6 6.6 0 0 0 10.7 10.7z"/></svg>`,
  },
  restart: {
    colorVar: "--danger-500",
    label: "34-hour restart",
    glyph: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>`,
  },
};

/** Reads a CSS custom property's resolved value off the document root. */
function readColorVar(name: string): string {
  if (typeof document === "undefined") return "#1b2a5e";
  const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return val || "#1b2a5e";
}

/**
 * Builds a divIcon for a trip stop: a 30px circular head (tinted per type,
 * holding the type's glyph) sitting above an 8px triangular tail, so the
 * visual tip points exactly at the coordinate. Deliberately not a rotated
 * teardrop (avoids the classic "counter-rotate the inner icon" fiddliness)
 * while still reading as a distinct pin rather than a plain dot.
 */
export function createStopIcon(type: StopType): L.DivIcon {
  const meta = STOP_META[type];
  const color = readColorVar(meta.colorVar);
  const html = `
    <div class="rm-pin" style="--rm-pin-color:${color}" title="${meta.label}">
      <span class="rm-pin__glyph">${meta.glyph}</span>
    </div>
  `;
  return L.divIcon({
    html,
    className: "rm-pin-wrapper",
    iconSize: [30, 38],
    iconAnchor: [15, 38],
    popupAnchor: [0, -34],
  });
}

/**
 * Marker for the trip's current-location origin - not a Stop (it lives on
 * plan.locations.current), so it gets its own shape: a ringed dot (the
 * familiar "you are here" map convention) rather than a pin, so it never
 * reads as just another stop.
 */
export function createOriginIcon(): L.DivIcon {
  const color = readColorVar("--navy-900");
  const html = `<div class="rm-origin" style="--rm-origin-color:${color}" title="Trip origin"></div>`;
  return L.divIcon({
    html,
    className: "rm-pin-wrapper",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -14],
  });
}

/** Formats an ISO datetime string as "EEE HH:mm", e.g. "Tue 08:00". */
export function formatArrival(iso: string): string {
  const d = new Date(iso);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const day = days[d.getDay()];
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${hh}:${mm}`;
}

/** Formats a duration in minutes as "30 min" / "1 h" / "1.5 h" / "10 h". */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.round((minutes / 60) * 2) / 2;
  return `${hours} h`;
}

/** Formats miles-from-origin to one decimal place, e.g. "342.5". */
export function formatMiles(miles: number): string {
  return miles.toFixed(1);
}

export { STOP_META };
