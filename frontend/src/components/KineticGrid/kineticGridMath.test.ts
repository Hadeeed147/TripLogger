import {
  bellFalloff,
  clamp,
  edgeFactor,
  hexToRgbChannels,
  lerp,
  lerpChannels,
  rgba,
} from "./kineticGridMath";

test("clamp bounds a value into [min, max]", () => {
  expect(clamp(5, 0, 10)).toBe(5);
  expect(clamp(-5, 0, 10)).toBe(0);
  expect(clamp(15, 0, 10)).toBe(10);
});

test("lerp interpolates linearly and extrapolates outside [0, 1]", () => {
  expect(lerp(0, 10, 0)).toBe(0);
  expect(lerp(0, 10, 1)).toBe(10);
  expect(lerp(0, 10, 0.5)).toBe(5);
  expect(lerp(10, 20, 1.5)).toBe(25);
});

test("bellFalloff peaks at 1 for distance 0 and reaches 0 at/after the radius", () => {
  expect(bellFalloff(0, 100)).toBe(1);
  expect(bellFalloff(100, 100)).toBe(0);
  expect(bellFalloff(150, 100)).toBe(0);
  expect(bellFalloff(50, 100)).toBeCloseTo(0.5625, 6); // (1 - 0.5^2)^2
});

test("bellFalloff treats a non-positive radius as no influence", () => {
  expect(bellFalloff(0, 0)).toBe(0);
  expect(bellFalloff(10, -5)).toBe(0);
});

test("edgeFactor is 0 exactly on an edge and 1 at least `margin` px from every edge", () => {
  expect(edgeFactor(0, 50, 200, 200, 20)).toBe(0); // on the left edge
  expect(edgeFactor(200, 50, 200, 200, 20)).toBe(0); // on the right edge
  expect(edgeFactor(100, 100, 200, 200, 20)).toBe(1); // dead center, far from every edge
  expect(edgeFactor(20, 100, 200, 200, 20)).toBe(1); // exactly `margin` px from the left edge
  expect(edgeFactor(10, 100, 200, 200, 20)).toBe(0.5); // halfway into the margin band
});

test("edgeFactor treats a non-positive margin as no pinning", () => {
  expect(edgeFactor(0, 0, 200, 200, 0)).toBe(1);
});

test("hexToRgbChannels parses 6-digit and 3-digit hex, with or without '#'", () => {
  expect(hexToRgbChannels("#2f6fed")).toEqual([47, 111, 237]);
  expect(hexToRgbChannels("2f6fed")).toEqual([47, 111, 237]);
  expect(hexToRgbChannels("#fff")).toEqual([255, 255, 255]);
  expect(hexToRgbChannels("#000")).toEqual([0, 0, 0]);
});

test("hexToRgbChannels falls back to mid-grey on invalid input", () => {
  expect(hexToRgbChannels("")).toEqual([128, 128, 128]);
  expect(hexToRgbChannels("not-a-color")).toEqual([128, 128, 128]);
  expect(hexToRgbChannels("#zzzzzz")).toEqual([128, 128, 128]);
});

test("lerpChannels interpolates each channel independently and clamps t", () => {
  expect(lerpChannels([0, 0, 0], [100, 200, 255], 0.5)).toEqual([50, 100, 127.5]);
  expect(lerpChannels([0, 0, 0], [100, 200, 255], -1)).toEqual([0, 0, 0]);
  expect(lerpChannels([0, 0, 0], [100, 200, 255], 2)).toEqual([100, 200, 255]);
});

test("rgba formats rounded channels and a clamped alpha as a canvas-ready string", () => {
  expect(rgba([47, 111, 237], 0.5)).toBe("rgba(47, 111, 237, 0.5)");
  expect(rgba([47.4, 111.6, 237], 1.5)).toBe("rgba(47, 112, 237, 1)");
  expect(rgba([0, 0, 0], -1)).toBe("rgba(0, 0, 0, 0)");
});
