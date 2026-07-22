from __future__ import annotations

from django.http import JsonResponse
from rest_framework.response import Response
from rest_framework.views import APIView


def health(request):
    """Cheap liveness check for uptime pingers - no external calls, so it
    keeps a free-tier dyno awake without touching Nominatim/OSRM."""
    return JsonResponse({"status": "ok"})

from trips.hos.engine import TripTooLongError, plan_trip
from trips.hos.logsheets import build_day_logs
from trips.hos.models import DutyStatus, Leg
from trips.serializers import TripRequestSerializer
from trips.services.geocoding import GeocodeError, geocode, reverse
from trips.services.polyline import point_at_mile
from trips.services.routing import RoutingError, get_route

STOP_TYPE_MAP = {
    "Pickup": "pickup",
    "Dropoff": "dropoff",
    "Fuel stop": "fuel",
    "30-min break": "break",
    "10-hour rest": "rest",
    "34-hour restart": "restart",
}

# request field -> (locations key, response label)
LOCATION_FIELDS = (
    ("current_location", "current"),
    ("pickup_location", "pickup"),
    ("dropoff_location", "dropoff"),
)


class TripPlanView(APIView):
    def post(self, request):
        serializer = TripRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        locations = {}
        for field, key in LOCATION_FIELDS:
            try:
                locations[key] = geocode(data[field])
            except GeocodeError as exc:
                return Response({"detail": str(exc), "field": field}, status=422)

        try:
            leg1_route = get_route(
                (locations["current"]["lat"], locations["current"]["lng"]),
                (locations["pickup"]["lat"], locations["pickup"]["lng"]),
            )
            leg2_route = get_route(
                (locations["pickup"]["lat"], locations["pickup"]["lng"]),
                (locations["dropoff"]["lat"], locations["dropoff"]["lng"]),
            )
        except RoutingError as exc:
            return Response({"detail": str(exc)}, status=502)

        geometry = list(leg1_route["geometry"]) + list(leg2_route["geometry"])
        legs = [
            Leg(miles=leg1_route["miles"], minutes=leg1_route["minutes"]),
            Leg(miles=leg2_route["miles"], minutes=leg2_route["minutes"]),
        ]

        try:
            timeline = plan_trip(legs, data["current_cycle_used"], data["departure_time"])
        except TripTooLongError as exc:
            return Response({"detail": str(exc)}, status=422)

        # endpoints, in odometer order, used as a fallback label when reverse-geocoding
        # returns nothing (e.g. a stop that lands over open water/desert).
        endpoints = [
            (0.0, locations["current"]["display_name"]),
            (leg1_route["miles"], locations["pickup"]["display_name"]),
            (leg1_route["miles"] + leg2_route["miles"], locations["dropoff"]["display_name"]),
        ]

        def nearest_endpoint_name(miles_from_origin: float) -> str:
            return min(endpoints, key=lambda e: abs(e[0] - miles_from_origin))[1]

        stops = []
        for seg in timeline.segments:
            if seg.label in ("", "Driving"):
                continue
            lat, lng = point_at_mile(geometry, seg.start_odometer)
            location = reverse(lat, lng) or nearest_endpoint_name(seg.start_odometer)
            seg.location = location  # carried into build_day_logs() remarks below
            stops.append(
                {
                    "type": STOP_TYPE_MAP.get(seg.label, seg.label.lower()),
                    "lat": lat,
                    "lng": lng,
                    "arrival": seg.start.isoformat(),
                    "duration_min": round(seg.minutes),
                    "label": f"{seg.label} — {location}",
                    "miles_from_origin": round(seg.start_odometer, 1),
                }
            )

        logs = build_day_logs(timeline)

        total_miles = round(sum(leg.miles for leg in legs), 1)
        total_duration_hrs = round(sum(leg.minutes for leg in legs) / 60, 1)

        driving_minutes = sum(
            seg.minutes for seg in timeline.segments if seg.status == DutyStatus.DRIVING
        )
        on_duty_minutes = sum(
            seg.minutes for seg in timeline.segments if seg.status == DutyStatus.ON_DUTY
        )

        rest_stops = sum(1 for seg in timeline.segments if seg.label == "10-hour rest")
        fuel_stops = sum(1 for seg in timeline.segments if seg.label == "Fuel stop")
        breaks = sum(1 for seg in timeline.segments if seg.label == "30-min break")
        arrival = timeline.segments[-1].end.isoformat() if timeline.segments else None

        response = {
            "locations": locations,
            "route": {
                "geometry": geometry,
                "total_miles": total_miles,
                "total_duration_hrs": total_duration_hrs,
            },
            "summary": {
                "total_days": len(logs),
                "total_miles": total_miles,
                "driving_hrs": round(driving_minutes / 60, 1),
                "on_duty_hrs": round((driving_minutes + on_duty_minutes) / 60, 1),
                "rest_stops": rest_stops,
                "fuel_stops": fuel_stops,
                "breaks": breaks,
                "restart_inserted": timeline.restart_inserted,
                "arrival": arrival,
            },
            "stops": stops,
            "segments": [
                {
                    "status": seg.status.value,
                    "start": seg.start.isoformat(),
                    "end": seg.end.isoformat(),
                    "miles": round(seg.miles, 1),
                    "start_miles_from_origin": round(seg.start_odometer, 1),
                    "location_hint": seg.location,
                }
                for seg in timeline.segments
            ],
            "logs": [
                {
                    "date": day.date.isoformat(),
                    "grid": [
                        {
                            "status": entry.status.value,
                            "start_min": entry.start_min,
                            "end_min": entry.end_min,
                        }
                        for entry in day.grid
                    ],
                    "totals": day.totals,
                    "total_miles": day.total_miles,
                    "remarks": [
                        {
                            "time_min": remark.time_min,
                            "end_min": remark.end_min,
                            "city_state": remark.location,
                            "note": remark.note,
                        }
                        for remark in day.remarks
                    ],
                }
                for day in logs
            ],
        }
        return Response(response, status=200)
