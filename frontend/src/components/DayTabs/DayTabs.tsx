import { useRef, useState, type KeyboardEvent } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import "./DayTabs.css";
import LogSheet from "../LogSheet/LogSheet";
import type { DayLogDto } from "../../api/types";
import { formatDayLabel } from "../../utils/dayLabel";

gsap.registerPlugin(useGSAP);

interface DayTabsProps {
  logs: DayLogDto[];
  /** Controlled active-tab index (Polish D: lifted to App so TripTimeline's
   *  block clicks can switch the day too). When omitted, DayTabs falls back
   *  to its own internal state - existing/standalone usage keeps working. */
  activeIndex?: number;
  /** Called on every tab selection (click or keyboard) when `activeIndex`
   *  is controlled. Ignored in uncontrolled mode. */
  onChange?: (index: number) => void;
}

/**
 * One tab per day of the trip, hosting that day's LogSheet. Structural
 * baseline checked against 21st.dev's "Tabs" family (pill variant: a
 * rounded track holding rounded trigger buttons, active trigger raised off
 * the track) - restyled entirely with TripLogger tokens, no library CSS
 * pulled in. Keyboard support follows the WAI-ARIA tabs pattern: arrow
 * keys move both focus and selection, Home/End jump to the ends.
 */
export default function DayTabs({ logs, activeIndex: controlledIndex, onChange }: DayTabsProps) {
  const [internalIndex, setInternalIndex] = useState(0);
  const isControlled = controlledIndex !== undefined;
  const activeIndex = isControlled ? controlledIndex : internalIndex;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  if (logs.length === 0) return null;

  const clampedIndex = Math.min(activeIndex, logs.length - 1);
  const active = logs[clampedIndex];

  function setActiveIndex(index: number) {
    if (isControlled) {
      onChange?.(index);
    } else {
      setInternalIndex(index);
    }
  }

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
            {formatDayLabel(log.date)}
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
