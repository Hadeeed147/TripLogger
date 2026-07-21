import { useEffect, useRef, useState } from "react";
import createGlobe, { type COBEOptions } from "cobe";
import "./RouteGlobe.css";

// cobe@2.0.1 ships a COBEOptions type that omits `onRender`, even though the
// runtime (and the package's own README example) requires it to drive
// rotation every frame. Extending it locally here avoids `as any` on the
// whole options object while still catching typos in the other fields.
type COBEOptionsWithRender = COBEOptions & {
  onRender: (state: Record<string, unknown>) => void;
};

export interface GlobeMarker {
  lat: number;
  lng: number;
  /** Marker dot radius in cobe's own units (roughly 0.02-0.12 reads well). */
  size?: number;
}

/**
 * A dozen major US freight hubs (interstate crossroads, rail yards, ports,
 * parcel super-hubs) - decorative context for a trucking app's hero visual,
 * not tied to any particular trip's actual route.
 */
export const FREIGHT_HUB_MARKERS: GlobeMarker[] = [
  { lat: 34.0522, lng: -118.2437, size: 0.07 }, // Los Angeles
  { lat: 41.8781, lng: -87.6298, size: 0.08 }, // Chicago
  { lat: 32.7767, lng: -96.797, size: 0.06 }, // Dallas
  { lat: 33.749, lng: -84.388, size: 0.06 }, // Atlanta
  { lat: 40.7128, lng: -74.006, size: 0.07 }, // New York
  { lat: 47.6062, lng: -122.3321, size: 0.05 }, // Seattle
  { lat: 39.7392, lng: -104.9903, size: 0.05 }, // Denver
  { lat: 35.1495, lng: -90.049, size: 0.06 }, // Memphis
  { lat: 29.7604, lng: -95.3698, size: 0.06 }, // Houston
  { lat: 33.4484, lng: -112.074, size: 0.05 }, // Phoenix
  { lat: 39.0997, lng: -94.5786, size: 0.045 }, // Kansas City
  { lat: 38.2527, lng: -85.7585, size: 0.05 }, // Louisville
];

interface RouteGlobeProps {
  /** Square display size in CSS pixels (canvas backing store scales by DPR). */
  size?: number;
  /** Rotation speed multiplier (1 = baseline). Ignored under prefers-reduced-motion. */
  speed?: number;
  markers?: GlobeMarker[];
  className?: string;
  /** Fires once support is known (true after a successful mount, false if
   *  WebGL context creation failed). Callers use this to swap in a
   *  non-WebGL fallback instead of an empty canvas. */
  onSupportChange?: (supported: boolean) => void;
}

function hexToRgb01(hex: string): [number, number, number] {
  const clean = hex.trim().replace("#", "");
  const full = clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean;
  const int = Number.parseInt(full, 16);
  if (Number.isNaN(int)) return [0.5, 0.5, 0.5];
  return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255];
}

interface ThemeColors {
  dark: boolean;
  baseColor: [number, number, number];
  markerColor: [number, number, number];
  glowColor: [number, number, number];
  mapBrightness: number;
}

/**
 * Resolves the current theme's globe palette from the live CSS custom
 * properties on <html> (tokens.css) rather than hardcoding hex values here,
 * so a future token change is picked up automatically. `data-theme` is set
 * synchronously before first paint (see index.html) for both explicit
 * choices and the OS-preference fallback, so reading the attribute directly
 * is reliable; the matchMedia check only covers the rare case where that
 * inline script couldn't run (privacy mode / very old browser).
 */
function readThemeColors(): ThemeColors {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const attr = root.getAttribute("data-theme");
  const isDark = attr === "dark"
    || (attr !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  const read = (name: string, fallback: string) => {
    const value = style.getPropertyValue(name).trim();
    return value || fallback;
  };

  if (isDark) {
    return {
      dark: true,
      baseColor: hexToRgb01(read("--navy-800", "#142047")),
      markerColor: hexToRgb01(read("--accent-400", "#5a8bf1")),
      glowColor: hexToRgb01(read("--accent-500", "#2f6fed")),
      mapBrightness: 6,
    };
  }
  return {
    dark: false,
    baseColor: hexToRgb01(read("--navy-100", "#e7eaf3")),
    markerColor: hexToRgb01(read("--accent-500", "#2f6fed")),
    glowColor: hexToRgb01(read("--accent-200", "#b7cdfb")),
    mapBrightness: 3.2,
  };
}

/**
 * Reusable WebGL globe (cobe) used as the hero visual for the loading and
 * empty states. Themed from the design tokens (dark-navy base + accent-blue
 * glow/markers in dark mode, a lighter treatment in light mode) and re-built
 * whenever the user flips the theme, since cobe bakes its colors into the
 * GL program at creation time rather than exposing them as live uniforms.
 *
 * Fails safe: if WebGL context creation throws (old browser, software
 * rendering disabled, context limit hit), the canvas never mounts and
 * `onSupportChange(false)` lets the caller render its own fallback instead.
 */
export default function RouteGlobe({
  size = 240,
  speed = 1,
  markers = FREIGHT_HUB_MARKERS,
  className,
  onSupportChange,
}: RouteGlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phiRef = useRef(0);
  const speedRef = useRef(speed);
  const markersRef = useRef(markers);
  markersRef.current = markers;
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  // Marker content (not array identity) is what should trigger a rebuild -
  // callers may reasonably pass a fresh array literal each render.
  const markersKey = markers.map((m) => `${m.lat},${m.lng},${m.size ?? ""}`).join("|");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const backingSize = size * dpr;

    let globe: ReturnType<typeof createGlobe> | null = null;
    let cancelled = false;

    function build() {
      const { dark, baseColor, markerColor, glowColor, mapBrightness } = readThemeColors();
      const options: COBEOptionsWithRender = {
        devicePixelRatio: dpr,
        width: backingSize,
        height: backingSize,
        phi: phiRef.current,
        theta: 0.32,
        dark: dark ? 1 : 0,
        diffuse: 1.2,
        mapSamples: 14000,
        mapBrightness,
        baseColor,
        markerColor,
        glowColor,
        markers: markersRef.current.map((m) => ({
          location: [m.lat, m.lng] as [number, number],
          size: m.size ?? 0.05,
        })),
        onRender: (state) => {
          if (!reducedMotionQuery.matches) {
            phiRef.current += 0.0032 * speedRef.current;
          }
          state.phi = phiRef.current;
          state.width = backingSize;
          state.height = backingSize;
        },
      };
      try {
        globe = createGlobe(canvas!, options);
        if (!cancelled) onSupportChange?.(true);
      } catch {
        if (!cancelled) {
          setSupported(false);
          onSupportChange?.(false);
        }
      }
    }

    build();

    // Re-create on theme flips (Polish B's ThemeToggle sets data-theme on
    // <html>) since cobe has no "update colors" API - colors are baked in
    // at createGlobe() time.
    const themeObserver = new MutationObserver((mutations) => {
      if (mutations.some((m) => m.attributeName === "data-theme")) {
        globe?.destroy();
        globe = null;
        build();
      }
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => {
      cancelled = true;
      themeObserver.disconnect();
      globe?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, markersKey]);

  if (!supported) return null;

  return (
    <canvas
      ref={canvasRef}
      className={`route-globe${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}
