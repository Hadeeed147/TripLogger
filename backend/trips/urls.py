from django.urls import path

from trips.views import TripPlanView

urlpatterns = [
    path("api/trips", TripPlanView.as_view()),
]
