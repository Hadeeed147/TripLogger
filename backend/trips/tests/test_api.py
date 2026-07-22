import pytest
from rest_framework.test import APIClient


def test_health_ok():
    r = APIClient().get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}

GEO = {
    "chicago, il": {"query": "Chicago, IL", "display_name": "Chicago, Illinois", "lat": 41.88, "lng": -87.63},
    "denver, co": {"query": "Denver, CO", "display_name": "Denver, Colorado", "lat": 39.74, "lng": -104.99},
    "los angeles, ca": {"query": "Los Angeles, CA", "display_name": "Los Angeles, California", "lat": 34.05, "lng": -118.24},
}

@pytest.fixture
def client(monkeypatch):
    from trips import views
    monkeypatch.setattr(views, "geocode", lambda q: GEO[q.strip().lower()])
    monkeypatch.setattr(views, "reverse", lambda lat, lng: "Somewhere, US")
    def fake_route(a, b):
        import math
        miles = math.dist(a, b) * 69.0
        return {"miles": miles, "minutes": miles / 55 * 60, "geometry": [a, b]}
    monkeypatch.setattr(views, "get_route", fake_route)
    return APIClient()

BODY = {
    "current_location": "Chicago, IL",
    "pickup_location": "Denver, CO",
    "dropoff_location": "Los Angeles, CA",
    "current_cycle_used": 10.0,
    "departure_time": "2026-07-21T08:00:00",
}

def test_happy_path_contract(client):
    r = client.post("/api/trips", BODY, format="json")
    assert r.status_code == 200
    data = r.json()
    for key in ("locations", "route", "summary", "stops", "segments", "logs"):
        assert key in data
    assert data["summary"]["total_days"] == len(data["logs"])
    for day in data["logs"]:
        assert sum(day["totals"].values()) == 1440
    types = {s["type"] for s in data["stops"]}
    assert {"pickup", "dropoff"} <= types
    assert data["route"]["total_miles"] > 1500

def test_validation_errors(client):
    r = client.post("/api/trips", {**BODY, "current_cycle_used": 71}, format="json")
    assert r.status_code == 400
    r = client.post("/api/trips", {k: v for k, v in BODY.items() if k != "pickup_location"}, format="json")
    assert r.status_code == 400

def test_geocode_failure_names_field(client, monkeypatch):
    from trips import views
    from trips.services.geocoding import GeocodeError
    def failing(q):
        if "denver" in q.lower():
            raise GeocodeError(f"No results for {q}")
        return GEO[q.strip().lower()]
    monkeypatch.setattr(views, "geocode", failing)
    r = client.post("/api/trips", BODY, format="json")
    assert r.status_code == 422
    assert r.json()["field"] == "pickup_location"

def test_routing_failure_returns_502(client, monkeypatch):
    from trips import views
    from trips.services.routing import RoutingError
    def down(a, b):
        raise RoutingError("OSRM unavailable")
    monkeypatch.setattr(views, "get_route", down)
    r = client.post("/api/trips", BODY, format="json")
    assert r.status_code == 502
    assert "detail" in r.json()
