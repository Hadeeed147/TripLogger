import { useEffect, useRef, useState, type ReactNode } from "react";
import "./KineticGrid.css";
import { bellFalloff, clamp, edgeFactor, hexToRgbChannels, lerp, lerpChannels, rgba, type RgbChannels } from "./kineticGridMath";

export interface KineticGridProps {
  /** Class applied to the wrapper div (the `position: relative` box that
   *  the canvas fills via `inset: 0`). Sizing/positioning of the whole
   *  component - e.g. making it absolutely fill an ancestor - belongs here. */
  className?: string;
  /** Class applied to the layer wrapping `children` (above the canvas).
   *  KineticGrid itself doesn't lay `children` out (no flex/grid opinions) -
   *  callers that need e.g. a centered flex column pass that layout here,
   *  same as they would for any plain wrapper div. */
  contentClassName?: string;
  children?: ReactNode;
  /** Grid cell spacing in CSS px. */
  spacing?: number;
}

const DEFAULT_SPACING = 46;
/** Cursor influence radius, in CSS px - how far the bell falloff reaches. */
const POINTER_RADIUS = 190;
/** Max distance (CSS px) a fully-influenced, unpinned point is pulled
 *  toward the pointer. */
const MAX_DISPLACEMENT = 15;
/** Boundary pin band width, in grid cells (see edgeFactor). */
const EDGE_MARGIN_CELLS = 1.4;
const BASE_NODE_RADIUS = 1.1;
const ACTIVE_NODE_RADIUS = 2.6;
/** How fast pointer influence eases toward 1 (hover) or 0 (pointerleave)
 *  per frame - this, not a separate position tween, is what makes the grid
 *  "relax" smoothly after the pointer leaves rather than snapping flat. */
const STRENGTH_EASE = 0.12;
const RIPPLE_DURATION_MS = 950;
const RIPPLE_MAX_RADIUS = 170;
const RIPPLE_BAND = 46;
const MAX_RIPPLES = 5;
/** Below this activation, a segment/node is left out of the "active overlay"
 *  pass entirely - keeps that pass's cost proportional to the neighborhood
 *  near the pointer/ripples, not to the size of the whole grid. */
const ACTIVE_EPSILON = 0.035;

interface GridColors {
  line: RgbChannels;
  activeLine: RgbChannels;
  node: RgbChannels;
  activeNode: RgbChannels;
  lineAlpha: number;
  activeLineAlpha: number;
  nodeAlpha: number;
  activeNodeAlpha: number;
  ripple: RgbChannels;
  rippleAlpha: number;
}

/**
 * Resolves the grid's palette from the live CSS custom properties on
 * <html> (tokens.css), re-read on every `data-theme` flip - same pattern as
 * RouteGlobe's readThemeColors. Both themes stay low-alpha on purpose (this
 * is a backdrop, not a foreground element): dark mode tints light/accent
 * hues over the navy page background, light mode tints navy/ink hues over
 * the paper-white surface, and both ease toward the accent blue near the
 * pointer/ripples.
 */
function readGridColors(): GridColors {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const attr = root.getAttribute("data-theme");
  const isDark =
    attr === "dark" || (attr !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;

  if (isDark) {
    return {
      line: hexToRgbChannels(read("--accent-200", "#b7cdfb")),
      activeLine: hexToRgbChannels(read("--accent-400", "#5a8bf1")),
      node: hexToRgbChannels(read("--accent-200", "#b7cdfb")),
      activeNode: hexToRgbChannels(read("--accent-400", "#5a8bf1")),
      lineAlpha: 0.07,
      activeLineAlpha: 0.5,
      nodeAlpha: 0.16,
      activeNodeAlpha: 0.9,
      ripple: hexToRgbChannels(read("--accent-400", "#5a8bf1")),
      rippleAlpha: 0.45,
    };
  }
  return {
    line: hexToRgbChannels(read("--navy-700", "#1b2a5e")),
    activeLine: hexToRgbChannels(read("--accent-500", "#2f6fed")),
    node: hexToRgbChannels(read("--navy-500", "#2f478f")),
    activeNode: hexToRgbChannels(read("--accent-500", "#2f6fed")),
    lineAlpha: 0.05,
    activeLineAlpha: 0.4,
    nodeAlpha: 0.13,
    activeNodeAlpha: 0.85,
    ripple: hexToRgbChannels(read("--accent-500", "#2f6fed")),
    rippleAlpha: 0.4,
  };
}

interface GridPoint {
  bx: number;
  by: number;
}

interface Ripple {
  x: number;
  y: number;
  start: number;
}

function reducedMotionQuery(): MediaQueryList {
  return window.matchMedia("(prefers-reduced-motion: reduce)");
}

/**
 * Contained, theme-aware interactive canvas backdrop: a grid of lines +
 * intersection nodes that warps toward the pointer (bell falloff, boundary
 * pinned) and ripples outward on click, with color/radius lerping toward an
 * "active" state near the pointer/ripples. Adapted from a pasted full-
 * viewport/hardcoded-dark reference component - the warp/ripple/node math
 * is the same shape, but the shell, theming, and event scoping are
 * rebuilt: sized to this component's own wrapper (ResizeObserver, not
 * `window`), themed from tokens (both light and dark), and its
 * pointer/click listeners are scoped to the wrapper element rather than
 * `window` - see the two integration points (App.tsx's empty state,
 * RouteTakeover's backdrop) for why: this is meant to sit *behind* a
 * specific bounded surface, not the whole app.
 *
 * Renders a transparent canvas (`clearRect` only, never an opaque fill) so
 * it composites over whatever background the caller's own surface already
 * has - the page's navy-gradient/dot-grid recipe in dark mode, or a flat
 * light surface color - rather than painting its own background.
 *
 * Performance: draws the whole grid in two O(1)-draw-call passes (one
 * `stroke()` for every line, one `fill()` for every node, both as a single
 * batched path) regardless of grid size, then a small "active overlay" pass
 * that only touches the neighborhood near the pointer/ripples (bounded by
 * POINTER_RADIUS/RIPPLE_MAX_RADIUS, not by the grid's total size). A single
 * rAF loop drives it, paused via the Page Visibility API while the tab is
 * hidden and fully torn down (rAF cancelled, all listeners/observers
 * removed) on unmount.
 *
 * Under `prefers-reduced-motion: reduce`, this renders exactly one static
 * frame (the flat, un-warped grid - pointer strength and ripples are both
 * always zero) and never starts the rAF loop or attaches pointer/click
 * listeners at all; a ResizeObserver and the theme MutationObserver still
 * run so the static frame stays correctly sized/colored, matching the
 * "keep responding to layout/theme, not motion" line the rest of the app
 * draws elsewhere (gsap.matchMedia()).
 */
export default function KineticGrid({ className, contentClassName, children, spacing = DEFAULT_SPACING }: KineticGridProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [reducedMotion, setReducedMotion] = useState(() => reducedMotionQuery().matches);

  // Live-updates `reducedMotion` if the OS preference changes mid-session -
  // the main effect below depends on it, so flipping it tears down the
  // animated (or static-only) setup and rebuilds the other one.
  useEffect(() => {
    const mq = reducedMotionQuery();
    function onChange() {
      setReducedMotion(mq.matches);
    }
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let cols = 0;
    let rows = 0;
    let points: GridPoint[] = [];
    let colors = readGridColors();

    const pointer = { x: -9999, y: -9999, active: false, strength: 0 };
    let ripples: Ripple[] = [];

    function buildGrid() {
      cols = Math.max(2, Math.ceil(width / spacing) + 1);
      rows = Math.max(2, Math.ceil(height / spacing) + 1);
      const next: GridPoint[] = new Array(cols * rows);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          next[r * cols + c] = { bx: c * spacing, by: r * spacing };
        }
      }
      points = next;
    }

    function render(now: number) {
      ctx!.clearRect(0, 0, width, height);
      const n = points.length;
      if (n === 0 || width === 0 || height === 0) return;

      const margin = Math.min(spacing * EDGE_MARGIN_CELLS, Math.max(spacing, Math.min(width, height) / 2));
      const xs = new Float32Array(n);
      const ys = new Float32Array(n);
      const acts = new Float32Array(n);

      for (let i = 0; i < n; i++) {
        const p = points[i];
        let dx = 0;
        let dy = 0;
        let act = 0;

        if (pointer.strength > 0.001) {
          const px = pointer.x - p.bx;
          const py = pointer.y - p.by;
          const dist = Math.sqrt(px * px + py * py);
          const f = bellFalloff(dist, POINTER_RADIUS) * pointer.strength;
          if (f > 0) {
            const edge = edgeFactor(p.bx, p.by, width, height, margin);
            if (dist > 0.0001) {
              const mag = MAX_DISPLACEMENT * f * edge;
              dx = (px / dist) * mag;
              dy = (py / dist) * mag;
            }
            act = f;
          }
        }

        if (ripples.length > 0) {
          for (const rp of ripples) {
            const elapsed = now - rp.start;
            const t = elapsed / RIPPLE_DURATION_MS;
            if (t < 0 || t >= 1) continue;
            const ringRadius = t * RIPPLE_MAX_RADIUS;
            const rdx = p.bx - rp.x;
            const rdy = p.by - rp.y;
            const dist = Math.sqrt(rdx * rdx + rdy * rdy);
            const band = 1 - clamp(Math.abs(dist - ringRadius) / RIPPLE_BAND, 0, 1);
            act += band * (1 - t) * 0.9;
          }
        }

        xs[i] = p.bx + dx;
        ys[i] = p.by + dy;
        acts[i] = clamp(act, 0, 1);
      }

      // Base grid pass - the whole lattice, one path, one stroke() call.
      ctx!.lineWidth = 1;
      ctx!.strokeStyle = rgba(colors.line, colors.lineAlpha);
      ctx!.beginPath();
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols - 1; c++) {
          const i = r * cols + c;
          const j = i + 1;
          ctx!.moveTo(xs[i], ys[i]);
          ctx!.lineTo(xs[j], ys[j]);
        }
      }
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows - 1; r++) {
          const i = r * cols + c;
          const j = i + cols;
          ctx!.moveTo(xs[i], ys[i]);
          ctx!.lineTo(xs[j], ys[j]);
        }
      }
      ctx!.stroke();

      // Base node pass - every intersection, one path, one fill() call
      // (moveTo + a full-circle arc per point, closed implicitly by fill()).
      ctx!.fillStyle = rgba(colors.node, colors.nodeAlpha);
      ctx!.beginPath();
      for (let i = 0; i < n; i++) {
        ctx!.moveTo(xs[i] + BASE_NODE_RADIUS, ys[i]);
        ctx!.arc(xs[i], ys[i], BASE_NODE_RADIUS, 0, Math.PI * 2);
      }
      ctx!.fill();

      // Active overlay - only segments/nodes with meaningful activation,
      // which stays a small, pointer/ripple-local set regardless of grid
      // size (see ACTIVE_EPSILON).
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols - 1; c++) {
          const i = r * cols + c;
          const j = i + 1;
          const t = Math.max(acts[i], acts[j]);
          if (t < ACTIVE_EPSILON) continue;
          ctx!.strokeStyle = rgba(lerpChannels(colors.line, colors.activeLine, t), lerp(colors.lineAlpha, colors.activeLineAlpha, t));
          ctx!.beginPath();
          ctx!.moveTo(xs[i], ys[i]);
          ctx!.lineTo(xs[j], ys[j]);
          ctx!.stroke();
        }
      }
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows - 1; r++) {
          const i = r * cols + c;
          const j = i + cols;
          const t = Math.max(acts[i], acts[j]);
          if (t < ACTIVE_EPSILON) continue;
          ctx!.strokeStyle = rgba(lerpChannels(colors.line, colors.activeLine, t), lerp(colors.lineAlpha, colors.activeLineAlpha, t));
          ctx!.beginPath();
          ctx!.moveTo(xs[i], ys[i]);
          ctx!.lineTo(xs[j], ys[j]);
          ctx!.stroke();
        }
      }
      for (let i = 0; i < n; i++) {
        const t = acts[i];
        if (t < ACTIVE_EPSILON) continue;
        const radius = lerp(BASE_NODE_RADIUS, ACTIVE_NODE_RADIUS, t);
        ctx!.fillStyle = rgba(lerpChannels(colors.node, colors.activeNode, t), lerp(colors.nodeAlpha, colors.activeNodeAlpha, t));
        ctx!.beginPath();
        ctx!.arc(xs[i], ys[i], radius, 0, Math.PI * 2);
        ctx!.fill();
      }

      // Ripple rings - expanding, fading stroked circles, independent of
      // the grid warp/color effects above.
      for (const rp of ripples) {
        const elapsed = now - rp.start;
        const t = elapsed / RIPPLE_DURATION_MS;
        if (t < 0 || t >= 1) continue;
        const radius = t * RIPPLE_MAX_RADIUS;
        const alpha = colors.rippleAlpha * (1 - t);
        ctx!.strokeStyle = rgba(colors.ripple, alpha);
        ctx!.lineWidth = 1.5;
        ctx!.beginPath();
        ctx!.arc(rp.x, rp.y, radius, 0, Math.PI * 2);
        ctx!.stroke();
      }
    }

    function resizeAndRender() {
      const rect = wrapper!.getBoundingClientRect();
      const w = Math.max(0, Math.round(rect.width));
      const h = Math.max(0, Math.round(rect.height));
      if (w !== width || h !== height) {
        width = w;
        height = h;
        if (width > 0 && height > 0) {
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          canvas!.width = Math.round(width * dpr);
          canvas!.height = Math.round(height * dpr);
          canvas!.style.width = `${width}px`;
          canvas!.style.height = `${height}px`;
          ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
          buildGrid();
        }
      }
      render(performance.now());
    }

    const resizeObserver = new ResizeObserver(resizeAndRender);
    resizeObserver.observe(wrapper);
    resizeAndRender();

    // Re-read colors (and repaint) on a `data-theme` flip - same mechanism
    // as RouteGlobe, since canvas 2D draws are baked into pixels rather
    // than living CSS the way DOM styles do.
    const themeObserver = new MutationObserver((mutations) => {
      if (mutations.some((m) => m.attributeName === "data-theme")) {
        colors = readGridColors();
        render(performance.now());
      }
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    if (reducedMotion) {
      // Static frame only: pointer.strength and ripples never move past
      // their initial zero state, so `render()` above always draws the
      // flat, un-warped grid. No rAF loop, no pointer/click listeners.
      return () => {
        resizeObserver.disconnect();
        themeObserver.disconnect();
      };
    }

    function toLocal(e: PointerEvent | MouseEvent): { x: number; y: number } {
      const rect = wrapper!.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
    function onPointerMove(e: PointerEvent) {
      const { x, y } = toLocal(e);
      pointer.x = x;
      pointer.y = y;
      pointer.active = true;
    }
    function onPointerLeave() {
      // Position is left as-is; only `active` flips, which drives
      // `strength` easing back to 0 in the loop below - that eased decay
      // (not an instant snap) is what makes the grid visibly relax.
      pointer.active = false;
    }
    function onClick(e: MouseEvent) {
      ripples.push({ ...toLocal(e), start: performance.now() });
      if (ripples.length > MAX_RIPPLES) ripples.shift();
    }
    // Scoped to the wrapper element, not `window` - moves/clicks over
    // `children` still reach it via normal DOM bubbling (the canvas itself
    // is pointer-events: none, so it never intercepts them), but nothing
    // outside this component's own box ever triggers a warp or a ripple.
    wrapper.addEventListener("pointermove", onPointerMove);
    wrapper.addEventListener("pointerleave", onPointerLeave);
    wrapper.addEventListener("click", onClick);

    let rafId = 0;
    let running = false;
    function loop() {
      const now = performance.now();
      const target = pointer.active ? 1 : 0;
      pointer.strength += (target - pointer.strength) * STRENGTH_EASE;
      if (Math.abs(pointer.strength - target) < 0.001) pointer.strength = target;
      if (ripples.length > 0) {
        ripples = ripples.filter((rp) => now - rp.start < RIPPLE_DURATION_MS);
      }
      render(now);
      rafId = requestAnimationFrame(loop);
    }
    function start() {
      if (running) return;
      running = true;
      rafId = requestAnimationFrame(loop);
    }
    function stop() {
      if (!running) return;
      running = false;
      cancelAnimationFrame(rafId);
    }
    function onVisibilityChange() {
      if (document.hidden) stop();
      else start();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    if (!document.hidden) start();

    return () => {
      stop();
      resizeObserver.disconnect();
      themeObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      wrapper.removeEventListener("pointermove", onPointerMove);
      wrapper.removeEventListener("pointerleave", onPointerLeave);
      wrapper.removeEventListener("click", onClick);
    };
  }, [spacing, reducedMotion]);

  return (
    <div ref={wrapperRef} className={`kinetic-grid${className ? ` ${className}` : ""}`}>
      <canvas ref={canvasRef} className="kinetic-grid__canvas" aria-hidden="true" />
      {children && (
        <div className={`kinetic-grid__content${contentClassName ? ` ${contentClassName}` : ""}`}>{children}</div>
      )}
    </div>
  );
}
