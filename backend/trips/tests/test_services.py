import pytest
from django.core.cache import cache
from trips.services import geocoding, routing

class FakeResp:
    def __init__(self, payload, status=200):
        self._p, self.status_code = payload, status
    def json(self):
        return self._p
    def raise_for_status(self):
        if self.status_code >= 400:
            import requests
            raise requests.HTTPError(str(self.status_code))

@pytest.fixture(autouse=True)
def clear_cache():
    cache.clear()

def test_geocode_success_and_cache(monkeypatch):
    calls = []
    monkeypatch.setattr(geocoding.requests, "get",
        lambda url, **kw: calls.append(url) or FakeResp([{"display_name": "Chicago, Cook County, Illinois", "lat": "41.88", "lon": "-87.63"}]))
    r1 = geocoding.geocode("chicago")
    r2 = geocoding.geocode("Chicago ")          # cache hit — same normalized key
    assert r1["lat"] == 41.88 and r1["lng"] == -87.63
    assert len(calls) == 1 and r1 == r2 | {"query": "chicago"}

def test_geocode_not_found(monkeypatch):
    monkeypatch.setattr(geocoding.requests, "get", lambda url, **kw: FakeResp([]))
    with pytest.raises(geocoding.GeocodeError):
        geocoding.geocode("zzzzplace")

def test_reverse_never_raises(monkeypatch):
    def boom(url, **kw):
        raise Exception("network down")
    monkeypatch.setattr(geocoding.requests, "get", boom)
    assert geocoding.reverse(41.88, -87.63) == ""

def test_route_flips_geometry_and_floors_speed(monkeypatch):
    payload = {"code": "Ok", "routes": [{
        "distance": 1609344.0,                      # 1000 miles
        "duration": 12 * 3600,                      # 12h — car-optimistic
        "geometry": {"coordinates": [[-87.63, 41.88], [-104.99, 39.74]]},
    }]}
    monkeypatch.setattr(routing.requests, "get", lambda url, **kw: FakeResp(payload))
    r = routing.get_route((41.88, -87.63), (39.74, -104.99))
    assert round(r["miles"]) == 1000
    assert round(r["minutes"]) == round(1000 / 55 * 60)   # floored, not 720
    assert r["geometry"][0] == (41.88, -87.63)

def test_route_retries_then_raises(monkeypatch):
    calls = []
    def flaky(url, **kw):
        calls.append(1)
        return FakeResp({}, status=502)
    monkeypatch.setattr(routing.requests, "get", flaky)
    with pytest.raises(routing.RoutingError):
        routing.get_route((0, 0), (1, 1))
    assert len(calls) == 2
