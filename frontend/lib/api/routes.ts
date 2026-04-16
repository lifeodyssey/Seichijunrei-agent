import { RUNTIME_URL, getAuthHeaders } from "./client";

export interface RouteHistoryEntry {
  id: string;
  bangumi_id: string;
  bangumi_title: string | null;
  origin_station: string | null;
  point_count: number;
  created_at: string;
}

export async function fetchRouteHistory(): Promise<RouteHistoryEntry[]> {
  const authHeaders = await getAuthHeaders();
  if (!authHeaders.Authorization) return [];

  const res = await fetch(`${RUNTIME_URL}/v1/routes`, {
    headers: authHeaders,
  });

  if (!res.ok) return [];
  const data: { routes: RouteHistoryEntry[] } = await res.json();
  return data.routes;
}
