import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from "react-leaflet";
import L, { type LatLngExpression, type LatLngTuple } from "leaflet";
import "leaflet/dist/leaflet.css";
import "./RouteMap.css";
import type { TripPlan } from "../../api/types";
import { createOriginIcon, createStopIcon, formatArrival, formatDuration, formatMiles } from "./markers";

interface RouteMapProps {
  plan: TripPlan;
}

/**
 * Child-only helper: react-leaflet's useMap() only works inside a
 * MapContainer, so bounds-fitting lives in its own tiny component rather
 * than the parent. Re-fits whenever the route geometry changes (i.e. a new
 * plan came back from the API).
 */
function FitBounds({ geometry }: { geometry: LatLngTuple[] }) {
  const map = useMap();

  useEffect(() => {
    if (geometry.length === 0) return;
    const bounds = L.latLngBounds(geometry);
    map.fitBounds(bounds, { padding: [32, 32] });
  }, [geometry, map]);

  return null;
}

/**
 * Wheel zoom is off by default (see MapContainer below) so a page scroll
 * that happens to pass over the map - which sits mid-page between the stat
 * cards and the day tabs/log sheet - scrolls the page instead of getting
 * captured as a map zoom. Clicking into the map re-enables wheel zoom for
 * as long as the cursor stays over it, so the map is still fully scroll-
 * zoomable once a user has deliberately engaged with it; moving the mouse
 * back off the map disables it again.
 */
function ClickToEnableScrollZoom() {
  const map = useMap();

  useEffect(() => {
    const enable = () => map.scrollWheelZoom.enable();
    const disable = () => map.scrollWheelZoom.disable();
    const container = map.getContainer();

    map.on("click", enable);
    container.addEventListener("mouseleave", disable);

    return () => {
      map.off("click", enable);
      container.removeEventListener("mouseleave", disable);
    };
  }, [map]);

  return null;
}

export default function RouteMap({ plan }: RouteMapProps) {
  const geometry = plan.route.geometry as LatLngTuple[];

  // Leaflet path options need a concrete color string, not a CSS var
  // reference - resolve --navy-700 off the document root at render time.
  const routeColor = useMemo(() => {
    if (typeof document === "undefined") return "#1b2a5e";
    const val = getComputedStyle(document.documentElement).getPropertyValue("--navy-700").trim();
    return val || "#1b2a5e";
  }, []);

  const center: LatLngExpression =
    geometry[0] ?? [plan.locations.current.lat, plan.locations.current.lng];

  return (
    <div className="route-map">
      <MapContainer center={center} zoom={6} scrollWheelZoom={false} className="route-map__container">
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />

        <Polyline positions={geometry} pathOptions={{ color: routeColor, weight: 4, opacity: 0.85 }} />

        <Marker
          position={[plan.locations.current.lat, plan.locations.current.lng]}
          icon={createOriginIcon()}
        >
          <Popup>
            <div className="route-popup">
              <p className="route-popup__label">{plan.locations.current.display_name}</p>
              <p className="route-popup__sub">Trip origin</p>
            </div>
          </Popup>
        </Marker>

        {plan.stops.map((stop, index) => (
          <Marker
            key={`${stop.type}-${index}-${stop.miles_from_origin}`}
            position={[stop.lat, stop.lng]}
            icon={createStopIcon(stop.type, index)}
          >
            <Popup>
              <div className="route-popup">
                <p className="route-popup__label">{stop.label}</p>
                <dl className="route-popup__grid">
                  <dt>Arrival</dt>
                  <dd className="num">{formatArrival(stop.arrival)}</dd>
                  <dt>Duration</dt>
                  <dd className="num">{formatDuration(stop.duration_min)}</dd>
                  <dt>Miles</dt>
                  <dd className="num">{formatMiles(stop.miles_from_origin)} mi</dd>
                </dl>
              </div>
            </Popup>
          </Marker>
        ))}

        <FitBounds geometry={geometry} />
        <ClickToEnableScrollZoom />
      </MapContainer>
    </div>
  );
}
