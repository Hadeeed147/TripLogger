from __future__ import annotations
import math

EARTH_MILES = 3958.8


def _haversine(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lng1, lat2, lng2 = map(math.radians, (*a, *b))
    h = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2)
    return 2 * EARTH_MILES * math.asin(math.sqrt(h))


def total_miles(geometry: list[tuple[float, float]]) -> float:
    return sum(_haversine(a, b) for a, b in zip(geometry, geometry[1:]))


def point_at_mile(geometry: list[tuple[float, float]], mile: float) -> tuple[float, float]:
    if mile <= 0:
        return geometry[0]
    acc = 0.0
    for a, b in zip(geometry, geometry[1:]):
        d = _haversine(a, b)
        if acc + d >= mile and d > 0:
            f = (mile - acc) / d
            return (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)
        acc += d
    return geometry[-1]
