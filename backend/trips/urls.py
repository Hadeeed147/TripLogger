from django.urls import path

from trips.views import TripPlanView, health

urlpatterns = [
    path("api/health", health),
    path("api/trips", TripPlanView.as_view()),
]
