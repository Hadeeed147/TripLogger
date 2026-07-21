import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import "./TripTimeline.css";
import type { SegmentDto, Status, Stop, TripPlan } from "../../api/types";
import { formatArrival, formatDuration, formatMiles, STOP_META } from "../RouteMap/markers";
import { formatDayLabel } from "../../utils/dayLabel";
import { buildStepPath } from "../LogSheet/stepPath";

gsap.registerPlugin(useGSAP);

interface TripTimelineProps {
  plan: TripPlan;
  /** Which day's tab is currently active - drives which day-label reads as
   *  "selected" (Polish D lifts this state up to App so a block click here
   *  can switch DayTabs' active tab too). */
  activeIndex: number;
  onSelectDay: (index: number) => void;
}

const STATUS_LABEL: Record<Status, string> = {
  off: "Off Duty",
  sleeper: "Sleeper Berth",
  driving: "Driving",
  on_duty: "On Duty",
};

const STATUS_VAR: Record<Status, string> = {
  off: "--status-off",
  sleeper: "--status-sleeper",
  driving: "--status-driving",
  on_duty: "--status-on-duty",
};

const ROW_ORDER: Status[] = ["off", "sleeper", "driving", "on_duty"];

/** Compact row-caption glyphs for the mini step-line - the full "Off Duty" /
 *  "Sleeper Berth" labels (used in tooltips + the legend) are too wide for a
 *  ~16px-tall row lane, so each row gets a 2-3 letter mark instead. */
const ROW_LABEL_SHORT: Record<Status, string> = {
  off: "OFF",
  sleeper: "SB",
  driving: "D",
  on_duty: "ON",
};

// ---------------------------------------------------------------------------
// Chart scale. `HOUR_PX` is "pixels per hour" - the same quantity stepPath.ts's
// `colWidth` parameter expects - so a multi-day trip simply gets wider
// (scrolled horizontally, see .trip-timeline__scroll) rather than crushing
// every day into a fixed width.
// ---------------------------------------------------------------------------
const HOUR_PX = 16;
const LEFT_LABEL_WIDTH = 26;
const ROW_H = 22;
const GLYPH_ROW_H = 20;
const ROWS_TOP = GLYPH_ROW_H + 8;
const ROWS_BOTTOM = ROWS_TOP + ROW_H * ROW_ORDER.length;
const TICK_H = 5;
const DAYLABEL_ROW_H = 18;
const SVG_HEIGHT = ROWS_BOTTOM + TICK_H + DAYLABEL_ROW_H + 4;
const MIN_CHART_WIDTH = 460;

const ROW_Y_TOP: Record<Status, number> = Object.fromEntries(
  ROW_ORDER.map((status, i) => [status, ROWS_TOP + i * ROW_H]),
) as Record<Status, number>;

const ROW_Y_MID: Record<Status, number> = Object.fromEntries(
  ROW_ORDER.map((status) => [status, ROW_Y_TOP[status] + ROW_H / 2]),
) as Record<Status, number>;

interface DaySpan {
  index: number;
  label: string;
  startMs: number;
  endMs: number;
}

/** Local (not UTC) midnight for a "YYYY-MM-DD" log date - the boundary a new
 *  calendar day starts at, matching LogSheet/DayTabs' own date handling. */
function localMidnight(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
}

/** "YYYY-MM-DD" for a Date, in local time (not `toISOString`, which is UTC
 *  and can roll the calendar date in negative-offset timezones). */
function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** A segment counts as (part of) a 34-hour restart only if it is itself
 *  off-duty time AND its [start, end) range overlaps a "restart" stop's
 *  window at all. The status gate matters: a restart stop's own duration
 *  can loosely overlap the driving/on-duty segments immediately before it
 *  (the stop's `arrival` marks when the truck reached the rest location,
 *  not when the prior duty segment ended), so without it a departure
 *  drive right before a restart would incorrectly get the striped overlay
 *  too. */
function overlapsRestart(status: Status, segStartMs: number, segEndMs: number, stops: Stop[]): boolean {
  if (status !== "off") return false;
  return stops.some((stop) => {
    if (stop.type !== "restart") return false;
    const stopStart = new Date(stop.arrival).getTime();
    const stopEnd = stopStart + stop.duration_min * 60_000;
    return segStartMs < stopEnd && segEndMs > stopStart;
  });
}

/** "8:00 PM"-style local clock, used inside the rich tooltip (formatArrival's
 *  "EEE HH:mm" repeats the weekday per side, which is redundant once the day
 *  is already named by its own label underneath the chart). */
function formatClock(iso: string): string {
  return formatClockMs(new Date(iso).getTime());
}

function formatClockMs(ms: number): string {
  const d = new Date(ms);
  const hours = d.getHours();
  const period = hours >= 12 ? "PM" : "AM";
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${h12}:${mm} ${period}`;
}

/** "Wed 14:30"-style chip text for the scrubber - 24h clock (distinct from
 *  the tooltip's 12h "8:00 PM" so the two never look like the same format
 *  reporting different things). */
function formatChipTime(ms: number): string {
  const d = new Date(ms);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${days[d.getDay()]} ${hh}:${mm}`;
}

/** Strips the outer `<svg viewBox="...">...</svg>` wrapper from a
 *  markers.ts glyph string, leaving just the inner markup to drop into our
 *  own nested `<svg>` (which supplies its own viewBox/size). */
function glyphInner(markup: string): string {
  return markup.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
}

interface ScrubState {
  xPx: number;
  ms: number;
}

/**
 * The whole trip as one continuous mini ELD step-line: four faint duty-row
 * guide-lines, soft status-colored underlay bands, a single navy step-line
 * (built by the same `buildStepPath` helper LogSheet uses per day - see
 * stepPath.ts's generalized `totalMinutes` arg) drawn across every day,
 * stop glyphs pinned along the top edge, day-boundary rules/labels below,
 * and a pointer scrubber. Clicking (or activating via keyboard) anywhere in
 * a day's span switches DayTabs to that day - see the lifted
 * `activeIndex`/`onSelectDay` above.
 */
export default function TripTimeline({ plan, activeIndex, onSelectDay }: TripTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const [scrub, setScrub] = useState<ScrubState | null>(null);

  const { segments, daySpans, rangeStartMs, rangeEndMs } = useMemo(() => buildLayout(plan), [plan]);

  const totalMinutes = Math.max((rangeEndMs - rangeStartMs) / 60_000, 1);
  const chartWidth = Math.max(LEFT_LABEL_WIDTH + totalMinutes * (HOUR_PX / 60), MIN_CHART_WIDTH);

  const xAtMs = (ms: number) => LEFT_LABEL_WIDTH + ((ms - rangeStartMs) / 60_000) * (HOUR_PX / 60);

  const stepPath = useMemo(() => {
    const grid = segments.map((seg) => ({
      status: seg.status,
      start_min: (new Date(seg.start).getTime() - rangeStartMs) / 60_000,
      end_min: (new Date(seg.end).getTime() - rangeStartMs) / 60_000,
    }));
    return buildStepPath(grid, LEFT_LABEL_WIDTH, HOUR_PX, ROW_Y_MID, totalMinutes);
  }, [segments, rangeStartMs, totalMinutes]);

  function dayIndexForMs(ms: number): number {
    const key = localDateKey(new Date(ms));
    const found = plan.logs.findIndex((log) => log.date === key);
    if (found !== -1) return found;
    // Segment falls outside every day's date (e.g. a restart segment that
    // runs past the last logged day) - clamp to the nearest day instead of
    // losing the click.
    return ms < rangeStartMs + (rangeEndMs - rangeStartMs) / 2 ? 0 : plan.logs.length - 1;
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.pointerType !== "mouse") return;
    const rect = chartRef.current?.getBoundingClientRect();
    if (!rect) return;
    const xPx = Math.min(Math.max(e.clientX - rect.left, LEFT_LABEL_WIDTH), chartWidth);
    const ms = rangeStartMs + ((xPx - LEFT_LABEL_WIDTH) / (HOUR_PX / 60)) * 60_000;
    setScrub({ xPx, ms: Math.min(Math.max(ms, rangeStartMs), rangeEndMs) });
  }

  useGSAP(
    () => {
      const bands = gsap.utils.toArray<SVGElement>(".trip-timeline-mini__band-fill", containerRef.current);
      const path = containerRef.current?.querySelector<SVGPathElement>(".trip-timeline-mini__stepline");
      const glyphs = gsap.utils.toArray<SVGElement>(".trip-timeline-mini__glyph", containerRef.current);
      if (!path) return;

      const mm = gsap.matchMedia();

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const length = path.getTotalLength();
        gsap.set(bands, { opacity: 0 });
        gsap.set(path, { strokeDasharray: length, strokeDashoffset: length });
        gsap.set(glyphs, { scale: 0, opacity: 0, transformOrigin: "center" });

        const tl = gsap.timeline();
        tl.to(bands, { opacity: 1, duration: 0.35, stagger: 0.015, ease: "power1.out" })
          .to(path, { strokeDashoffset: 0, duration: Math.min(1.2, 0.5 + length / 900), ease: "power2.out" }, "-=0.1")
          .to(glyphs, { scale: 1, opacity: 1, duration: 0.3, stagger: 0.04, ease: "back.out(1.7)" }, "-=0.25");
      });

      mm.add("(prefers-reduced-motion: reduce)", () => {
        gsap.set(bands, { opacity: 1 });
        gsap.set(path, { strokeDashoffset: 0 });
        gsap.set(glyphs, { scale: 1, opacity: 1 });
      });

      return () => mm.revert();
    },
    { scope: containerRef, dependencies: [plan] },
  );

  if (segments.length === 0) return null;

  return (
    <div className="trip-timeline" ref={containerRef}>
      <div className="trip-timeline__header">
        <h2 className="trip-timeline__title">Trip Timeline</h2>
        <div className="trip-timeline__legend">
          {ROW_ORDER.map((status) => (
            <span className="trip-timeline__legend-item" key={status}>
              <span className="trip-timeline__legend-swatch" style={{ background: `var(${STATUS_VAR[status]})` }} />
              {STATUS_LABEL[status]}
            </span>
          ))}
          <span className="trip-timeline__legend-item">
            <span className="trip-timeline__legend-swatch trip-timeline__legend-swatch--restart" />
            34-hr Restart
          </span>
        </div>
      </div>

      <div className="trip-timeline__scroll">
        <div
          className="trip-timeline__chart"
          ref={chartRef}
          style={{ width: chartWidth }}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setScrub(null)}
        >
          <svg
            className="trip-timeline-mini__svg"
            width={chartWidth}
            height={SVG_HEIGHT}
            viewBox={`0 0 ${chartWidth} ${SVG_HEIGHT}`}
            role="img"
            aria-label="Trip duty-status timeline, all days"
          >
            <defs>
              <pattern
                id="trip-timeline-restart-hatch"
                width="5"
                height="5"
                patternTransform="rotate(45)"
                patternUnits="userSpaceOnUse"
              >
                <rect width="5" height="5" className="trip-timeline-mini__hatch-bg" />
                <line x1="0" y1="0" x2="0" y2="5" className="trip-timeline-mini__hatch-line" />
              </pattern>
            </defs>

            {/* Faint row guide-lines + compact row labels. */}
            {ROW_ORDER.map((status) => (
              <g key={status}>
                <line
                  x1={LEFT_LABEL_WIDTH}
                  x2={chartWidth}
                  y1={ROW_Y_MID[status]}
                  y2={ROW_Y_MID[status]}
                  className="trip-timeline-mini__guide"
                />
                <text x={2} y={ROW_Y_MID[status] + 3} className="trip-timeline-mini__rowlabel">
                  {ROW_LABEL_SHORT[status]}
                </text>
              </g>
            ))}

            {/* Soft colored underlay bands, one per duty segment, dimmed via
                fill-opacity (permanent) - entrance opacity (GSAP) is a
                separate channel so "how dim" and "fade-in" don't multiply. */}
            {segments.map((seg, i) => {
              const startMs = new Date(seg.start).getTime();
              const endMs = new Date(seg.end).getTime();
              const x = xAtMs(startMs);
              const w = Math.max(xAtMs(endMs) - x, 0.5);
              const top = ROW_Y_TOP[seg.status];
              const isRestart = overlapsRestart(seg.status, startMs, endMs, plan.stops);
              return (
                <g className="trip-timeline-mini__band-fill" key={`band-${seg.start}-${i}`}>
                  <rect
                    x={x}
                    y={top}
                    width={w}
                    height={ROW_H}
                    className="trip-timeline-mini__band"
                    style={{ fill: `var(${STATUS_VAR[seg.status]})` }}
                  />
                  {isRestart && (
                    <rect
                      x={x}
                      y={top}
                      width={w}
                      height={ROW_H}
                      fill="url(#trip-timeline-restart-hatch)"
                      className="trip-timeline-mini__restart-overlay"
                    />
                  )}
                </g>
              );
            })}

            {/* Minor ticks at 6h/noon/18h within each day. */}
            {daySpans.flatMap((day) =>
              [6, 12, 18].map((h) => {
                const tickMs = day.startMs + h * 3_600_000;
                if (tickMs <= rangeStartMs || tickMs >= rangeEndMs) return null;
                const x = xAtMs(tickMs);
                return (
                  <line
                    key={`tick-${day.index}-${h}`}
                    x1={x}
                    x2={x}
                    y1={ROWS_BOTTOM}
                    y2={ROWS_BOTTOM + TICK_H}
                    className="trip-timeline-mini__tick"
                  />
                );
              }),
            )}

            {/* Day-boundary rules - poke slightly past the row block so they
                read as ruler ticks rather than part of a band. */}
            {daySpans.slice(1).map((day) => (
              <line
                key={`daymark-${day.index}`}
                x1={xAtMs(day.startMs)}
                x2={xAtMs(day.startMs)}
                y1={GLYPH_ROW_H - 4}
                y2={ROWS_BOTTOM + TICK_H}
                className="trip-timeline-mini__daymark"
              />
            ))}

            {/* The continuous duty-status step-line across every day. */}
            <path d={stepPath} className="trip-timeline-mini__stepline" fill="none" />

            {/* Stop glyph chips pinned along the top edge. */}
            {plan.stops.map((stop, i) => {
              const ms = new Date(stop.arrival).getTime();
              if (ms < rangeStartMs || ms > rangeEndMs) return null;
              const x = xAtMs(ms);
              const meta = STOP_META[stop.type];
              return (
                <g
                  key={`stop-${i}`}
                  className="trip-timeline-mini__glyph"
                  transform={`translate(${x}, ${GLYPH_ROW_H / 2})`}
                  role="img"
                  aria-label={`${meta.label}, ${formatArrival(stop.arrival)}`}
                >
                  <title>{`${meta.label} - ${formatArrival(stop.arrival)}`}</title>
                  <circle r={7} className="trip-timeline-mini__glyph-bg" style={{ fill: `var(${meta.colorVar})` }} />
                  <svg
                    x={-5}
                    y={-5}
                    width={10}
                    height={10}
                    viewBox="0 0 24 24"
                    className="trip-timeline-mini__glyph-icon"
                    dangerouslySetInnerHTML={{ __html: glyphInner(meta.glyph) }}
                  />
                </g>
              );
            })}
          </svg>

          {/* HTML overlay: per-segment click/keyboard targets + the rich
              hover/focus tooltip - a bigger hit area (the full row block,
              not just the segment's own row) than the visual band beneath
              it, so "click anywhere in a day's span" is an easy target. */}
          <div className="trip-timeline-mini__overlay" role="list" aria-label="Duty status timeline">
            {segments.map((seg, i) => {
              const startMs = new Date(seg.start).getTime();
              const endMs = new Date(seg.end).getTime();
              const left = xAtMs(startMs);
              const width = Math.max(xAtMs(endMs) - left, 2);
              const isRestart = overlapsRestart(seg.status, startMs, endMs, plan.stops);
              const durationMin = Math.max((endMs - startMs) / 60_000, 0);

              const tooltip = [
                STATUS_LABEL[seg.status],
                `${formatClock(seg.start)} - ${formatClock(seg.end)}`,
                formatDuration(durationMin),
                seg.status === "driving" && seg.miles > 0 ? `${formatMiles(seg.miles)} mi` : null,
                seg.location_hint || null,
              ]
                .filter(Boolean)
                .join(" | ");

              return (
                <button
                  key={`seg-${seg.start}-${i}`}
                  type="button"
                  role="listitem"
                  className="trip-timeline-mini__hit"
                  style={{ left, width, top: ROWS_TOP, height: ROW_H * ROW_ORDER.length }}
                  onClick={() => onSelectDay(dayIndexForMs(startMs))}
                  aria-label={`${STATUS_LABEL[seg.status]}, ${formatArrival(seg.start)} to ${formatArrival(seg.end)}${seg.status === "driving" && seg.miles > 0 ? `, ${formatMiles(seg.miles)} miles` : ""}${isRestart ? ", 34-hour restart" : ""}`}
                >
                  <span className="trip-timeline-mini__tooltip">{tooltip}</span>
                </button>
              );
            })}
          </div>

          {/* Day labels row. */}
          <div className="trip-timeline-mini__daylabels">
            {daySpans.map((day) => (
              <button
                key={day.index}
                type="button"
                className={`trip-timeline-mini__daylabel${day.index === activeIndex ? " trip-timeline-mini__daylabel--active" : ""}`}
                style={{ left: (xAtMs(day.startMs) + xAtMs(day.endMs)) / 2 }}
                onClick={() => onSelectDay(day.index)}
              >
                {day.label}
              </button>
            ))}
          </div>

          {/* Pointer scrubber - mouse only (touch keeps the tap-tooltip
              behavior above, no scrubbing requirement for touch). */}
          {scrub && (
            <>
              <div className="trip-timeline-mini__scrub-line" style={{ left: scrub.xPx }} aria-hidden="true" />
              <div className="trip-timeline-mini__scrub-chip" style={{ left: scrub.xPx }} aria-hidden="true">
                {formatChipTime(scrub.ms)}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Precomputes everything the render pass needs off `plan`: the segment
 *  list (defensively empty-safe), each day's [start, end) span + label for
 *  the boundary rules/labels, and the overall trip time range they're all
 *  plotted against. */
function buildLayout(plan: TripPlan): {
  segments: SegmentDto[];
  daySpans: DaySpan[];
  rangeStartMs: number;
  rangeEndMs: number;
} {
  const segments = plan.segments ?? [];

  const daySpans: DaySpan[] = plan.logs.map((log, index) => {
    const startMs = localMidnight(log.date).getTime();
    const nextIso = plan.logs[index + 1]?.date;
    const endMs = nextIso ? localMidnight(nextIso).getTime() : startMs + 24 * 60 * 60_000;
    return { index, label: formatDayLabel(log.date), startMs, endMs };
  });

  const segmentTimes = segments.flatMap((s) => [new Date(s.start).getTime(), new Date(s.end).getTime()]);
  const dayTimes = daySpans.flatMap((d) => [d.startMs, d.endMs]);
  const allTimes = [...segmentTimes, ...dayTimes];

  const rangeStartMs = allTimes.length > 0 ? Math.min(...allTimes) : 0;
  const rangeEndMs = allTimes.length > 0 ? Math.max(...allTimes) : 1;

  return { segments, daySpans, rangeStartMs, rangeEndMs };
}
