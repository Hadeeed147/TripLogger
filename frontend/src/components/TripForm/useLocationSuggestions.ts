import { useEffect, useState } from "react";

/**
 * Photon (komoot) geocoding autocomplete - keyless, public API used purely as
 * a client-side enhancement. The backend still geocodes the final submitted
 * strings via Nominatim (see api/client.ts + the /api/trips endpoint); this
 * hook never touches that path, it only proposes labels to fill the input.
 */
const PHOTON_ENDPOINT = "https://photon.komoot.io/api/";
const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 3;
const RESULT_LIMIT = 5;

export interface PhotonProperties {
  name?: string;
  state?: string;
  country?: string;
  countrycode?: string;
}

export interface PhotonFeature {
  properties: PhotonProperties;
}

interface PhotonResponse {
  features?: PhotonFeature[];
}

/**
 * Builds the "City, ST" (falling back to "City, Country" when Photon has no
 * state, e.g. most non-US results) display label for one feature. Returns
 * null for features with no usable name - those are dropped upstream.
 */
export function labelForFeature(properties: PhotonProperties): string | null {
  const name = properties.name?.trim();
  if (!name) return null;
  const region = properties.state?.trim() || properties.country?.trim();
  return region ? `${name}, ${region}` : name;
}

/**
 * Ranks and dedupes raw Photon features into a flat list of display labels.
 * US results are stable-sorted first (a bias, not a filter - non-US results
 * still appear after them), then identical labels collapse to a single
 * entry so e.g. two "Springfield, IL" hits from different Photon records
 * don't show up as two dropdown rows.
 */
export function buildSuggestionList(features: PhotonFeature[]): string[] {
  const labeled = features
    .map((feature) => ({
      label: labelForFeature(feature.properties),
      isUS: feature.properties.countrycode === "US",
    }))
    .filter((entry): entry is { label: string; isUS: boolean } => entry.label !== null);

  const us = labeled.filter((entry) => entry.isUS);
  const rest = labeled.filter((entry) => !entry.isUS);

  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of [...us, ...rest]) {
    if (seen.has(entry.label)) continue;
    seen.add(entry.label);
    result.push(entry.label);
  }
  return result;
}

/**
 * Debounced (300ms), abortable (AbortController, cancels the in-flight
 * request on every new keystroke), min-3-char Photon lookup. Autocomplete is
 * an enhancement only: any network failure, non-OK response, or abort is
 * swallowed silently and just leaves `suggestions` empty - the form keeps
 * working as a plain text input exactly as before if Photon is unreachable.
 */
export function useLocationSuggestions(query: string): string[] {
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        q: trimmed,
        limit: String(RESULT_LIMIT),
        lang: "en",
      });
      const url = `${PHOTON_ENDPOINT}?${params.toString()}&layer=city&layer=district`;

      fetch(url, { signal: controller.signal })
        .then((res) => (res.ok ? (res.json() as Promise<PhotonResponse>) : Promise.reject(res)))
        .then((data) => setSuggestions(buildSuggestionList(data.features ?? [])))
        .catch(() => {
          // Enhancement-only: silently do nothing (network down, aborted,
          // malformed response, whatever) - never surface this to the user.
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return suggestions;
}
