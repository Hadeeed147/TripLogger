import { useMemo, useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import "./TripTimeline.css";
import type { SegmentDto, Status, Stop, TripPlan } from "../../api/types";
import { formatArrival, formatDuration, formatMiles } from "../RouteMap/markers";
import { formatDayLabel } from "../../utils/dayLabel";

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

/** "8:00 PM"-style local clock, used inside the tooltip (formatArrival's
 *  "EEE HH:mm" repeats the weekday per side, which is redundant once the day
 *  is already named by its own label underneath the band). */
function formatClock(iso: string): string {
  const d = new Date(iso);
  const hours = d.getHours();
  const period = hours >= 12 ? "PM" : "AM";
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${h12}:${mm} ${period}`;
}

/**
 * A horizontal band spanning the full trip, one colored block per duty
 * segment, with day-boundary rules + labels underneath and a legend row.
 * Clicking (or activating via keyboard) a block switches DayTabs to the day
 * it starts on - see the lifted `activeIndex`/`onSelectDay` above.
 */
export default function TripTimeline({ plan, activeIndex, onSelectDay }: TripTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const { segments, daySpans, rangeStartMs, rangeEndMs } = useMemo(
    () => buildLayout(plan),
    [plan],
  );

  const rangeMs = Math.max(rangeEndMs - rangeStartMs, 1);
  const pct = (ms: number) => ((ms - rangeStartMs) / rangeMs) * 100;

  function dayIndexForMs(ms: number): number {
    const key = localDateKey(new Date(ms));
    const found = plan.logs.findIndex((log) => log.date === key);
    if (found !== -1) return found;
    // Segment falls outside every day's date (e.g. a restart segment that
    // runs past the last logged day) - clamp to the nearest day instead of
    // losing the click.
    return ms < rangeStartMs + rangeMs / 2 ? 0 : plan.logs.length - 1;
  }

  useGSAP(
    () => {
      const blocks = gsap.utils.toArray<HTMLElement>(".trip-timeline__block", containerRef.current);
      if (blocks.length === 0) return;

      const mm = gsap.matchMedia();

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.set(blocks, { scaleX: 0, transformOrigin: "left center" });
        gsap.to(blocks, { scaleX: 1, duration: 0.6, ease: "power2.out", stagger: 0.03 });
      });

      mm.add("(prefers-reduced-motion: reduce)", () => {
        gsap.set(blocks, { scaleX: 1 });
      });

      return () => mm.revert();
    },
    { scope: containerRef, dependencies: [plan] },
  );

  if (segments.length === 0) return null;

  return (
    <div className="trip-timeline" ref={containerRef}>
      <h2 className="trip-timeline__title">Trip Timeline</h2>

      <div className="trip-timeline__wrap">
        <div className="trip-timeline__band" role="list" aria-label="Duty status timeline">
          {segments.map((seg, i) => {
            const startMs = new Date(seg.start).getTime();
            const endMs = new Date(seg.end).getTime();
            const left = pct(startMs);
            const width = Math.max(pct(endMs) - left, 0.3);
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
                key={`${seg.start}-${i}`}
                type="button"
                role="listitem"
                className={`trip-timeline__block${isRestart ? " trip-timeline__block--restart" : ""}`}
                style={{ left: `${left}%`, width: `${width}%`, background: `var(${STATUS_VAR[seg.status]})` }}
                onClick={() => onSelectDay(dayIndexForMs(startMs))}
                aria-label={`${STATUS_LABEL[seg.status]}, ${formatArrival(seg.start)} to ${formatArrival(seg.end)}${seg.status === "driving" && seg.miles > 0 ? `, ${formatMiles(seg.miles)} miles` : ""}${isRestart ? ", 34-hour restart" : ""}`}
              >
                <span className="trip-timeline__tooltip">{tooltip}</span>
              </button>
            );
          })}

          {daySpans.slice(1).map((day) => (
            <div
              key={`boundary-${day.index}`}
              className="trip-timeline__daymark"
              style={{ left: `${pct(day.startMs)}%` }}
              aria-hidden="true"
            />
          ))}
        </div>

        <div className="trip-timeline__daylabels">
          {daySpans.map((day) => (
            <button
              key={day.index}
              type="button"
              className={`trip-timeline__daylabel${day.index === activeIndex ? " trip-timeline__daylabel--active" : ""}`}
              style={{ left: `${(pct(day.startMs) + pct(day.endMs)) / 2}%` }}
              onClick={() => onSelectDay(day.index)}
            >
              {day.label}
            </button>
          ))}
        </div>
      </div>

      <div className="trip-timeline__legend">
        {(["off", "sleeper", "driving", "on_duty"] as Status[]).map((status) => (
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
