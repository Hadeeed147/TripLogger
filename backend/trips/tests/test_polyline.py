from trips.services.polyline import point_at_mile, total_miles

# ~69.1 miles per degree of latitude; two-point north-south line
GEOM = [(35.0, -100.0), (36.0, -100.0)]

def test_total_miles_close_to_69():
    assert abs(total_miles(GEOM) - 69.1) < 0.5

def test_midpoint():
    lat, lng = point_at_mile(GEOM, total_miles(GEOM) / 2)
    assert abs(lat - 35.5) < 0.01 and abs(lng + 100.0) < 0.01

def test_clamps_beyond_ends():
    assert point_at_mile(GEOM, -5) == GEOM[0]
    assert point_at_mile(GEOM, 10_000) == GEOM[-1]
