// Types transcribed exactly from the API contract in
// docs/superpowers/specs/2026-07-21-triplogger-design.md ("API contract" section).
// Field names and casing (snake_case) are preserved verbatim to match the JSON wire format.

export type Status = "off" | "sleeper" | "driving" | "on_duty";

export interface TripRequest {
  current_location: string;
  pickup_location: string;
  dropoff_location: string;
  current_cycle_used: number;
  /** ISO 8601 datetime string. Optional — defaults server-side to "now" rounded up to next 15 min. */
  departure_time?: string;
}

export interface LocationDto {
  query: string;
  display_name: string;
  lat: number;
  lng: number;
}

export interface RouteDto {
  /** [lat, lng] pairs describing the route polyline. */
  geometry: [number, number][];
  total_miles: number;
  total_duration_hrs: number;
}

export interface SummaryDto {
  total_days: number;
  total_miles: number;
  driving_hrs: number;
  on_duty_hrs: number;
  rest_stops: number;
  fuel_stops: number;
  breaks: number;
  restart_inserted: boolean;
  /** ISO 8601 datetime string. */
  arrival: string;
}

export type StopType = "pickup" | "dropoff" | "fuel" | "break" | "rest" | "restart";

export interface Stop {
  type: StopType;
  lat: number;
  lng: number;
  /** ISO 8601 datetime string. */
  arrival: string;
  duration_min: number;
  label: string;
  miles_from_origin: number;
}

export interface SegmentDto {
  status: Status;
  /** ISO 8601 datetime string. */
  start: string;
  /** ISO 8601 datetime string. */
  end: string;
  miles: number;
  start_miles_from_origin: number;
  location_hint: string;
}

export interface GridEntryDto {
  status: Status;
  /** Minutes from start of day (0-1440), 15-minute snapped. */
  start_min: number;
  end_min: number;
}

export interface RemarkDto {
  /** Minutes from start of day (0-1440). */
  time_min: number;
  city_state: string;
  note: string;
}

export interface DayLogDto {
  /** ISO date string, e.g. "2026-07-21". */
  date: string;
  grid: GridEntryDto[];
  /** Minutes per status; sums to 1440. */
  totals: Record<Status, number>;
  total_miles: number;
  remarks: RemarkDto[];
}

export interface TripPlan {
  locations: {
    current: LocationDto;
    pickup: LocationDto;
    dropoff: LocationDto;
  };
  route: RouteDto;
  summary: SummaryDto;
  stops: Stop[];
  segments: SegmentDto[];
  logs: DayLogDto[];
}
