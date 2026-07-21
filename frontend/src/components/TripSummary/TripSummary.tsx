import { useMemo, useRef, type ReactNode } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import "./TripSummary.css";
import type { SummaryDto } from "../../api/types";

gsap.registerPlugin(useGSAP);

interface TripSummaryProps {
  summary: SummaryDto;
}

interface NumericStat {
  key: string;
  label: string;
  icon: ReactNode;
  value: number;
  decimals: 0 | 1;
  unit: string;
}

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* -------------------------------------------------------------------------
   Icons - hand-rolled inline SVG, 24x24 / 1.75px round-cap convention (same
   set as TripForm's icons). Each icon has exactly one "hero" path tagged
   `.stat-icon-draw` - the single stroke that gets the GSAP dasharray
   draw-in on entrance. Secondary decoration (circles, dotted guide lines,
   frame rects) fades in with the card instead of drawing stroke-by-stroke -
   keeps the entrance "short + subtle" rather than over-choreographed.
------------------------------------------------------------------------- */

function RouteIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M6 8.5v3a4 4 0 0 0 4 4h4" strokeDasharray="1 3.2" />
      <path className="stat-icon-draw" d="M18 15.5v-7a4 4 0 0 0-4-4h-1" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="5" width="17" height="16" rx="2" />
      <path className="stat-icon-draw" d="M3.5 9.5h17" />
      <path d="M8 3v3.5" />
      <path d="M16 3v3.5" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.5" />
      <path className="stat-icon-draw" d="M12 7.5V12l3.2 2" />
    </svg>
  );
}

/** Crescent moon, stroke outline (not filled) so it takes the same
 *  dasharray draw-in treatment as every other icon in the set. */
function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path className="stat-icon-draw" d="M20 14.7A8.5 8.5 0 1 1 9.3 4a6.6 6.6 0 0 0 10.7 10.7z" />
    </svg>
  );
}

function FuelIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="9" height="18" rx="1.5" />
      <line x1="4" y1="9" x2="13" y2="9" />
      <path className="stat-icon-draw" d="M13 8h3l3 3v6.5a1.5 1.5 0 0 1-3 0V13" />
    </svg>
  );
}

/** Pause glyph in a ring - "a break in the driving clock." */
function BreaksIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.5" />
      <path className="stat-icon-draw" d="M10 8.7v6.6M14 8.7v6.6" />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 21V4" />
      <path className="stat-icon-draw" d="M6 4h11l-2.5 3.5L17 11H6" />
    </svg>
  );
}

function RestartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path className="stat-icon-draw" d="M3.5 12a8.5 8.5 0 1 0 2.7-6.2" />
      <path d="M3 4v5h5" />
    </svg>
  );
}

function pluralize(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
}

function formatNumber(value: number, decimals: 0 | 1): string {
  return decimals === 0 ? Math.round(value).toLocaleString() : value.toFixed(decimals);
}

/**
 * Hand-rolled "weekday, month day · HH:mm" + relative-day formatting
 * for the arrival card. Deliberately separate from RouteMap/markers'
 * `formatArrival` (which produces the terser "Tue 08:00" used on map
 * popups/timeline tooltips) - the hero-adjacent arrival card has room for
 * the fuller, friendlier format plus a second "in N days" line.
 */
function formatArrivalFull(iso: string): { primary: string; relative: string } {
  const arrival = new Date(iso);
  const now = new Date();

  const hh = String(arrival.getHours()).padStart(2, "0");
  const mm = String(arrival.getMinutes()).padStart(2, "0");
  const primary = `${WEEKDAYS[arrival.getDay()]}, ${MONTHS[arrival.getMonth()]} ${arrival.getDate()} · ${hh}:${mm}`;

  const arrivalDay = new Date(arrival.getFullYear(), arrival.getMonth(), arrival.getDate());
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((arrivalDay.getTime() - nowDay.getTime()) / 86_400_000);

  let relative: string;
  if (diffDays === 0) relative = "Arriving today";
  else if (diffDays === 1) relative = "Arriving tomorrow";
  else if (diffDays === -1) relative = "Arrived yesterday";
  else if (diffDays > 1) relative = `In ${diffDays} days`;
  else relative = `${Math.abs(diffDays)} days ago`;

  return { primary, relative };
}

interface CompactCardProps {
  stat: NumericStat;
  areaClassName?: string;
}

/** One small bento cell: icon chip + label + a `.stat-counter` figure that
 *  the entrance timeline count-up targets by class (in DOM order, matching
 *  the `stats` array order 1:1). */
function CompactCard({ stat, areaClassName }: CompactCardProps) {
  return (
    <div className={`stat-card stat-card--compact${areaClassName ? ` ${areaClassName}` : ""}`}>
      <div className="stat-card__header">
        <span className="stat-card__icon" aria-hidden="true">
          {stat.icon}
        </span>
        <p className="stat-card__label">{stat.label}</p>
      </div>
      <p className="stat-card__value">
        <span className="num stat-counter">{formatNumber(stat.value, stat.decimals)}</span>
        {stat.unit && <span className="stat-card__unit">{stat.unit}</span>}
      </p>
    </div>
  );
}

/**
 * Results bento grid: one hero cell (total miles, odometer digit-roll), a
 * wide arrival cell, four compact cells (days / driving / rest stops / fuel
 * stops / breaks), and - only when the engine had to insert one - a 34-hour
 * restart cell woven into the same grid rhythm rather than a bolted-on
 * banner. Replaces the original six-identical-boxes layout (rejected as
 * "too basic, AI look"): asymmetric cell sizes, hairline gradient borders,
 * tinted icon chips, and one coherent GSAP entrance timeline (stagger +
 * blur-to-sharp + icon stroke draw-in + digit roll + count-up), all under
 * gsap.matchMedia() so prefers-reduced-motion collapses straight to final
 * state.
 */
export default function TripSummary({ summary }: TripSummaryProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const stats: NumericStat[] = useMemo(
    () => [
      {
        key: "days",
        label: "Days",
        icon: <CalendarIcon />,
        value: summary.total_days,
        decimals: 0,
        unit: pluralize(summary.total_days, "day"),
      },
      {
        key: "driving",
        label: "Driving",
        icon: <ClockIcon />,
        value: summary.driving_hrs,
        decimals: 1,
        unit: "hrs",
      },
      {
        key: "rests",
        label: "Rest Stops",
        icon: <MoonIcon />,
        value: summary.rest_stops,
        decimals: 0,
        unit: pluralize(summary.rest_stops, "stop"),
      },
      {
        key: "fuel",
        label: "Fuel Stops",
        icon: <FuelIcon />,
        value: summary.fuel_stops,
        decimals: 0,
        unit: pluralize(summary.fuel_stops, "stop"),
      },
      {
        key: "breaks",
        label: "Breaks",
        icon: <BreaksIcon />,
        value: summary.breaks,
        decimals: 0,
        unit: pluralize(summary.breaks, "break"),
      },
    ],
    [summary],
  );

  const [daysStat, drivingStat, ...secondaryStats] = stats;

  const milesFormatted = useMemo(() => Math.round(summary.total_miles).toLocaleString(), [summary.total_miles]);
  const milesChars = useMemo(() => milesFormatted.split(""), [milesFormatted]);

  const arrivalInfo = useMemo(() => formatArrivalFull(summary.arrival), [summary.arrival]);

  useGSAP(
    () => {
      const scope = containerRef.current;
      const cards = gsap.utils.toArray<HTMLElement>(".stat-card", scope);
      const iconPaths = gsap.utils.toArray<SVGPathElement>(".stat-icon-draw", scope);
      const digitStrips = gsap.utils.toArray<HTMLElement>(".hero-odometer__strip", scope);
      const counters = gsap.utils.toArray<HTMLElement>(".stat-counter", scope);
      if (cards.length === 0) return;

      const targetYPercent = (_i: number, target: Element) => -(Number((target as HTMLElement).dataset.target) * 10);

      const mm = gsap.matchMedia();

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.set(cards, { y: 16, opacity: 0, filter: "blur(6px)" });
        gsap.set(digitStrips, { yPercent: 0 });
        iconPaths.forEach((path) => {
          const length = path.getTotalLength();
          gsap.set(path, { strokeDasharray: length, strokeDashoffset: length });
        });

        const tl = gsap.timeline();

        tl.to(cards, { y: 0, opacity: 1, filter: "blur(0px)", duration: 0.55, ease: "power3.out", stagger: 0.06 });

        if (iconPaths.length > 0) {
          tl.to(iconPaths, { strokeDashoffset: 0, duration: 0.45, ease: "power2.out", stagger: 0.05 }, "<0.05");
        }

        if (digitStrips.length > 0) {
          tl.to(digitStrips, { yPercent: targetYPercent, duration: 0.7, ease: "power3.out", stagger: 0.035 }, "<0.1");
        }

        counters.forEach((el, i) => {
          const stat = stats[i];
          if (!stat) return;
          const counter = { val: 0 };
          tl.to(
            counter,
            {
              val: stat.value,
              duration: 0.7,
              ease: "power2.out",
              onUpdate: () => {
                el.textContent = formatNumber(counter.val, stat.decimals);
              },
            },
            i === 0 ? "<0.1" : "<",
          );
        });
      });

      mm.add("(prefers-reduced-motion: reduce)", () => {
        gsap.set(cards, { y: 0, opacity: 1, filter: "blur(0px)" });
        gsap.set(digitStrips, { yPercent: targetYPercent });
        counters.forEach((el, i) => {
          const stat = stats[i];
          if (stat) el.textContent = formatNumber(stat.value, stat.decimals);
        });
      });

      return () => mm.revert();
    },
    { scope: containerRef, dependencies: [summary] },
  );

  return (
    <div className="trip-summary" ref={containerRef}>
      <div className="stat-bento">
        {/* Hero cell - total miles, per-digit odometer roll. */}
        <div className="stat-card stat-card--hero">
          <svg className="stat-card__flourish" viewBox="0 0 220 130" aria-hidden="true" focusable="false">
            <path d="M4 116 C 62 116, 70 38, 122 38 S 192 10, 216 10" />
          </svg>
          <div className="stat-card__header">
            <span className="stat-card__icon stat-card__icon--hero" aria-hidden="true">
              <RouteIcon />
            </span>
            <p className="stat-card__label">Total Miles</p>
          </div>
          <p className="stat-card__value stat-card__value--hero">
            <span className="hero-odometer" aria-hidden="true">
              {milesChars.map((ch, idx) =>
                /[0-9]/.test(ch) ? (
                  <span className="hero-odometer__digit" key={idx}>
                    <span className="hero-odometer__strip" data-target={ch}>
                      {DIGITS.map((d) => (
                        <span className="hero-odometer__face num" key={d}>
                          {d}
                        </span>
                      ))}
                    </span>
                  </span>
                ) : (
                  <span className="hero-odometer__sep num" key={idx}>
                    {ch}
                  </span>
                ),
              )}
              <span className="stat-card__unit stat-card__unit--hero">mi</span>
            </span>
            <span className="stat-card__sr-only">{milesFormatted} miles total</span>
          </p>
        </div>

        {/* Wide arrival cell. */}
        <div className="stat-card stat-card--arrival">
          <div className="stat-card__header">
            <span className="stat-card__icon" aria-hidden="true">
              <FlagIcon />
            </span>
            <p className="stat-card__label">Arrival</p>
          </div>
          <p className="stat-card__value stat-card__value--arrival num">{arrivalInfo.primary}</p>
          <p className="stat-card__relative">{arrivalInfo.relative}</p>
        </div>

        <CompactCard stat={daysStat} areaClassName="stat-card--days" />
        <CompactCard stat={drivingStat} areaClassName="stat-card--driving" />
      </div>

      <div className="stat-bento__secondary">
        {secondaryStats.map((stat) => (
          <CompactCard stat={stat} key={stat.key} />
        ))}

        {summary.restart_inserted && (
          <div className="stat-card stat-card--restart" role="status">
            <div className="stat-card__header">
              <span className="stat-card__icon stat-card__icon--warning" aria-hidden="true">
                <RestartIcon />
              </span>
              <p className="stat-card__label">34-Hour Restart</p>
            </div>
            <p className="stat-card__restart-body">
              Cycle hours were exhausted mid-trip, so a mandatory 34-hour off-duty restart was inserted into the
              route.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
