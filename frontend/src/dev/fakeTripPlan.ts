// Dev-only fixtures used by the #map/#dashboard previews in App.tsx to
// exercise RouteMap/the results dashboard without hitting the backend. Not
// imported by any production component.
import type { TripPlan } from "../api/types";
import { fakeDayLogs } from "./fakeDayLogs";

const CHICAGO: [number, number] = [41.8781, -87.6298];
const DENVER: [number, number] = [39.7392, -104.9903];
const LOS_ANGELES: [number, number] = [34.0522, -118.2437];

function lerpPoints(a: [number, number], b: [number, number], steps: number): [number, number][] {
  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return points;
}

const geometry: [number, number][] = [
  ...lerpPoints(CHICAGO, DENVER, 24),
  ...lerpPoints(DENVER, LOS_ANGELES, 24).slice(1),
];

export const fakeTripPlan: TripPlan = {
  locations: {
    current: { query: "Chicago, IL", display_name: "Chicago, Illinois, USA", lat: CHICAGO[0], lng: CHICAGO[1] },
    pickup: { query: "Denver, CO", display_name: "Denver, Colorado, USA", lat: DENVER[0], lng: DENVER[1] },
    dropoff: {
      query: "Los Angeles, CA",
      display_name: "Los Angeles, California, USA",
      lat: LOS_ANGELES[0],
      lng: LOS_ANGELES[1],
    },
  },
  route: {
    geometry,
    total_miles: 2015,
    total_duration_hrs: 33.4,
  },
  summary: {
    total_days: 3,
    total_miles: 2015,
    driving_hrs: 33.4,
    on_duty_hrs: 36.4,
    rest_stops: 1,
    fuel_stops: 1,
    breaks: 1,
    restart_inserted: true,
    arrival: "2026-07-24T15:30:00",
  },
  stops: [
    {
      type: "break",
      lat: 41.4,
      lng: -93.6,
      arrival: "2026-07-21T13:15:00",
      duration_min: 30,
      label: "30-min break - near Des Moines, IA",
      miles_from_origin: 240,
    },
    {
      type: "fuel",
      lat: 41.0,
      lng: -98.5,
      arrival: "2026-07-21T17:40:00",
      duration_min: 30,
      label: "Fuel stop - near Grand Island, NE",
      miles_from_origin: 550,
    },
    {
      type: "pickup",
      lat: DENVER[0],
      lng: DENVER[1],
      arrival: "2026-07-21T22:05:00",
      duration_min: 60,
      label: "Pickup - Denver, CO",
      miles_from_origin: 1005,
    },
    {
      type: "rest",
      lat: 40.0,
      lng: -108.5,
      arrival: "2026-07-22T02:00:00",
      duration_min: 600,
      label: "10-hour rest - near Grand Junction, CO",
      miles_from_origin: 1355,
    },
    {
      type: "restart",
      lat: 36.2,
      lng: -114.9,
      arrival: "2026-07-22T20:30:00",
      duration_min: 2040,
      label: "34-hour restart - near Las Vegas, NV",
      miles_from_origin: 1750,
    },
    {
      type: "dropoff",
      lat: LOS_ANGELES[0],
      lng: LOS_ANGELES[1],
      arrival: "2026-07-24T14:30:00",
      duration_min: 60,
      label: "Dropoff - Los Angeles, CA",
      miles_from_origin: 2015,
    },
  ],
  segments: [],
  logs: fakeDayLogs,
};

/**
 * A second fixture for the #dashboard-short dev harness - a same-day, no-
 * restart trip, so DayTabs' single-tab case and TripSummary without the
 * amber callout can both be screenshot-checked without a backend.
 */
export const fakeTripPlanShort: TripPlan = {
  locations: {
    current: { query: "Chicago, IL", display_name: "Chicago, Illinois, USA", lat: CHICAGO[0], lng: CHICAGO[1] },
    pickup: { query: "Bloomington, IL", display_name: "Bloomington, Illinois, USA", lat: 40.4842, lng: -88.9937 },
    dropoff: {
      query: "Indianapolis, IN",
      display_name: "Indianapolis, Indiana, USA",
      lat: 39.7684,
      lng: -86.1581,
    },
  },
  route: {
    geometry: lerpPoints(CHICAGO, [39.7684, -86.1581], 12),
    total_miles: 210,
    total_duration_hrs: 3.8,
  },
  summary: {
    total_days: 1,
    total_miles: 210,
    driving_hrs: 3.8,
    on_duty_hrs: 4.8,
    rest_stops: 0,
    fuel_stops: 0,
    breaks: 0,
    restart_inserted: false,
    arrival: "2026-07-21T15:45:00",
  },
  stops: [
    {
      type: "pickup",
      lat: 40.4842,
      lng: -88.9937,
      arrival: "2026-07-21T13:00:00",
      duration_min: 60,
      label: "Pickup - Bloomington, IL",
      miles_from_origin: 130,
    },
    {
      type: "dropoff",
      lat: 39.7684,
      lng: -86.1581,
      arrival: "2026-07-21T15:45:00",
      duration_min: 60,
      label: "Dropoff - Indianapolis, IN",
      miles_from_origin: 210,
    },
  ],
  segments: [],
  logs: [fakeDayLogs[0]],
};
