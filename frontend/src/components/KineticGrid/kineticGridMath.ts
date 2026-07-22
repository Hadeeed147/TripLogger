/**
 * Pure math helpers for KineticGrid, split out from the component (which is
 * all canvas/rAF/DOM side effects) so the actual warp/falloff/color math is
 * independently unit-testable without a DOM — same rationale as
 * LogSheet/stepPath.ts and RouteGlobe's exported projectLocation.
 */

/** Clamp `value` into [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Linear interpolation from `a` to `b` at `t` (not clamped - callers that
 *  need a clamped `t` should clamp it themselves, e.g. via `clamp()`). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Smooth bell-shaped falloff from 1 at `distance = 0` down to 0 at
 * `distance >= radius`, using `(1 - t^2)^2` (a cheap, monotonic
 * quartic "bump" function) rather than a Gaussian - visually reads the same
 * as the pasted component's cursor-proximity falloff without a per-point
 * `Math.exp` call every frame across a whole grid.
 */
export function bellFalloff(distance: number, radius: number): number {
  if (radius <= 0 || distance >= radius) return 0;
  const t = distance / radius;
  const f = 1 - t * t;
  return f * f;
}

/**
 * How strongly a point at (x, y) inside a `width` x `height` box should
 * participate in the warp, tapering to 0 within `margin` px of the nearest
 * edge and 1 everywhere at least `margin` px from every edge. This is what
 * "pins" the grid's boundary so a contained (not full-viewport) instance
 * doesn't visibly tear or gap at the panel/overlay edge it's clipped to.
 */
export function edgeFactor(
  x: number,
  y: number,
  width: number,
  height: number,
  margin: number,
): number {
  if (margin <= 0) return 1;
  const dx = Math.min(x, width - x);
  const dy = Math.min(y, height - y);
  const d = Math.min(dx, dy);
  return clamp(d / margin, 0, 1);
}

export type RgbChannels = [number, number, number];

/** Parses a 3- or 6-digit hex color (with or without leading "#") into
 *  0-255 integer RGB channels. Falls back to mid-grey on anything that
 *  isn't a valid hex triple, so a bad/missing CSS custom property degrades
 *  quietly instead of throwing or drawing NaN geometry. */
export function hexToRgbChannels(hex: string): RgbChannels {
  const clean = hex.trim().replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  if (full.length !== 6 || /[^0-9a-fA-F]/.test(full)) return [128, 128, 128];
  const int = Number.parseInt(full, 16);
  if (Number.isNaN(int)) return [128, 128, 128];
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

/** Per-channel lerp between two RGB triples, `t` clamped to [0, 1]. */
export function lerpChannels(a: RgbChannels, b: RgbChannels, t: number): RgbChannels {
  const tc = clamp(t, 0, 1);
  return [lerp(a[0], b[0], tc), lerp(a[1], b[1], tc), lerp(a[2], b[2], tc)];
}

/** Formats RGB channels + alpha as a canvas-ready `rgba(...)` string. */
export function rgba(channels: RgbChannels, alpha: number): string {
  const [r, g, b] = channels;
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${clamp(alpha, 0, 1)})`;
}
