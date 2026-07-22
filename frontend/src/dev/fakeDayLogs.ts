// Dev-only fixture used by the #log preview in App.tsx to exercise LogSheet
// without a backend call. Three days, each hand-written to exercise all four
// duty rows, a 30-min break, a full 10-hour sleeper rest, and clustered
// remarks (day 1 has two remarks only 30 minutes apart to stress-test the
// stagger logic, plus a zero-width instantaneous remark right at the end of
// a bracket to exercise the single-tick fallback under crowding). Not
// imported by any production component.
import type { DayLogDto } from "../api/types";

export const fakeDayLogs: DayLogDto[] = [
  {
    date: "2026-07-21",
    total_miles: 512,
    grid: [
      { status: "off", start_min: 0, end_min: 300 },
      { status: "on_duty", start_min: 300, end_min: 330 },
      { status: "driving", start_min: 330, end_min: 660 },
      { status: "off", start_min: 660, end_min: 690 },
      { status: "driving", start_min: 690, end_min: 1020 },
      { status: "on_duty", start_min: 1020, end_min: 1050 },
      { status: "sleeper", start_min: 1050, end_min: 1440 },
    ],
    totals: { off: 330, sleeper: 390, driving: 660, on_duty: 60 },
    remarks: [
      { time_min: 300, end_min: 330, city_state: "Chicago, IL", note: "Pre-trip" },
      { time_min: 660, end_min: 690, city_state: "Bloomington, IL", note: "Break" },
      { time_min: 690, end_min: 1020, city_state: "Bloomington, IL", note: "Resume" },
      { time_min: 1020, end_min: 1050, city_state: "Indianapolis, IN", note: "Fuel" },
      { time_min: 1050, end_min: 1050, city_state: "Indianapolis, IN", note: "Sleeper start" },
    ],
  },
  {
    date: "2026-07-22",
    total_miles: 495,
    grid: [
      { status: "sleeper", start_min: 0, end_min: 600 },
      { status: "on_duty", start_min: 600, end_min: 630 },
      { status: "driving", start_min: 630, end_min: 960 },
      { status: "off", start_min: 960, end_min: 990 },
      { status: "driving", start_min: 990, end_min: 1320 },
      { status: "on_duty", start_min: 1320, end_min: 1350 },
      { status: "off", start_min: 1350, end_min: 1440 },
    ],
    totals: { off: 120, sleeper: 600, driving: 660, on_duty: 60 },
    remarks: [
      { time_min: 600, end_min: 630, city_state: "Grand Junction, CO", note: "End rest" },
      { time_min: 960, end_min: 990, city_state: "Grand Junction, CO", note: "Break" },
      { time_min: 1320, end_min: 1350, city_state: "Las Vegas, NV", note: "Fuel" },
    ],
  },
  {
    date: "2026-07-23",
    total_miles: 288,
    grid: [
      { status: "off", start_min: 0, end_min: 450 },
      { status: "on_duty", start_min: 450, end_min: 480 },
      { status: "driving", start_min: 480, end_min: 720 },
      { status: "on_duty", start_min: 720, end_min: 750 },
      { status: "off", start_min: 750, end_min: 1440 },
    ],
    totals: { off: 1140, sleeper: 0, driving: 240, on_duty: 60 },
    remarks: [
      { time_min: 450, end_min: 480, city_state: "Las Vegas, NV", note: "Pre-trip" },
      { time_min: 480, end_min: 720, city_state: "Las Vegas, NV", note: "Depart" },
      { time_min: 720, end_min: 750, city_state: "Los Angeles, CA", note: "Dropoff" },
    ],
  },
];
