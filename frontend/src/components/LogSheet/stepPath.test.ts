import { buildStepPath } from "./stepPath";

test("two-status day produces one vertical transition", () => {
  const grid = [
    { status: "off", start_min: 0, end_min: 720 },
    { status: "driving", start_min: 720, end_min: 1440 },
  ] as const;
  const d = buildStepPath([...grid], 0, 10, { off: 100, sleeper: 120, driving: 140, on_duty: 160 });
  expect(d).toBe("M 0 100 H 120 V 140 H 240");
});

test("custom totalMinutes scales a multi-day span at a consistent per-hour rate", () => {
  const grid = [
    { status: "driving", start_min: 0, end_min: 1440 },
    { status: "off", start_min: 1440, end_min: 2880 },
  ] as const;
  const d = buildStepPath(
    [...grid],
    0,
    16,
    { off: 10, sleeper: 20, driving: 30, on_duty: 40 },
    2880,
  );
  expect(d).toBe("M 0 30 H 384 V 10 H 768");
});
