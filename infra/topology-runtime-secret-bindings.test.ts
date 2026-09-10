import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";
import { parse } from "smol-toml";
import { RUNTIME_KEYS } from "./testing/runtime-secrets.ts";

const config = fileURLToPath(new URL("../workers/edge/wrangler.toml", import.meta.url));

for (const [environment, stack, suffix, enabled] of [["staging", "staging", "", true], ["production", "prod", "_PROD", false]] as const) {
  const expectedKeys = enabled ? RUNTIME_KEYS : [
    "DEEPSEEK_API_KEY", "MIMO_API_KEY", "ZEN_GO_API_KEY", "GOOGLE_MAPS_API_KEY", "LOGFIRE_TOKEN",
  ];
  test(`${environment} binds each runtime secret to its own Secrets Store name`, () => {
    const document = parse(readFileSync(config, "utf8")) as {
      env: Record<string, { secrets_store_secrets: { binding: string; store_id: string; secret_name: string }[] }>;
    };
    const bindings = document.env[environment].secrets_store_secrets;
    const runtime = bindings.filter((binding) => RUNTIME_KEYS.includes(binding.binding));
    assert.deepEqual(runtime, expectedKeys.map((name) => ({
      binding: name, store_id: "66c9bb0faef644b4a0671bb7d90d98bd", secret_name: `${name}${suffix}`,
    })));
    assert.equal(bindings.some((binding) => binding.binding === "SUPABASE_DB_URL"), false);
  });

  test(`${stack} imports its explicitly assigned ESC environment without inline runtime values`, () => {
    const source = readFileSync(new URL(`./database-access/Pulumi.${stack}.yaml`, import.meta.url), "utf8");
    const document = load(source) as { environment: string[]; config: Record<string, unknown> };
    assert.deepEqual(document.environment, [`animichi/${stack}`]);
    const worker = parse(readFileSync(config, "utf8")) as { env: Record<string, { vars: { ANON_ACCESS_ENABLED: string } }> };
    assert.equal(document.config["animichi-neon-secrets:anonymousAccessEnabled"], enabled);
    assert.equal(worker.env[environment].vars.ANON_ACCESS_ENABLED, String(enabled));
    assert.deepEqual(Object.keys(document.config).filter((key) => RUNTIME_KEYS.some((name) => key.endsWith(`:${name}`))), []);
  });
}
