import { useRef, useState, type KeyboardEvent } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import "./DayTabs.css";
import LogSheet from "../LogSheet/LogSheet";
import type { DayLogDto } from "../../api/types";

gsap.registerPlugin(useGSAP);

interface DayTabsProps {
  logs: DayLogDto[];
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Formats a "YYYY-MM-DD" log date as "Mon 7/21" (weekday + numeric
 * month/day, no leading zeros, no year - matches the task brief's example).
 * Built from the date's own y/m/d components rather than `new Date(iso)`
 * because that parses a date-only ISO string as UTC midnight, which can
 * roll the weekday back a day in negative-offset timezones. `day.date` is a
 * calendar date, not an instant, so it's constructed as local y/m/d instead
 * (the same approach LogSheet's own `dateParts` helper takes).
 */
function formatTabLabel(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
  return `${WEEKDAYS[date.getDay()]} ${month}/${day}`;
}

/**
 * One tab per day of the trip, hosting that day's LogSheet. Structural
 * baseline checked against 21st.dev's "Tabs" family (pill variant: a
 * rounded track holding rounded trigger buttons, active trigger raised off
 * the track) - restyled entirely with TripLogger tokens, no library CSS
 * pulled in. Keyboard support follows the WAI-ARIA tabs pattern: arrow
 * keys move both focus and selection, Home/End jump to the ends.
 */
export default function DayTabs({ logs }: DayTabsProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  if (logs.length === 0) return null;

  const clampedIndex = Math.min(activeIndex, logs.length - 1);
  const active = logs[clampedIndex];

  function selectTab(index: number) {
    const clamped = (index + logs.length) % logs.length;
    setActiveIndex(clamped);
    tabRefs.current[clamped]?.focus();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        selectTab(index + 1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        selectTab(index - 1);
        break;
      case "Home":
        e.preventDefault();
        selectTab(0);
        break;
      case "End":
        e.preventDefault();
        selectTab(logs.length - 1);
        break;
      default:
        break;
    }
  }

  return (
    <div className="day-tabs">
      <div className="day-tabs__list" role="tablist" aria-label="Daily logs">
        {logs.map((log, i) => (
          <button
            key={log.date}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`day-tab-${log.date}`}
            aria-selected={i === clampedIndex}
            aria-controls={`day-panel-${log.date}`}
            tabIndex={i === clampedIndex ? 0 : -1}
            className={`day-tabs__tab${i === clampedIndex ? " day-tabs__tab--active" : ""}`}
            onClick={() => setActiveIndex(i)}
            onKeyDown={(e) => handleKeyDown(e, i)}
          >
            {formatTabLabel(log.date)}
          </button>
        ))}
      </div>

      <div
        className="day-tabs__panel"
        role="tabpanel"
        id={`day-panel-${active.date}`}
        aria-labelledby={`day-tab-${active.date}`}
        tabIndex={0}
      >
        {/* `key` forces a fresh LogSheet + AnimatedLogSheet mount on every
            switch, which is what makes the step-line draw-in replay both
            on first mount and on every subsequent tab change. */}
        <AnimatedLogSheet key={active.date} day={active} date={active.date} />
      </div>
    </div>
  );
}

interface AnimatedLogSheetProps {
  day: DayLogDto;
  date: string;
}

/**
 * Wraps LogSheet to draw its `.logsheet-stepline` in via a
 * stroke-dasharray/dashoffset tween on mount. Because DayTabs remounts this
 * component (via `key`) on every tab switch, a plain mount-time `useGSAP`
 * with an empty scope dependency array is enough to satisfy "replay on
 * mount AND on tab switch" - no manual replay wiring needed.
 */
function AnimatedLogSheet({ day, date }: AnimatedLogSheetProps) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const path = ref.current?.querySelector<SVGPathElement>(".logsheet-stepline");
      if (!path) return;

      const mm = gsap.matchMedia();

      // Reduced motion: register no query at all, so nothing runs and the
      // stepline renders in its normal, fully-visible CSS state immediately.
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const length = path.getTotalLength();
        gsap.set(path, { strokeDasharray: length, strokeDashoffset: length });
        gsap.to(path, { strokeDashoffset: 0, duration: 0.9, ease: "power2.out" });
      });

      return () => mm.revert();
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className="day-tabs__logsheet-wrap">
      <LogSheet day={day} date={date} />
    </div>
  );
}
