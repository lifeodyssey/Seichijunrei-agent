import test from "node:test";
import assert from "node:assert/strict";
import { buildRuntimeSecrets, runtimeConfig } from "./testing/runtime-secrets.ts";

test("production with anonymous access disabled needs neither identity nor Turnstile secrets", async () => {
  const config = runtimeConfig();
  config["animichi-neon-secrets:anonymousAccessEnabled"] = "false";
  delete config["animichi-neon-secrets:ANON_ID_SECRET"];
  delete config["animichi-neon-secrets:TURNSTILE_SECRET"];
  const resources = await buildRuntimeSecrets("prod", config);
  assert.deepEqual(resources.map((resource) => resource.inputs.name), [
    "DEEPSEEK_API_KEY_PROD", "MIMO_API_KEY_PROD", "ZEN_GO_API_KEY_PROD",
    "GOOGLE_MAPS_API_KEY_PROD", "LOGFIRE_TOKEN_PROD",
  ]);
});
