from dataclasses import dataclass
from datetime import datetime
from enum import Enum


class DutyStatus(str, Enum):
    OFF = "off"
    SLEEPER = "sleeper"
    DRIVING = "driving"
    ON_DUTY = "on_duty"


@dataclass(frozen=True)
class Leg:
    """One routed hop."""

    miles: float
    minutes: float


@dataclass
class Segment:
    status: DutyStatus
    start: datetime  # naive terminal time
    end: datetime
    miles: float = 0.0  # driven during this segment (0 for stops)
    start_odometer: float = 0.0  # route-miles from origin at segment start
    label: str = ""  # "Driving"|"Pickup"|"Dropoff"|"Fuel stop"|"30-min break"|"10-hour rest"|"34-hour restart"
    location: str = ""  # city/state; filled by API layer

    @property
    def minutes(self) -> float:
        return (self.end - self.start).total_seconds() / 60.0

    @property
    def end_odometer(self) -> float:
        return self.start_odometer + self.miles


@dataclass
class Timeline:
    segments: list[Segment]
    restart_inserted: bool = False
