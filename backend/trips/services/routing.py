from __future__ import annotations

import requests

BASE_URL = "https://router.project-osrm.org"
HEADERS = {"User-Agent": "TripLogger/1.0 (mohammadhadeed8@gmail.com)"}
TIMEOUT = 10
METERS_PER_MILE = 1609.344


class RoutingError(Exception):
    pass


def _fetch(a: tuple[float, float], b: tuple[float, float]):
    lat_a, lng_a = a
    lat_b, lng_b = b
    url = f"{BASE_URL}/route/v1/driving/{lng_a},{lat_a};{lng_b},{lat_b}"
    resp = requests.get(
        url,
        params={"overview": "full", "geometries": "geojson"},
        headers=HEADERS,
        timeout=TIMEOUT,
    )
    if resp.status_code >= 500:
        raise requests.HTTPError(str(resp.status_code))
    resp.raise_for_status()
    return resp.json()


def get_route(a: tuple[float, float], b: tuple[float, float]) -> dict:
    data = None
    for attempt in range(2):
        try:
            data = _fetch(a, b)
            break
        except requests.RequestException as exc:
            if attempt == 1:
                raise RoutingError(str(exc)) from exc

    route = data["routes"][0]
    miles = route["distance"] / METERS_PER_MILE
    minutes = route["duration"] / 60
    minutes = max(minutes, miles / 55 * 60)
    geometry = [(lat, lng) for lng, lat in route["geometry"]["coordinates"]]

    return {"miles": miles, "minutes": minutes, "geometry": geometry}
