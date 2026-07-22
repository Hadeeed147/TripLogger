import { useEffect, useRef, useState } from "react";
import createGlobe, { type COBEOptions } from "cobe";
import "./RouteGlobe.css";

export interface GlobeMarker {
  lat: number;
  lng: number;
  /** Marker dot radius in cobe's own units (roughly 0.02-0.12 reads well). */
  size?: number;
}

/** A single great-circle arc between two points, in our own named-field
 *  shape (rather than cobe's raw [lat,lng] tuples) so callers don't have to
 *  remember tuple order. */
export interface GlobeArc {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
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
  /** Rotation speed multiplier (1 = baseline). Ignored under prefers-reduced-motion
   *  and while a `focus` target is set (rotation eases toward it instead). */
  speed?: number;
  markers?: GlobeMarker[];
  arcs?: GlobeArc[];
  /** Uniform arc tube width/height (cobe applies these to *all* arcs at once -
   *  there is no per-arc control). Route reveal animates these up from a
   *  small value for a "growing in" entrance; everyone else uses the default. */
  arcWidth?: number;
  arcHeight?: number;
  /** [lat, lng] the globe eases its rotation toward every frame, overriding
   *  the normal auto-spin while set. Used by the post-submit route reveal to
   *  center the trip; `null`/omitted resumes normal spin. */
  focus?: [number, number] | null;
  /** Pointer-drag rotation. Defaults to true. */
  interactive?: boolean;
  className?: string;
  /** Fires once support is known (true after a successful mount, false if
   *  WebGL context creation failed). Callers use this to swap in a
   *  non-WebGL fallback instead of an empty canvas. */
  onSupportChange?: (supported: boolean) => void;
  /** Fires every animation frame with the globe's *current* (phi, theta) -
   *  i.e. after drag/focus-easing/auto-spin have all been applied for that
   *  frame, but before `globe.update()` paints it. Callers that need to
   *  overlay HTML at a marker's live screen position (RouteTakeover's city
   *  chips) use this plus `projectLocation` instead of re-deriving rotation
   *  state themselves. Not needed for the common case (just showing the
   *  globe) so it's optional and costs nothing when omitted. */
  onFrame?: (phi: number, theta: number) => void;
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
  arcColor: [number, number, number];
  mapBrightness: number;
  diffuse: number;
}

/**
 * Resolves the current theme's globe palette from the live CSS custom
 * properties on <html> (tokens.css) rather than hardcoding hex values here,
 * so a future token change is picked up automatically. `data-theme` is set
 * synchronously before first paint (see index.html) for both explicit
 * choices and the OS-preference fallback, so reading the attribute directly
 * is reliable; the matchMedia check only covers the rare case where that
 * inline script couldn't run (privacy mode / very old browser).
 *
 * `mapBrightness`/`diffuse` are tuned per-theme, not read from tokens: they
 * are cobe render parameters (how strongly the landmass texture reads
 * against the ocean/glow), not colors, and the values here are what actually
 * makes continents legible in each theme - too low and the sphere reads as a
 * flat glowing dot field (the pre-rewrite bug this component fixes).
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
      // Tinted navy rather than near-black, so the sphere reads as "night
      // globe" instead of a black hole once mapBrightness pushes the
      // landmass texture up.
      baseColor: hexToRgb01(read("--navy-600", "#253876")),
      markerColor: hexToRgb01(read("--accent-400", "#5a8bf1")),
      glowColor: hexToRgb01(read("--accent-500", "#2f6fed")),
      arcColor: hexToRgb01(read("--accent-400", "#5a8bf1")),
      mapBrightness: 9,
      diffuse: 1.3,
    };
  }
  return {
    dark: false,
    // Soft paper-white sphere; markers/arcs/glow tinted toward brand navy
    // and accent instead of pure black so it still feels like "our" globe.
    baseColor: hexToRgb01(read("--navy-50", "#f2f4f9")),
    markerColor: hexToRgb01(read("--navy-700", "#1b2a5e")),
    glowColor: hexToRgb01(read("--accent-100", "#e4edfe")),
    arcColor: hexToRgb01(read("--navy-700", "#1b2a5e")),
    mapBrightness: 10,
    diffuse: 1.5,
  };
}

/**
 * Converts a lat/lng into the (phi, theta) globe rotation that brings that
 * point to the front-center of the sphere. Derived by inverting cobe's own
 * lat/lng -> unit-sphere projection for the point that should land at the
 * camera-facing screen center; matches the formula used by most cobe "focus
 * on a location" implementations in the wild.
 */
function locationToAngles(lat: number, lng: number): [number, number] {
  return [Math.PI - ((lng * Math.PI) / 180 - Math.PI / 2), (lat * Math.PI) / 180];
}

/** Shortest signed angular distance from `from` to `to`, in radians - so
 *  easing phi toward a target never spins the "long way around". */
function angleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/**
 * Orthographic (azimuthal) projection of a lat/lng onto the globe's *current*
 * phi/theta rotation - the forward-projection counterpart of
 * `locationToAngles` above, used to place HTML label chips over marker dots
 * that track the live rotation frame-by-frame (RouteTakeover's city chips).
 *
 * Returns unit-sphere coordinates: `x`/`y` in roughly [-1, 1] (screen-space,
 * not yet scaled by a radius or offset by a center), and `z` as the
 * "facing-ness" of the point - `z` close to 1 means dead-center-front, `z`
 * near 0 means at the silhouette edge, negative means on the far/hidden
 * hemisphere (caller should hide the chip).
 *
 * Derived so that `projectLocation(lat, lng, ...locationToAngles(lat, lng))`
 * always resolves to exactly `{ x: 0, y: 0, z: 1 }` - i.e. this is the exact
 * algebraic inverse of `locationToAngles`, not an independent approximation,
 * so a marker that RouteGlobe's `focus` prop has fully eased onto projects
 * to dead-center by construction.
 */
export function projectLocation(
  lat: number,
  lng: number,
  phi: number,
  theta: number,
): { x: number; y: number; z: number } {
  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;
  // The lat/lng currently facing the camera dead-on, given (phi, theta) -
  // the algebraic inverse of locationToAngles's own (targetPhi, targetTheta).
  const centerLat = theta;
  const dLng = lngRad + phi + Math.PI / 2;
  const x = Math.cos(latRad) * Math.sin(dLng);
  const y =
    Math.cos(centerLat) * Math.sin(latRad) - Math.sin(centerLat) * Math.cos(latRad) * Math.cos(dLng);
  const z =
    Math.sin(centerLat) * Math.sin(latRad) + Math.cos(centerLat) * Math.cos(latRad) * Math.cos(dLng);
  return { x, y, z };
}

/**
 * Reusable WebGL globe (cobe) used as the hero visual for the loading state,
 * the post-submit route reveal, and the empty state. Themed from the design
 * tokens (dark-navy base + accent-blue glow/markers in dark mode, a paper-
 * white treatment in light mode) and re-built whenever the user flips the
 * theme, since cobe bakes its colors into the GL program at creation time
 * rather than exposing them as live uniforms.
 *
 * Important implementation note: the installed cobe@2.0.1 build has *no*
 * internal render loop, and does not call an `onRender` callback despite the
 * README/types implying one exists - it draws exactly one frame at
 * construction and otherwise only repaints when `.update()` is called
 * explicitly. Left alone, that one frame is drawn before the landmass
 * texture (loaded async via an `<img>`) has finished loading, so the globe
 * never repaints with the actual map - it just sits there as a bare glowing
 * sphere with marker dots forever. This is what made the previous version of
 * this component read as "glowing blue dots and nothing else". The fix is to
 * drive our own requestAnimationFrame loop that calls `globe.update(...)`
 * every frame, both for rotation and so the now-loaded texture actually gets
 * composited in.
 *
 * Fails safe: if WebGL context creation throws (old browser, software
 * rendering disabled, context limit hit), the canvas never mounts and
 * `onSupportChange(false)` lets the caller render its own fallback instead.
 */
export default function RouteGlobe({
  size = 240,
  speed = 1,
  markers = FREIGHT_HUB_MARKERS,
  arcs = [],
  arcWidth = 0.5,
  arcHeight = 0.25,
  focus = null,
  interactive = true,
  className,
  onSupportChange,
  onFrame,
}: RouteGlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phiRef = useRef(0);
  const thetaRef = useRef(0.2);
  const speedRef = useRef(speed);
  const markersRef = useRef(markers);
  const arcsRef = useRef(arcs);
  const arcWidthRef = useRef(arcWidth);
  const arcHeightRef = useRef(arcHeight);
  const focusRef = useRef(focus);
  const interactiveRef = useRef(interactive);
  const onFrameRef = useRef(onFrame);
  const [supported, setSupported] = useState(true);

  // Mirror the latest props into refs every render so the rAF loop (started
  // once per mount/rebuild in the effect below) always reads current values
  // without needing to be an effect dependency itself - re-subscribing the
  // whole effect on every prop tick would tear down and rebuild the GL
  // context far more often than necessary.
  speedRef.current = speed;
  markersRef.current = markers;
  arcsRef.current = arcs;
  arcWidthRef.current = arcWidth;
  arcHeightRef.current = arcHeight;
  focusRef.current = focus;
  interactiveRef.current = interactive;
  onFrameRef.current = onFrame;

  // Cursor affordance reacts to `interactive` on its own, independent of the
  // canvas/GL-context effect below (which only reruns on `size` changes) -
  // otherwise a caller that flips `interactive` after mount (RouteTakeover
  // going from its non-interactive intro/ready phases into a fully
  // draggable "explore" phase, with no `size` change involved) would keep
  // showing a plain arrow cursor forever despite dragging having started
  // working, since the pointer handlers below already read the *live*
  // `interactiveRef` regardless.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.style.cursor = interactive ? "grab" : "default";
  }, [interactive]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const backingSize = size * dpr;

    let globe: ReturnType<typeof createGlobe> | null = null;
    let rafId = 0;
    let cancelled = false;

    const drag = { active: false, startX: 0, startY: 0, startPhi: 0, startTheta: 0 };

    function currentMarkers(): NonNullable<COBEOptions["markers"]> {
      return markersRef.current.map((m) => ({
        location: [m.lat, m.lng] as [number, number],
        size: m.size ?? 0.05,
      }));
    }

    function currentArcs(): NonNullable<COBEOptions["arcs"]> {
      return arcsRef.current.map((a) => ({
        from: [a.fromLat, a.fromLng] as [number, number],
        to: [a.toLat, a.toLng] as [number, number],
      }));
    }

    function frame() {
      if (!globe) return;
      const reduced = reducedMotionQuery.matches;

      if (drag.active) {
        // phi/theta are written directly by the pointermove handler below.
      } else if (focusRef.current) {
        const [targetPhi, targetTheta] = locationToAngles(focusRef.current[0], focusRef.current[1]);
        phiRef.current += angleDelta(phiRef.current, targetPhi) * 0.08;
        thetaRef.current += (targetTheta - thetaRef.current) * 0.08;
      } else if (!reduced) {
        phiRef.current += 0.0032 * speedRef.current;
      }

      onFrameRef.current?.(phiRef.current, thetaRef.current);

      globe.update({
        phi: phiRef.current,
        theta: thetaRef.current,
        markers: currentMarkers(),
        arcs: currentArcs(),
        arcWidth: arcWidthRef.current,
        arcHeight: arcHeightRef.current,
      });
      rafId = requestAnimationFrame(frame);
    }

    function build() {
      const { dark, baseColor, markerColor, glowColor, arcColor, mapBrightness, diffuse } = readThemeColors();
      const options: COBEOptions = {
        devicePixelRatio: dpr,
        width: backingSize,
        height: backingSize,
        phi: phiRef.current,
        theta: thetaRef.current,
        dark: dark ? 1 : 0,
        diffuse,
        mapSamples: 16000,
        mapBrightness,
        baseColor,
        markerColor,
        glowColor,
        arcColor,
        arcWidth: arcWidthRef.current,
        arcHeight: arcHeightRef.current,
        opacity: 0.8,
        markerElevation: 0.02,
        markers: currentMarkers(),
        arcs: currentArcs(),
      };
      try {
        globe = createGlobe(canvas!, options);
        if (!cancelled) onSupportChange?.(true);
      } catch {
        if (!cancelled) {
          setSupported(false);
          onSupportChange?.(false);
        }
        return;
      }
      rafId = requestAnimationFrame(frame);
    }

    build();

    // Pointer-drag rotation: pauses auto-rotation/focus-easing while active,
    // folds the drag delta into the persistent phi/theta refs on release.
    function onPointerDown(e: PointerEvent) {
      if (!interactiveRef.current) return;
      drag.active = true;
      drag.startX = e.clientX;
      drag.startY = e.clientY;
      drag.startPhi = phiRef.current;
      drag.startTheta = thetaRef.current;
      canvas!.style.cursor = "grabbing";
    }
    function onPointerMove(e: PointerEvent) {
      if (!drag.active) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      phiRef.current = drag.startPhi + dx / 300;
      thetaRef.current = Math.max(-1.4, Math.min(1.4, drag.startTheta - dy / 1000));
    }
    function onPointerUp() {
      if (!drag.active) return;
      drag.active = false;
      canvas!.style.cursor = interactiveRef.current ? "grab" : "default";
    }
    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    // Initial cursor is set by the dedicated `[interactive]` effect above
    // (which also handles it reactively thereafter) - not here, since this
    // effect only reruns on `size` changes and would otherwise freeze the
    // cursor at whatever `interactive` was when the GL context was built.

    // Re-create on theme flips (Polish B's ThemeToggle sets data-theme on
    // <html>) since cobe has no "update colors" API - colors are baked in
    // at createGlobe() time.
    const themeObserver = new MutationObserver((mutations) => {
      if (mutations.some((m) => m.attributeName === "data-theme")) {
        cancelAnimationFrame(rafId);
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
      cancelAnimationFrame(rafId);
      themeObserver.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      globe?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // Only `size` (an actual canvas backing-store resize) warrants tearing
    // down and recreating the GL context. markers/arcs/arcWidth/arcHeight/
    // focus/speed/interactive are all "live" - mirrored into refs above and
    // picked up by the running rAF loop's `globe.update()` call every
    // frame, with zero rebuild cost. This is what lets RouteReveal animate
    // marker sizes and arc growth at 60fps without a GL context churn.
  }, [size]);

  if (!supported) return null;

  return (
    <canvas
      ref={canvasRef}
      className={`route-globe${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size, touchAction: "none" }}
      aria-hidden="true"
    />
  );
}
