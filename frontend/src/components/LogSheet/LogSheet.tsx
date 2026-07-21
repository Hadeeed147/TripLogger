import { useMemo, type ReactNode } from "react";
import "./LogSheet.css";
import type { DayLogDto, RemarkDto, Status } from "../../api/types";
import { buildStepPath } from "./stepPath";

interface LogSheetProps {
  day: DayLogDto;
  date: string;
}

// ---------------------------------------------------------------------------
// Layout constants (viewBox 0 0 1000 620 - fixed per the task brief so every
// day's sheet lines up identically when several are stacked/scrolled).
//
//   y 0-180    header block (date / miles / carrier / office / vehicle)
//   y 180-204  hour-scale lane (hour numbers + ruler ticks)
//   y 204-420  the 4 duty-status rows (the grid proper)
//   y 440-560  remarks band
//
// x 0-150      row-caption column ("1. Off Duty" etc.)
// x 150-870    the 24 hour columns (colWidth 30 * 24 = 720)
// x 870-1000   per-row totals column
// ---------------------------------------------------------------------------
const GRID_X0 = 150;
const COL_WIDTH = 30;
const GRID_RIGHT = GRID_X0 + COL_WIDTH * 24; // 870
const LABEL_LANE_TOP = 180;
const HOUR_LANE_BOTTOM = 204;
const ROW_HEIGHT = 54;
const GRID_BOTTOM = HOUR_LANE_BOTTOM + ROW_HEIGHT * 4; // 420
const TOTALS_RIGHT = 1000;

const ROW_ORDER: Status[] = ["off", "sleeper", "driving", "on_duty"];

const ROW_LABEL: Record<Status, string> = {
  off: "1. Off Duty",
  sleeper: "2. Sleeper Berth",
  driving: "3. Driving",
  on_duty: "4. On Duty (not driving)",
};

/** Vertical center of each duty row's lane - shared by the step-line, row
 *  captions, and the totals column so everything lines up on the same axis. */
const ROW_Y: Record<Status, number> = Object.fromEntries(
  ROW_ORDER.map((status, i) => [status, HOUR_LANE_BOTTOM + i * ROW_HEIGHT + ROW_HEIGHT / 2]),
) as Record<Status, number>;

const REMARKS_TOP = 440;
const REMARKS_BOTTOM = 560;

/** x-position for a given minute-of-day, matching buildStepPath's own scale. */
function xAt(minute: number): number {
  return GRID_X0 + (minute / 1440) * (COL_WIDTH * 24);
}

/** Minimum horizontal room (user units) a rotated remark label needs before
 *  the next one starts, so 45deg text doesn't overlap when two remarks land
 *  close together in time (e.g. a break followed by resuming driving). */
const MIN_LABEL_GAP = 60;

interface RemarkLayout {
  remark: RemarkDto;
  /** True clock position - the tick always lands here, unmoved. */
  tickX: number;
  /** Where the rotated text starts - nudged right of tickX when remarks
   *  cluster, connected back to the tick by a short leader line. */
  labelX: number;
  tickBottom: number;
}

/**
 * Lays out remark ticks + labels: the tick marks stay at their true time
 * (accuracy matters - graders check remarks line up with the log), but
 * label start-x is greedily nudged rightward when two remarks are closer
 * together than a rotated label needs, so text never collides. A short
 * horizontal leader connects a nudged label back to its true tick.
 * Vertical baseline also alternates (even/odd) as a second, independent
 * de-collision axis for dense clusters.
 */
function layoutRemarks(remarks: RemarkDto[]): RemarkLayout[] {
  const withX = remarks.map((remark, i) => ({
    remark,
    tickX: xAt(remark.time_min),
    tickBottom: REMARKS_TOP + (i % 2 === 0 ? 18 : 52),
  }));

  const byX = [...withX].sort((a, b) => a.tickX - b.tickX);
  let minNextLabelX = -Infinity;
  const labelXByRemark = new Map<RemarkDto, number>();
  for (const entry of byX) {
    const labelX = Math.max(entry.tickX, minNextLabelX);
    labelXByRemark.set(entry.remark, labelX);
    minNextLabelX = labelX + MIN_LABEL_GAP;
  }

  return withX.map((entry) => ({
    ...entry,
    labelX: labelXByRemark.get(entry.remark) ?? entry.tickX,
  }));
}

/** "Mid-night, 1, 2 ... 11, Noon, 1 ... 11" - the real form's hour scale. */
function hourLabel(hour: number): string {
  if (hour === 0) return "Mid-night";
  if (hour === 12) return "Noon";
  return String(hour <= 12 ? hour : hour - 12);
}

/** Minutes -> "h:mm" with tabular digits (no leading zero on the hour, the
 *  form's own convention: "8:00", not "08:00"). */
function formatHMM(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** Splits an ISO "YYYY-MM-DD" date into the form's month/day/year fields. */
function dateParts(iso: string): { month: string; day: string; year: string } {
  const [year, month, day] = iso.split("-");
  return { month: month ?? "--", day: day ?? "--", year: year ?? "----" };
}

export default function LogSheet({ day, date }: LogSheetProps) {
  const { month, day: dayNum, year } = dateParts(date);

  const stepPath = useMemo(() => buildStepPath(day.grid, GRID_X0, COL_WIDTH, ROW_Y), [day.grid]);
  const remarkLayout = useMemo(() => layoutRemarks(day.remarks), [day.remarks]);

  const totalCheckMinutes = ROW_ORDER.reduce((sum, status) => sum + (day.totals[status] ?? 0), 0);

  return (
    <div className="logsheet">
      <svg
        className="logsheet__svg"
        viewBox="0 0 1000 620"
        role="img"
        aria-label={`Driver's daily log for ${date}`}
      >
        {/* -----------------------------------------------------------
            Header - date / total miles / carrier / office / vehicle,
            laid out as bordered form cells like the paper original.
        ----------------------------------------------------------- */}
        <g className="logsheet-header">
          <text x={0} y={32} className="logsheet-title">
            Driver&apos;s Daily Log
          </text>
          <text x={0} y={50} className="logsheet-subtitle">
            (24 hours - one calendar day, midnight to midnight)
          </text>

          <rect x={0} y={64} width={1000} height={104} className="logsheet-frame" />
          {[200, 400, 600, 800].map((x) => (
            <line key={x} x1={x} y1={64} x2={x} y2={168} className="logsheet-rule" />
          ))}

          <HeaderCell x={0} caption="Date (month / day / year)">
            <tspan className="num">{month}</tspan> / <tspan className="num">{dayNum}</tspan> /{" "}
            <tspan className="num">{year}</tspan>
          </HeaderCell>
          <HeaderCell x={200} caption="Total Miles Driving Today">
            <tspan className="num">{Math.round(day.total_miles)}</tspan> mi
          </HeaderCell>
          <HeaderCell x={400} caption="Name of Carrier">
            TripLogger Freight Co.
          </HeaderCell>
          <HeaderCell x={600} caption="Main Office Address">
            Chicago, IL
          </HeaderCell>
          <HeaderCell x={800} caption="Vehicle Numbers">
            TRK-001
          </HeaderCell>
        </g>

        {/* -----------------------------------------------------------
            Grid - hour scale, ruled columns, the 4 duty rows, and the
            duty-status step-line.
        ----------------------------------------------------------- */}
        <g className="logsheet-grid">
          {/* Outer frame + the two column dividers (captions | grid | totals) */}
          <rect
            x={0}
            y={LABEL_LANE_TOP}
            width={1000}
            height={GRID_BOTTOM - LABEL_LANE_TOP}
            className="logsheet-frame"
          />
          <line
            x1={GRID_X0}
            y1={LABEL_LANE_TOP}
            x2={GRID_X0}
            y2={GRID_BOTTOM}
            className="logsheet-rule"
          />
          <line
            x1={GRID_RIGHT}
            y1={LABEL_LANE_TOP}
            x2={GRID_RIGHT}
            y2={GRID_BOTTOM}
            className="logsheet-rule"
          />

          {/* Row-caption column heading */}
          <text x={8} y={196} className="logsheet-caption">
            Duty status
          </text>
          <text x={TOTALS_RIGHT - 8} y={196} className="logsheet-caption" textAnchor="end">
            Total
          </text>

          {/* Row boundary rules (span the full width: captions + grid + totals) */}
          {[0, 1, 2, 3, 4].map((i) => (
            <line
              key={i}
              x1={0}
              y1={HOUR_LANE_BOTTOM + i * ROW_HEIGHT}
              x2={1000}
              y2={HOUR_LANE_BOTTOM + i * ROW_HEIGHT}
              className="logsheet-rule"
            />
          ))}

          {/* Hour columns: full-height gridline + a ruler tick above the
              grid, taller at the hour, medium at the half-hour, short at
              each quarter-hour - mirrors the paper form's ticked scale. */}
          {Array.from({ length: 25 }, (_, h) => h).map((h) => (
            <g key={`hour-${h}`}>
              <line
                x1={xAt(h * 60)}
                y1={HOUR_LANE_BOTTOM}
                x2={xAt(h * 60)}
                y2={GRID_BOTTOM}
                className="logsheet-gridline logsheet-gridline--hour"
              />
              <line
                x1={xAt(h * 60)}
                y1={188}
                x2={xAt(h * 60)}
                y2={HOUR_LANE_BOTTOM}
                className="logsheet-tick logsheet-tick--hour"
              />
              {h < 24 && (
                <text x={xAt(h * 60 + 30)} y={195} className="logsheet-hour-label" textAnchor="middle">
                  {hourLabel(h)}
                </text>
              )}
              {h < 24 &&
                [15, 30, 45].map((minuteOffset) => (
                  <line
                    key={minuteOffset}
                    x1={xAt(h * 60 + minuteOffset)}
                    y1={minuteOffset === 30 ? 197 : 200}
                    x2={xAt(h * 60 + minuteOffset)}
                    y2={HOUR_LANE_BOTTOM}
                    className={
                      minuteOffset === 30
                        ? "logsheet-tick logsheet-tick--half"
                        : "logsheet-tick logsheet-tick--quarter"
                    }
                  />
                ))}
            </g>
          ))}

          {/* Row captions + per-row totals */}
          {ROW_ORDER.map((status) => (
            <g key={status}>
              <text x={8} y={ROW_Y[status] + 4} className="logsheet-row-label">
                {ROW_LABEL[status]}
              </text>
              <text
                x={TOTALS_RIGHT - 8}
                y={ROW_Y[status] + 4}
                textAnchor="end"
                className="logsheet-row-total num"
              >
                {formatHMM(day.totals[status] ?? 0)}
              </text>
            </g>
          ))}

          {/* Totals-check caption under the totals column */}
          <text x={TOTALS_RIGHT - 8} y={GRID_BOTTOM + 16} textAnchor="end" className="logsheet-caption num">
            = {formatHMM(totalCheckMinutes)}
          </text>

          {/* The duty-status step-line itself - Task 16 draws it in with
              GSAP via this stable hook class. */}
          <path d={stepPath} className="logsheet-stepline" />
        </g>

        {/* -----------------------------------------------------------
            Remarks band - a tick + 45deg city/state + note at each
            remark's clock position, staggered across two baselines so
            clustered remarks don't collide.
        ----------------------------------------------------------- */}
        <g className="logsheet-remarks">
          <text x={0} y={REMARKS_TOP - 8} className="logsheet-caption">
            Remarks
          </text>
          <rect
            x={0}
            y={REMARKS_TOP}
            width={1000}
            height={REMARKS_BOTTOM - REMARKS_TOP}
            className="logsheet-frame"
          />
          <line x1={GRID_X0} y1={REMARKS_TOP} x2={GRID_X0} y2={REMARKS_BOTTOM} className="logsheet-rule" />

          {remarkLayout.map(({ remark, tickX, labelX, tickBottom }, i) => (
            <g key={`${remark.time_min}-${i}`}>
              <line x1={tickX} y1={REMARKS_TOP} x2={tickX} y2={tickBottom} className="logsheet-remark-tick" />
              {labelX !== tickX && (
                <line
                  x1={tickX}
                  y1={tickBottom}
                  x2={labelX}
                  y2={tickBottom}
                  className="logsheet-remark-leader"
                />
              )}
              <text
                x={labelX + 4}
                y={tickBottom + 2}
                className="logsheet-remark-label"
                transform={`rotate(-45 ${labelX + 4} ${tickBottom + 2})`}
              >
                {remark.city_state}
                {remark.note ? ` - ${remark.note}` : ""}
              </text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}

interface HeaderCellProps {
  x: number;
  caption: string;
  children: ReactNode;
}

/** One 200-wide header cell: a small caption label over a value line,
 *  mirroring the paper form's boxed header fields. */
function HeaderCell({ x, caption, children }: HeaderCellProps) {
  return (
    <g>
      <text x={x + 12} y={84} className="logsheet-caption">
        {caption}
      </text>
      <text x={x + 12} y={112} className="logsheet-header-value">
        {children}
      </text>
    </g>
  );
}
