import assert from "node:assert/strict";
import test from "node:test";

test("getSupabaseClient returns null when public env vars are missing", () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const modulePath = require.resolve("../lib/supabase");
  delete require.cache[modulePath];

  const supabaseModule = require("../lib/supabase") as typeof import("../lib/supabase");

  assert.equal(supabaseModule.getSupabaseClient(), null);
});
