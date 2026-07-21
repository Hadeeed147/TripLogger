import type { TripPlan, TripRequest } from "./types";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  status: number;
  detail: string;
  field?: string;

  constructor(status: number, detail: string, field?: string) {
    super(detail);
    this.status = status;
    this.detail = detail;
    this.field = field;
  }
}

export async function planTrip(req: TripRequest): Promise<TripPlan> {
  const res = await fetch(`${BASE}/api/trips`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(res.status, body.detail ?? "Request failed", body.field);
  }
  return res.json();
}
