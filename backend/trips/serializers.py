from __future__ import annotations

from datetime import datetime, timedelta

from rest_framework import serializers


def round_up_to_15(dt: datetime) -> datetime:
    """Round a naive datetime UP to the next 15-minute boundary."""
    dt = dt.replace(second=0, microsecond=0)
    remainder = dt.minute % 15
    if remainder == 0:
        return dt
    return dt + timedelta(minutes=15 - remainder)


class TripRequestSerializer(serializers.Serializer):
    current_location = serializers.CharField()
    pickup_location = serializers.CharField()
    dropoff_location = serializers.CharField()
    current_cycle_used = serializers.FloatField(min_value=0, max_value=70)
    departure_time = serializers.DateTimeField(required=False)

    def validate_departure_time(self, value: datetime) -> datetime:
        if value.tzinfo is not None:
            value = value.replace(tzinfo=None)
        return value

    def validate(self, attrs: dict) -> dict:
        if not attrs.get("departure_time"):
            attrs["departure_time"] = round_up_to_15(datetime.now())
        return attrs
