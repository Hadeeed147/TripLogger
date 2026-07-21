// Shared "YYYY-MM-DD" -> "Mon 7/21" formatting, used by both DayTabs (tab
// labels) and TripTimeline (day-boundary labels) so the two stay visually
// identical. Lives in its own module rather than being exported from
// DayTabs.tsx so both are free to stay function-component-only files (Fast
// Refresh only works when a file exports components alone).
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Formats a "YYYY-MM-DD" log date as "Mon 7/21" (weekday + numeric
 * month/day, no leading zeros, no year). Built from the date's own y/m/d
 * components rather than `new Date(iso)` because that parses a date-only
 * ISO string as UTC midnight, which can roll the weekday back a day in
 * negative-offset timezones. `iso` is a calendar date, not an instant, so
 * it's constructed as local y/m/d instead (the same approach LogSheet's own
 * `dateParts` helper takes).
 */
export function formatDayLabel(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
  return `${WEEKDAYS[date.getDay()]} ${month}/${day}`;
}
