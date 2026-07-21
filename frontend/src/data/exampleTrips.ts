import type { TripFormPrefill } from "../components/TripForm/TripForm";

/**
 * One-click starter trips shown as chips in the empty-state panel
 * (src/App.tsx). Each satisfies TripFormPrefill so it can be handed
 * straight to TripForm's imperative fillExample() ref method.
 */
export interface ExampleTrip extends TripFormPrefill {
  id: string;
  label: string;
}

export const EXAMPLE_TRIPS: ExampleTrip[] = [
  {
    id: "chicago-denver-la",
    label: "Chicago → Denver → LA · cycle 10",
    current_location: "Chicago, IL",
    pickup_location: "Denver, CO",
    dropoff_location: "Los Angeles, CA",
    current_cycle_used: 10,
  },
  {
    id: "dallas-atlanta-fresh",
    label: "Dallas → Atlanta · fresh driver (cycle 0)",
    current_location: "Dallas, TX",
    pickup_location: "Dallas, TX",
    dropoff_location: "Atlanta, GA",
    current_cycle_used: 0,
  },
  {
    id: "nyc-philly-dc-restart",
    label: "Short haul + forced restart · cycle 69",
    current_location: "New York, NY",
    pickup_location: "Philadelphia, PA",
    dropoff_location: "Washington, DC",
    current_cycle_used: 69,
  },
];
