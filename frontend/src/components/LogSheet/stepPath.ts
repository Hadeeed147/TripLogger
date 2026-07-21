import type { GridEntryDto, Status } from "../../api/types";

/**
 * Builds a single SVG path string (M/H/V commands) tracing the duty-status
 * step-line across all four grid rows, the way the paper ELD form's pen
 * line jumps between rows at each status change and runs flat within a row.
 *
 * `grid` must be contiguous and cover the full day (0..1440 minutes) - that
 * invariant is guaranteed by the backend log-sheet builder (Task 9).
 *
 * x scale: minute `m` -> `x0 + (m / 1440) * (colWidth * 24)`.
 * y per entry: `rowY[entry.status]`.
 *
 * The path starts with an absolute moveto at the first entry's row, then
 * for each entry emits a horizontal run to its end-x; whenever the next
 * entry's row differs, a vertical segment connects the two rows at the
 * shared x before the next horizontal run begins.
 */
export function buildStepPath(
  grid: GridEntryDto[],
  x0: number,
  colWidth: number,
  rowY: Record<Status, number>,
): string {
  const dayWidth = colWidth * 24;
  const xAt = (min: number) => x0 + (min / 1440) * dayWidth;

  if (grid.length === 0) return "";

  const commands: string[] = [];
  const first = grid[0];
  commands.push(`M ${xAt(first.start_min)} ${rowY[first.status]}`);

  for (let i = 0; i < grid.length; i++) {
    const entry = grid[i];
    commands.push(`H ${xAt(entry.end_min)}`);

    const next = grid[i + 1];
    if (next) {
      commands.push(`V ${rowY[next.status]}`);
    }
  }

  return commands.join(" ");
}
