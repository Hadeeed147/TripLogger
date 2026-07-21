from __future__ import annotations

import requests
from django.core.cache import cache

BASE_URL = "https://nominatim.openstreetmap.org"
HEADERS = {"User-Agent": "TripLogger/1.0 (mohammadhadeed8@gmail.com)"}
TIMEOUT = 10


class GeocodeError(Exception):
    def __init__(self, query: str):
        self.query = query
        super().__init__(f"No geocoding results for {query!r}")


def geocode(query: str) -> dict:
    normalized = query.strip().lower()
    cache_key = f"geo:{normalized}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    resp = requests.get(
        f"{BASE_URL}/search",
        params={"q": normalized, "format": "json", "limit": 1},
        headers=HEADERS,
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    results = resp.json()
    if not results:
        raise GeocodeError(normalized)

    top = results[0]
    result = {
        "query": normalized,
        "display_name": top["display_name"],
        "lat": float(top["lat"]),
        "lng": float(top["lon"]),
    }
    cache.set(cache_key, result)
    return result


def reverse(lat: float, lng: float) -> str:
    try:
        rlat, rlng = round(lat, 3), round(lng, 3)
        cache_key = f"geo:rev:{rlat}:{rlng}"
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        resp = requests.get(
            f"{BASE_URL}/reverse",
            params={"lat": rlat, "lon": rlng, "format": "json", "zoom": 10},
            headers=HEADERS,
            timeout=TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
        address = data["address"]

        city = None
        for key in ("city", "town", "village", "hamlet", "county"):
            if key in address:
                city = address[key]
                break

        if "ISO3166-2-lvl4" in address:
            state = address["ISO3166-2-lvl4"].split("-")[1]
        else:
            state = address.get("state", "")

        if not city or not state:
            return ""

        result = f"{city}, {state}"
        cache.set(cache_key, result)
        return result
    except Exception:
        return ""
