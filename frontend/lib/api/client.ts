import { getSupabaseClient } from "../supabase";

export const RUNTIME_URL =
  (process.env.NEXT_PUBLIC_RUNTIME_URL ?? "").replace(/\/$/, "");

/** Safely parse response_data which may be a JSON string, object, or null. */
export function parseResponseData(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
  }
  if (typeof raw === "object") return raw as Record<string, unknown>;
  return null;
}

/**
 * Convert DB-stored response_data into a RuntimeResponse-shaped object.
 *
 * DB stores: { intent, success, final_output: { results, status, message, ... } }
 * Frontend expects: RuntimeResponse { intent, success, status, message, data: { results | route } }
 *
 * This bridges the gap so hydrated messages render correctly.
 */
export function hydrateResponseData(
  raw: Record<string, unknown> | null,
): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  // If it already looks like a RuntimeResponse (has 'data' key), pass through
  if ("data" in raw && raw.data != null) return raw;
  // Convert from DB format: extract final_output as data
  const finalOutput = raw.final_output;
  if (finalOutput != null && typeof finalOutput === "object") {
    return {
      ...raw,
      data: finalOutput,
    };
  }
  return raw;
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const supabase = getSupabaseClient();
  if (!supabase) return {};

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return {};
  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.access_token}`,
  };
  // In production, Cloudflare Worker injects X-User-Id after JWT validation.
  // For local dev (no Worker), inject it from the session so the backend
  // doesn't reject requests with 400 "X-User-Id header required."
  if (session.user?.id) {
    headers["X-User-Id"] = session.user.id;
    headers["X-User-Type"] = "human";
  }
  return headers;
}

export interface PopularBangumiEntry {
  bangumi_id: string;
  title: string;
  cover_url: string | null;
}

/**
 * Fetch the popular bangumi list for the WelcomeScreen anime chips.
 * Returns an empty array on any error or if the endpoint returns nothing.
 */
export async function fetchPopularBangumi(): Promise<PopularBangumiEntry[]> {
  try {
    const res = await fetch(`${RUNTIME_URL}/v1/bangumi/popular`, {
      headers: await getAuthHeaders(),
    });
    if (!res.ok) return [];
    const data: { bangumi: PopularBangumiEntry[] } = await res.json();
    return data.bangumi ?? [];
  } catch {
    return [];
  }
}
