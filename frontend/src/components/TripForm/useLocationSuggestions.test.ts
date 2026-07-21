import { buildSuggestionList, labelForFeature } from "./useLocationSuggestions";

test("labelForFeature prefers state, falls back to country, drops nameless features", () => {
  expect(labelForFeature({ name: "Chicago", state: "Illinois", country: "United States" })).toBe(
    "Chicago, Illinois",
  );
  expect(labelForFeature({ name: "Toronto", country: "Canada" })).toBe("Toronto, Canada");
  expect(labelForFeature({ name: "Nowhere" })).toBe("Nowhere");
  expect(labelForFeature({ state: "Illinois" })).toBeNull();
});

test("buildSuggestionList biases US results first without excluding others", () => {
  const result = buildSuggestionList([
    { properties: { name: "Springfield", state: "Ontario", country: "Canada", countrycode: "CA" } },
    { properties: { name: "Springfield", state: "Illinois", country: "United States", countrycode: "US" } },
  ]);
  expect(result).toEqual(["Springfield, Illinois", "Springfield, Ontario"]);
});

test("buildSuggestionList dedupes identical labels", () => {
  const result = buildSuggestionList([
    { properties: { name: "Austin", state: "Texas", countrycode: "US" } },
    { properties: { name: "Austin", state: "Texas", countrycode: "US" } },
  ]);
  expect(result).toEqual(["Austin, Texas"]);
});

test("buildSuggestionList drops nameless features and preserves order otherwise", () => {
  const result = buildSuggestionList([
    { properties: { state: "Texas", countrycode: "US" } },
    { properties: { name: "Dallas", state: "Texas", countrycode: "US" } },
  ]);
  expect(result).toEqual(["Dallas, Texas"]);
});
