import { getSupabaseClient } from "./supabase";

export interface ApiKey {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  revoked: boolean;
}

function requireSupabaseClient() {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error("Supabase public client is not configured.");
  }
  return supabase;
}

export async function createApiKey(name: string): Promise<{ rawKey: string; id: string }> {
  const supabase = requireSupabaseClient();
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const rawKey = "sk_" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");

  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(rawKey));
  const keyHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const { data, error } = await supabase
    .from("api_keys")
    .insert({ name, key_hash: keyHash })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return { rawKey, id: data.id };
}

export async function listApiKeys(): Promise<ApiKey[]> {
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase
    .from("api_keys")
    .select("id, name, created_at, last_used_at, revoked")
    .eq("revoked", false)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function revokeApiKey(id: string): Promise<void> {
  const supabase = requireSupabaseClient();
  const { error } = await supabase.from("api_keys").update({ revoked: true }).eq("id", id);
  if (error) throw new Error(error.message);
}
