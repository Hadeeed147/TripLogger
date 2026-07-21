import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import RouteGlobe, { FREIGHT_HUB_MARKERS, type GlobeArc, type GlobeMarker } from "./RouteGlobe/RouteGlobe";
import type { TripPlan } from "../api/types";
import "./RouteReveal.css";

gsap.registerPlugin(useGSAP);

interface RouteRevealProps {
  plan: TripPlan;
  /** Called exactly once - either when the choreographed sequence finishes
   *  on its own or when the user skips it. The caller treats both the same
   *  way: swap straight to the fully-rendered dashboard. */
  onDone: () => void;
}

/** First comma-separated component of a Nominatim display_name, e.g.
 *  "Chicago, Cook County, Illinois, USA" -> "Chicago". */
function cityLabel(displayName: string): string {
  return displayName.split(",")[0]?.trim() || displayName;
}

/**
 * Post-submit "route reveal": takes over the instant the API call succeeds,
 * replacing LoadingSteps rather than cutting straight to the dashboard.
 * Eases the globe's rotation to center the trip midpoint, pops in the three
 * real stop markers, draws in the two route arcs, swaps the caption to a
 * one-line route summary, then fades out and hands off cleanly to the
 * dashboard's own entrance (which mounts only once this component has
 * unmounted, so it never double-fires).
 *
 * Always skippable (visible button + Escape) and self-bounded to well under
 * ~3.5s by construction (see the timeline positions below) - no animation
 * here is allowed to be the only way to reach the result.
 */
export default function RouteReveal({ plan, onDone }: RouteRevealProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [globeSupported, setGlobeSupported] = useState(true);
  const [caption, setCaption] = useState("Charting your route…");
  const [markers, setMarkers] = useState<GlobeMarker[]>(FREIGHT_HUB_MARKERS);
  const [arcs, setArcs] = useState<GlobeArc[]>([]);
  const [arcWidth, setArcWidth] = useState(0.08);
  const [arcHeight, setArcHeight] = useState(0.04);

  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const finishedRef = useRef(false);

  const { current, pickup, dropoff } = plan.locations;

  const focus = useMemo<[number, number]>(
    () => [
      (current.lat + pickup.lat + dropoff.lat) / 3,
      (current.lng + pickup.lng + dropoff.lng) / 3,
    ],
    [current.lat, current.lng, pickup.lat, pickup.lng, dropoff.lat, dropoff.lng],
  );

  const routeSummary = useMemo(
    () =>
      `${cityLabel(current.display_name)} → ${cityLabel(pickup.display_name)} → ${cityLabel(
        dropoff.display_name,
      )} · ${Math.round(plan.summary.total_miles).toLocaleString()} mi`,
    [current.display_name, pickup.display_name, dropoff.display_name, plan.summary.total_miles],
  );

  function finish() {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onDoneRef.current();
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") finish();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useGSAP(
    () => {
      const realMarkers: GlobeMarker[] = [
        { lat: current.lat, lng: current.lng, size: 0 },
        { lat: pickup.lat, lng: pickup.lng, size: 0 },
        { lat: dropoff.lat, lng: dropoff.lng, size: 0 },
      ];
      // Slightly larger than FREIGHT_HUB_MARKERS' 0.045-0.08 range, so the
      // three real stops read as "the point" once they pop in.
      const targetSizes = [0.085, 0.1, 0.1];

      const tl = gsap.timeline({ onComplete: finish });

      // Swap away from the decorative hub markers once the globe has had a
      // beat to visibly start turning toward `focus` (a stable prop applied
      // continuously from mount - see RouteGlobe's own easing).
      tl.call(() => setMarkers(realMarkers.map((m) => ({ ...m }))), [], 0.6);

      realMarkers.forEach((marker, i) => {
        tl.to(
          marker,
          {
            size: targetSizes[i],
            duration: 0.3,
            ease: "back.out(2)",
            onUpdate: () => setMarkers(realMarkers.map((m) => ({ ...m }))),
          },
          0.6 + i * 0.12,
        );
      });

      // Arcs: cobe has no progressive/partial stroke draw, and arcWidth /
      // arcHeight are single uniforms shared by *every* arc (not per-arc) -
      // so true independent per-arc fade-in isn't achievable with this
      // library (verified against its source: `update()` rebuilds one
      // shared buffer from the whole arcs array on every call, and the
      // fragment shader writes alpha=1 unconditionally, so per-arc color
      // can't be used to fade one out either). The closest honest
      // approximation: stagger *when* each arc enters the array
      // (current->pickup, then pickup->dropoff) while the shared
      // width/height grow from a thin sliver to full size across that same
      // window, so arc 1 visibly grows out and arc 2 pops in already
      // mid-growth and finishes alongside it - a real scale-in, not a
      // canvas-overlay fake.
      tl.call(
        () => setArcs([{ fromLat: current.lat, fromLng: current.lng, toLat: pickup.lat, toLng: pickup.lng }]),
        [],
        1.15,
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
        1.15,
      );
      tl.call(
        () =>
          setArcs([
            { fromLat: current.lat, fromLng: current.lng, toLat: pickup.lat, toLng: pickup.lng },
            { fromLat: pickup.lat, fromLng: pickup.lng, toLat: dropoff.lat, toLng: dropoff.lng },
          ]),
        [],
        1.55,
      );

      tl.call(() => setCaption(routeSummary), [], 2.05);

      // Hand off to the dashboard: fade/scale this whole panel out, then
      // `onComplete` (finish) unmounts it and mounts ResultsDashboard, whose
      // own GSAP entrance runs for the first time at that point - no
      // double-trigger since this component is gone by then.
      tl.to(containerRef.current, { opacity: 0, scale: 0.97, duration: 0.5, ease: "power2.in" }, 2.75);
      // Total runtime ~3.25s - comfortably inside the ~3.5s cap.

      return () => {
        tl.kill();
      };
    },
    { scope: containerRef, dependencies: [plan] },
  );

  return (
    <div className="route-reveal" ref={containerRef} role="status" aria-live="polite">
      <button type="button" className="route-reveal__skip" onClick={finish}>
        Skip
        <span aria-hidden="true">&rarr;</span>
      </button>

      {globeSupported && (
        <div className="route-reveal__globe-wrap">
          <RouteGlobe
            size={240}
            markers={markers}
            arcs={arcs}
            arcWidth={arcWidth}
            arcHeight={arcHeight}
            focus={focus}
            interactive
            onSupportChange={setGlobeSupported}
          />
        </div>
      )}

      <p className="route-reveal__caption">{caption}</p>
    </div>
  );
}
