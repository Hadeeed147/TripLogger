import { buildStepPath } from "./stepPath";

test("two-status day produces one vertical transition", () => {
  const grid = [
    { status: "off", start_min: 0, end_min: 720 },
    { status: "driving", start_min: 720, end_min: 1440 },
  ] as const;
  const d = buildStepPath([...grid], 0, 10, { off: 100, sleeper: 120, driving: 140, on_duty: 160 });
  expect(d).toBe("M 0 100 H 120 V 140 H 240");
});
