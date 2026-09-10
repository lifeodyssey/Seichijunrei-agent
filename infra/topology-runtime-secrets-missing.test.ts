import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { RUNTIME_KEYS } from "./testing/runtime-secrets.ts";

for (const name of RUNTIME_KEYS) {
  test(`missing ${name} fails the Pulumi program instead of omitting its resource`, () => {
    const script = `import { buildRuntimeSecrets, runtimeConfig } from "./testing/runtime-secrets.ts";
      const config = runtimeConfig();
      delete config["animichi-neon-secrets:" + process.argv[1]];
      await buildRuntimeSecrets("staging", config);`;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script, name], {
      cwd: new URL(".", import.meta.url), encoding: "utf8",
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, new RegExp(`Missing required configuration variable 'animichi-neon-secrets:${name}'`));
  });
}

test("a blank runtime config fails instead of provisioning an unusable credential", () => {
  const script = `import { buildRuntimeSecrets, runtimeConfig } from "./testing/runtime-secrets.ts";
    await buildRuntimeSecrets("staging", { ...runtimeConfig(), "animichi-neon-secrets:MIMO_API_KEY": " " });`;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: new URL(".", import.meta.url), encoding: "utf8",
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Empty runtime secret: MIMO_API_KEY/);
});
