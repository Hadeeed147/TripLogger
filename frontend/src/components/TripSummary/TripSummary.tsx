import { useMemo, useRef, type ReactNode } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import "./TripSummary.css";
import type { SummaryDto } from "../../api/types";
import { formatArrival } from "../RouteMap/markers";

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

/* -------------------------------------------------------------------------
   Icons - hand-rolled inline SVG, same 24x24 / 1.75px round-cap convention
   as TripForm's icon set. `MoonIcon` and `FuelIcon` are filled shapes
   lifted straight from RouteMap/markers.ts so the "rest" and "fuel" stat
   cards read as the same glyph the map uses for those stop types.
------------------------------------------------------------------------- */

function RouteIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M6 8.5v3a4 4 0 0 0 4 4h4" strokeDasharray="1 3.2" />
      <path d="M18 15.5v-7a4 4 0 0 0-4-4h-1" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="5" width="17" height="16" rx="2" />
      <path d="M3.5 9.5h17" />
      <path d="M8 3v3.5" />
      <path d="M16 3v3.5" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3.2 2" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 14.7A8.5 8.5 0 1 1 9.3 4a6.6 6.6 0 0 0 10.7 10.7z" />
    </svg>
  );
}

function FuelIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="9" height="18" rx="1.5" />
      <line x1="4" y1="9" x2="13" y2="9" />
      <path d="M13 8h3l3 3v6.5a1.5 1.5 0 0 1-3 0V13" />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 21V4" />
      <path d="M6 4h11l-2.5 3.5L17 11H6" />
    </svg>
  );
}

function RestartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 12a8.5 8.5 0 1 0 2.7-6.2" />
      <path d="M3 4v5h5" />
    </svg>
  );
}

function pluralize(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
}

/**
 * Stat-card row + count-up + the amber restart callout. Structural baseline
 * checked against 21st.dev ("Statistics Card" family: icon + label above a
 * large tabular value) - restyled entirely with TripLogger tokens below, no
 * library CSS carried over.
 *
 * Arrival is deliberately excluded from the count-up treatment: it's a
 * formatted timestamp (via the shared `formatArrival` helper from RouteMap),
 * not a quantity, so animating digits through it would just look like
 * clock-flicker rather than a meaningful count. Every other card is a real
 * quantity and gets the GSAP tween.
 */
export default function TripSummary({ summary }: TripSummaryProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const numberRefs = useRef<Array<HTMLSpanElement | null>>([]);

  const stats: NumericStat[] = useMemo(
    () => [
      {
        key: "miles",
        label: "Miles",
        icon: <RouteIcon />,
        value: summary.total_miles,
        decimals: 0,
        unit: "mi",
      },
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
    ],
    [summary],
  );

  function formatStat(stat: NumericStat): string {
    return stat.decimals === 0
      ? Math.round(stat.value).toLocaleString()
      : stat.value.toFixed(stat.decimals);
  }

  useGSAP(
    () => {
      const cards = gsap.utils.toArray<HTMLElement>(".stat-card", containerRef.current);
      if (cards.length === 0) return;

      const mm = gsap.matchMedia();

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.set(cards, { y: 16, opacity: 0 });
        const tl = gsap.timeline();
        tl.to(cards, { y: 0, opacity: 1, duration: 0.5, ease: "power2.out", stagger: 0.06 });

        stats.forEach((stat, i) => {
          const el = numberRefs.current[i];
          if (!el) return;
          const counter = { val: 0 };
          tl.to(
            counter,
            {
              val: stat.value,
              duration: 0.8,
              ease: "power2.out",
              onUpdate: () => {
                el.textContent =
                  stat.decimals === 0
                    ? Math.round(counter.val).toLocaleString()
                    : counter.val.toFixed(stat.decimals);
              },
            },
            i === 0 ? "-=0.25" : "<",
          );
        });
      });

      mm.add("(prefers-reduced-motion: reduce)", () => {
        gsap.set(cards, { y: 0, opacity: 1 });
        stats.forEach((stat, i) => {
          const el = numberRefs.current[i];
          if (el) el.textContent = formatStat(stat);
        });
      });

      return () => mm.revert();
    },
    { scope: containerRef, dependencies: [summary] },
  );

  return (
    <div className="trip-summary" ref={containerRef}>
      <div className="trip-summary__grid">
        {stats.map((stat, i) => (
          <div className="stat-card" key={stat.key}>
            <div className="stat-card__header">
              <span className="stat-card__icon" aria-hidden="true">
                {stat.icon}
              </span>
              <p className="stat-card__label">{stat.label}</p>
            </div>
            <p className="stat-card__value">
              <span
                className="num"
                ref={(el) => {
                  numberRefs.current[i] = el;
                }}
              >
                {formatStat(stat)}
              </span>
              {stat.unit && <span className="stat-card__unit">{stat.unit}</span>}
            </p>
          </div>
        ))}

        <div className="stat-card stat-card--arrival">
          <div className="stat-card__header">
            <span className="stat-card__icon" aria-hidden="true">
              <FlagIcon />
            </span>
            <p className="stat-card__label">Arrival</p>
          </div>
          <p className="stat-card__value">
            <span className="num">{formatArrival(summary.arrival)}</span>
          </p>
        </div>
      </div>

      {summary.restart_inserted && (
        <div className="restart-callout" role="status">
          <span className="restart-callout__icon" aria-hidden="true">
            <RestartIcon />
          </span>
          <div className="restart-callout__body">
            <p className="restart-callout__title">34-hour restart required</p>
            <p className="restart-callout__sub">
              Cycle hours were exhausted mid-trip, so a mandatory 34-hour off-duty restart was inserted into the
              route.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
