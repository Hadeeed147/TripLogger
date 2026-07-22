import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import RouteGlobe, {
  FREIGHT_HUB_MARKERS,
  projectLocation,
  type GlobeArc,
  type GlobeMarker,
} from "./RouteGlobe/RouteGlobe";
import KineticGrid from "./KineticGrid/KineticGrid";
import type { TripPlan } from "../api/types";
import "./RouteTakeover.css";

gsap.registerPlugin(useGSAP);

interface RouteTakeoverProps {
  /** Null while POST /api/trips is still in flight; set the instant it
   *  resolves. RouteTakeover swaps the decorative freight-hub globe for the
   *  trip's real markers/arcs and starts its "ready" countdown the moment
   *  this becomes non-null - see `MIN_INTRO_MS` below. */
  plan: TripPlan | null;
  /** Flips true the instant the in-flight request fails. The caller has
   *  already reset its own state to show the form + error banner by the
   *  time `onDone` fires - this just needs to get itself off-screen fast
   *  rather than sit through the full ~2.2s intro for a request that's
   *  already known to have failed. */
  failed: boolean;
  /** Called exactly once - whichever of Skip / Escape / "View trip
   *  details" / the intro simply finishing / a failed request fires first.
   *  The caller swaps straight to the fully-rendered dashboard (or back to
   *  the form, on failure) once this fires; this component has always
   *  finished animating itself off-screen by then. */
  onDone: () => void;
  /** The globe couldn't get a WebGL context. The caller falls back to the
   *  pre-existing LoadingSteps -> dashboard flow instead of the takeover. */
  onUnsupported: () => void;
}

type SubPhase = "intro" | "ready" | "explore";

/** Never resolve the "ready" completion panel before this much time has
 *  elapsed, even if the API responds instantly - the whole point of the
 *  takeover is an establishing shot, not a flash of globe. If the API is
 *  *slower* than this, the intro simply keeps playing until it lands (see
 *  the `plan`-watching effect below) - nothing here ever fakes a duration. */
const MIN_INTRO_MS = 2200;

const STEPS = ["Geocoding", "Routing", "Planning HOS"];
const STEP_INTERVAL_MS = 1200;

/** First comma-separated component of a Nominatim display_name, e.g.
 *  "Chicago, Cook County, Illinois, USA" -> "Chicago". */
function cityLabel(displayName: string): string {
  return displayName.split(",")[0]?.trim() || displayName;
}

function buildRouteSummary(plan: TripPlan): string {
  const { current, pickup, dropoff } = plan.locations;
  const days = plan.summary.total_days;
  return `${cityLabel(current.display_name)} → ${cityLabel(pickup.display_name)} → ${cityLabel(dropoff.display_name)} · ${Math.round(
    plan.summary.total_miles,
  ).toLocaleString()} mi · ${days} day${days === 1 ? "" : "s"}`;
}

/** Globe display size in CSS px: roughly `min(100vw, 100vh)`, biased ~8%
 *  larger so it bleeds past the viewport edges a little (the "immersive
 *  hero, not a polite card" brief), clamped so it neither balloons into a
 *  GPU-costly backing store on huge monitors nor shrinks below "still
 *  reads as a takeover" on small phones. */
function computeGlobeSize(): number {
  if (typeof window === "undefined") return 480;
  const base = Math.min(window.innerWidth, window.innerHeight);
  return Math.max(360, Math.min(Math.round(base * 1.08), 820));
}

function reducedMotionNow(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type ChipKey = "current" | "pickup" | "dropoff";

/**
 * Full-viewport globe takeover shown the instant a trip is submitted,
 * replacing the old small inline LoadingSteps/RouteReveal panel entirely
 * (App only mounts this when `!prefers-reduced-motion` - see App.tsx).
 * Owns its own `intro -> ready -> explore` sub-machine; the caller's phase
 * only needs to know "is the takeover up or not" (see App.tsx's comment on
 * why the finer-grained states live here rather than being threaded back
 * up as more App-level state).
 *
 * `intro`: the establishing shot - globe scales up from smaller as this
 * panel fades in over the dissolving form (that fade lives in App.tsx,
 * scoped to the form/dashboard wrapper, so both halves of the cross-fade
 * are driven by the same `revealPhase` flip). Decorative freight-hub
 * markers spin until `plan` resolves, at which point the three real stops
 * pop in (staggered, like the old RouteReveal) with HTML label chips
 * tracking their live projected screen position every frame (see
 * `handleFrame`/`projectLocation`), and the two route arcs stage in
 * current->pickup then pickup->dropoff. A subtle bottom caption strip
 * advances through the same three backend-phase captions LoadingSteps used
 * to show, swapping to the one-line route summary once it's known.
 *
 * `ready`: reached once `plan` is resolved AND `MIN_INTRO_MS` has elapsed
 * (whichever comes second - see the two effects below). A completion panel
 * appears over a lightly dimmed globe with two choices.
 *
 * `explore`: "Explore route" dismisses the panel but keeps the takeover up,
 * now with the globe fully drag-interactive and `focus` cleared so the
 * user's rotation isn't fought by the auto-centering easing. A persistent
 * corner button (equivalent to Skip/the panel's primary button) always
 * gets back to the dashboard.
 *
 * Escape always calls `finish()` regardless of sub-phase - "the app can
 * always reach the dashboard" is a hard requirement, not a per-state one.
 */
export default function RouteTakeover({ plan, failed, onDone, onUnsupported }: RouteTakeoverProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeWrapRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const primaryBtnRef = useRef<HTMLButtonElement>(null);

  const [subPhase, setSubPhase] = useState<SubPhase>("intro");
  const [globeSupported, setGlobeSupported] = useState(true);
  const [globeSize, setGlobeSize] = useState(computeGlobeSize);
  const [stepIndex, setStepIndex] = useState(0);
  const [markers, setMarkers] = useState<GlobeMarker[]>(FREIGHT_HUB_MARKERS);
  const [arcs, setArcs] = useState<GlobeArc[]>([]);
  const [arcWidth, setArcWidth] = useState(0.08);
  const [arcHeight, setArcHeight] = useState(0.04);
  const [focus, setFocus] = useState<[number, number] | null>(null);

  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const onUnsupportedRef = useRef(onUnsupported);
  onUnsupportedRef.current = onUnsupported;
  const planRef = useRef(plan);
  planRef.current = plan;

  const finishedRef = useRef(false);
  const introElapsedRef = useRef(false);
  const unsupportedFiredRef = useRef(false);
  const chipRevealRef = useRef(0);
  const chipRefs = useRef<Partial<Record<ChipKey, HTMLDivElement | null>>>({});
  const radiusRef = useRef(globeSize / 2);
  radiusRef.current = globeSize / 2;

  const routeSummary = useMemo(() => (plan ? buildRouteSummary(plan) : null), [plan]);
  const captionText = subPhase === "intro" ? (routeSummary ?? STEPS[stepIndex]) : null;

  /** Kills any running takeover tweens and fades the whole overlay out,
   *  then hands off to the caller. `fast` (used for the failed-request
   *  path) skips straight to a near-instant fade instead of the leisurely
   *  "graceful" exit - a failed request has no "route planned" moment to
   *  savor. Idempotent: Skip, Escape, both panel buttons, the persistent
   *  explore button, and the failed-prop effect all call this, and only
   *  the first call does anything. */
  const doneCalledRef = useRef(false);
  const finish = useCallback((fast = false) => {
    if (finishedRef.current) return;
    finishedRef.current = true;

    function callOnDoneOnce() {
      if (doneCalledRef.current) return;
      doneCalledRef.current = true;
      onDoneRef.current();
    }

    const node = containerRef.current;
    const durationMs = fast ? 200 : 450;
    if (!node || reducedMotionNow()) {
      callOnDoneOnce();
      return;
    }
    gsap.killTweensOf(node);
    gsap.to(node, {
      opacity: 0,
      scale: fast ? 1 : 0.97,
      duration: durationMs / 1000,
      ease: fast ? "power1.in" : "power2.in",
      onComplete: callOnDoneOnce,
    });
    // Safety net: guarantee onDone fires even if the tween's onComplete
    // callback never runs (GSAP's default ticker is requestAnimationFrame-
    // driven, and browsers throttle/suspend rAF for backgrounded tabs) -
    // "the app can always reach the dashboard" is a hard requirement, not
    // one that's allowed to depend on the tab having focus.
    window.setTimeout(callOnDoneOnce, durationMs + 200);
  }, []);

  // Escape always gets back to the dashboard, regardless of sub-phase -
  // "never trap the user on the globe" is a hard requirement.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") finish();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [finish]);

  // A failed request gets the fast exit the instant it's known, rather
  // than sitting through the rest of the intro for a trip that isn't
  // coming.
  const prevFailedRef = useRef(false);
  useEffect(() => {
    if (failed && !prevFailedRef.current) finish(true);
    prevFailedRef.current = failed;
  }, [failed, finish]);

  // Globe display size tracks the viewport (see computeGlobeSize) so a
  // resize/orientation change keeps the "min(vw, vh), biased larger" sizing
  // honest rather than freezing at whatever size the takeover happened to
  // open at.
  useEffect(() => {
    function onResize() {
      setGlobeSize(computeGlobeSize());
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Bottom-strip phase captions, advancing on the same fixed timer
  // LoadingSteps used - stops advancing (and gets superseded by the route
  // summary) once `plan` resolves.
  useEffect(() => {
    if (plan) return;
    const id = setInterval(() => setStepIndex((i) => Math.min(i + 1, STEPS.length - 1)), STEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [plan]);

  // The "ready" gate: only advance once BOTH the minimum intro duration has
  // elapsed AND the plan has resolved, whichever finishes second. Each
  // effect below independently re-checks both conditions via refs/props
  // rather than assuming it's the one that satisfies the gate, so the
  // order they resolve in doesn't matter.
  useEffect(() => {
    const timer = setTimeout(() => {
      introElapsedRef.current = true;
      if (planRef.current) setSubPhase((cur) => (cur === "intro" ? "ready" : cur));
    }, MIN_INTRO_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!plan) return;
    if (introElapsedRef.current) setSubPhase((cur) => (cur === "intro" ? "ready" : cur));
  }, [plan]);

  // Entering "explore" clears `focus` so RouteGlobe's per-frame easing
  // stops pulling rotation back toward the trip midpoint - otherwise every
  // drag the user makes would get tugged back the instant they let go,
  // which reads as broken rather than interactive.
  useEffect(() => {
    if (subPhase === "explore") setFocus(null);
    if (subPhase === "ready") primaryBtnRef.current?.focus();
  }, [subPhase]);

  // Entrance: overlay fades in while the globe scales up from smaller -
  // the "zoomed in slowly" establishing beat. Runs once per mount; App
  // remounts this whole component (via a submission-id `key`) on every new
  // submit, so a rapid resubmit always gets a fresh instance/timeline
  // rather than stacking onto a live one.
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.fromTo(containerRef.current, { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power2.out" });
        gsap.fromTo(
          globeWrapRef.current,
          { scale: 0.62, opacity: 0.5 },
          { scale: 1, opacity: 1, duration: 1.1, ease: "power3.out" },
        );
      });
      mm.add("(prefers-reduced-motion: reduce)", () => {
        gsap.set(containerRef.current, { opacity: 1 });
        gsap.set(globeWrapRef.current, { scale: 1, opacity: 1 });
      });
      return () => mm.revert();
    },
    { scope: containerRef },
  );

  // Marker pop-in + staged arc draw, once the real trip data is known.
  // Structurally the same choreography the old RouteReveal used (see its
  // history for the fuller "why cobe can't truly stroke-draw an arc"
  // rationale) - stagger *when* each arc enters the shared arcs array while
  // the shared arcWidth/arcHeight grow from a sliver, so arc 1 visibly
  // grows in current->pickup direction and arc 2 joins already mid-growth.
  useGSAP(
    () => {
      if (!plan) return;
      const { current, pickup, dropoff } = plan.locations;

      setFocus([(current.lat + pickup.lat + dropoff.lat) / 3, (current.lng + pickup.lng + dropoff.lng) / 3]);

      const realMarkers: GlobeMarker[] = [
        { lat: current.lat, lng: current.lng, size: 0 },
        { lat: pickup.lat, lng: pickup.lng, size: 0 },
        { lat: dropoff.lat, lng: dropoff.lng, size: 0 },
      ];
      const targetSizes = [0.09, 0.105, 0.105];

      const mm = gsap.matchMedia();

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const tl = gsap.timeline();
        const reveal = { p: 0 };

        tl.call(() => setMarkers(realMarkers.map((m) => ({ ...m }))));
        tl.to(reveal, {
          p: 1,
          duration: 0.5,
          ease: "power1.out",
          onUpdate: () => {
            chipRevealRef.current = reveal.p;
          },
        });
        realMarkers.forEach((marker, i) => {
          tl.to(
            marker,
            {
              size: targetSizes[i],
              duration: 0.3,
              ease: "back.out(2)",
              onUpdate: () => setMarkers(realMarkers.map((m) => ({ ...m }))),
            },
            i * 0.12,
          );
        });

        tl.call(
          () => setArcs([{ fromLat: current.lat, fromLng: current.lng, toLat: pickup.lat, toLng: pickup.lng }]),
          [],
          0.55,
        );
        const arcGrow = { p: 0 };
        tl.to(
          arcGrow,
          {
            p: 1,
            duration: 0.7,
            ease: "power2.out",
            onUpdate: () => {
              setArcWidth(0.08 + arcGrow.p * 0.42);
              setArcHeight(0.04 + arcGrow.p * 0.21);
            },
          },
          0.55,
        );
        tl.call(
          () =>
            setArcs([
              { fromLat: current.lat, fromLng: current.lng, toLat: pickup.lat, toLng: pickup.lng },
              { fromLat: pickup.lat, fromLng: pickup.lng, toLat: dropoff.lat, toLng: dropoff.lng },
            ]),
          [],
          0.95,
        );

        return () => tl.kill();
      });

      mm.add("(prefers-reduced-motion: reduce)", () => {
        chipRevealRef.current = 1;
        setMarkers(realMarkers.map((m, i) => ({ ...m, size: targetSizes[i] })));
        setArcs([
          { fromLat: current.lat, fromLng: current.lng, toLat: pickup.lat, toLng: pickup.lng },
          { fromLat: pickup.lat, fromLng: pickup.lng, toLat: dropoff.lat, toLng: dropoff.lng },
        ]);
      });

      return () => mm.revert();
    },
    { scope: containerRef, dependencies: [plan] },
  );

  // Completion panel + dimming scrim - fades in on "ready", fades back out
  // (and detaches from layout) on "explore" so a dismissed panel can't
  // still eat clicks/tab stops over the now-interactive globe.
  useGSAP(
    () => {
      if (subPhase === "ready") {
        if (reducedMotionNow()) {
          gsap.set(panelRef.current, { display: "flex", opacity: 1, scale: 1, y: 0 });
          gsap.set(scrimRef.current, { opacity: 1 });
          return;
        }
        gsap.set(panelRef.current, { display: "flex" });
        gsap.fromTo(scrimRef.current, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power2.out" });
        gsap.fromTo(
          panelRef.current,
          { opacity: 0, y: 16, scale: 0.96 },
          { opacity: 1, y: 0, scale: 1, duration: 0.45, ease: "back.out(1.4)" },
        );
      } else if (subPhase === "explore") {
        if (reducedMotionNow()) {
          gsap.set(panelRef.current, { display: "none" });
          gsap.set(scrimRef.current, { opacity: 0 });
          return;
        }
        gsap.to(scrimRef.current, { opacity: 0, duration: 0.35, ease: "power2.in" });
        gsap.to(panelRef.current, {
          opacity: 0,
          y: 12,
          scale: 0.96,
          duration: 0.3,
          ease: "power2.in",
          onComplete: () => gsap.set(panelRef.current, { display: "none" }),
        });
      }
    },
    { scope: containerRef, dependencies: [subPhase] },
  );

  // Per-frame chip tracking: projects each real marker's lat/lng through
  // the globe's *current* (phi, theta) - not the `focus` target, which the
  // rotation is only easing toward - onto the unit circle, then scales that
  // into pixels within the globe wrapper's own box. Written straight to the
  // chip DOM nodes (bypassing React state) since this runs every animation
  // frame; going through setState here would mean a full render 60x/sec.
  const handleFrame = useCallback((phi: number, theta: number) => {
    const p = planRef.current;
    if (!p) {
      for (const el of Object.values(chipRefs.current)) if (el) el.style.opacity = "0";
      return;
    }
    const r = radiusRef.current * 0.86;
    const reveal = chipRevealRef.current;
    const entries: Array<[ChipKey, { lat: number; lng: number }]> = [
      ["current", p.locations.current],
      ["pickup", p.locations.pickup],
      ["dropoff", p.locations.dropoff],
    ];
    for (const [key, loc] of entries) {
      const el = chipRefs.current[key];
      if (!el) continue;
      const { x, y, z } = projectLocation(loc.lat, loc.lng, phi, theta);
      // z < ~0.12 means the point has rotated onto (or near) the far
      // hemisphere - hide the chip rather than let it float over empty
      // ocean-colored globe with no marker dot under it.
      if (z < 0.12) {
        el.style.opacity = "0";
        continue;
      }
      const px = r + x * r;
      const py = r - y * r - 14; // 14px: float the chip just above its dot
      el.style.transform = `translate(${px}px, ${py}px) translate(-50%, -100%)`;
      el.style.opacity = String(Math.min(1, (z - 0.12) / 0.22) * reveal);
    }
  }, []);

  return (
    <div className="route-takeover" ref={containerRef} role="status" aria-live="polite">
      {/* KineticGrid (Polish K) is this overlay's backdrop - behind the
          globe/arcs/chips/caption/panel, filling the full takeover (see
          `.route-takeover .route-takeover__grid` in RouteTakeover.css). Its
          canvas is pointer-events: none, so Skip/Explore/View-details stay
          fully clickable through it. */}
      <KineticGrid className="route-takeover__grid" contentClassName="route-takeover__grid-content">
        <div
          className="route-takeover__globe-wrap"
          ref={globeWrapRef}
          style={{ width: globeSize, height: globeSize }}
        >
          {globeSupported && (
            <RouteGlobe
              size={globeSize}
              markers={markers}
              arcs={arcs}
              arcWidth={arcWidth}
              arcHeight={arcHeight}
              focus={focus}
              interactive={subPhase === "explore"}
              onFrame={handleFrame}
              onSupportChange={(ok) => {
                setGlobeSupported(ok);
                if (!ok && !unsupportedFiredRef.current) {
                  unsupportedFiredRef.current = true;
                  onUnsupportedRef.current();
                }
              }}
            />
          )}

          {plan && (
            <>
              <MarkerChip variant="current" label={cityLabel(plan.locations.current.display_name)} setEl={(el) => { chipRefs.current.current = el; }} />
              <MarkerChip variant="pickup" label={cityLabel(plan.locations.pickup.display_name)} setEl={(el) => { chipRefs.current.pickup = el; }} />
              <MarkerChip variant="dropoff" label={cityLabel(plan.locations.dropoff.display_name)} setEl={(el) => { chipRefs.current.dropoff = el; }} />
            </>
          )}
        </div>

        {subPhase === "intro" && (
          <button type="button" className="route-takeover__skip" onClick={() => finish()}>
            Skip
            <span aria-hidden="true">&rarr;</span>
          </button>
        )}

        {captionText && <p className="route-takeover__caption">{captionText}</p>}

        <div className="route-takeover__scrim" ref={scrimRef} aria-hidden="true" />

        <div className="route-takeover__panel" ref={panelRef} aria-hidden={subPhase !== "ready"}>
          {plan && routeSummary && (
            <>
              <h2 className="route-takeover__panel-title">Route planned</h2>
              <p className="route-takeover__panel-summary">{routeSummary}</p>
              <div className="route-takeover__panel-actions">
                <button
                  type="button"
                  ref={primaryBtnRef}
                  className="route-takeover__btn route-takeover__btn--primary"
                  onClick={() => finish()}
                >
                  View trip details
                </button>
                <button
                  type="button"
                  className="route-takeover__btn route-takeover__btn--secondary"
                  onClick={() => setSubPhase("explore")}
                >
                  Explore route
                </button>
              </div>
            </>
          )}
        </div>

        {subPhase === "explore" && (
          <button type="button" className="route-takeover__persist" onClick={() => finish()}>
            View trip details
          </button>
        )}
      </KineticGrid>
    </div>
  );
}

function MarkerChip({
  variant,
  label,
  setEl,
}: {
  variant: ChipKey;
  label: string;
  setEl: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div ref={setEl} className={`route-takeover__chip route-takeover__chip--${variant}`} style={{ opacity: 0 }}>
      <span className="route-takeover__chip-dot" aria-hidden="true" />
      {label}
    </div>
  );
}
