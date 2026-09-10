import test from "node:test";
import assert from "node:assert/strict";
import { resolveContainerEnvVars } from "../src/container/container-env.ts";

const LOCAL_ENV = {
  DEEPSEEK_API_KEY: "local-deepseek", MIMO_API_KEY: "local-mimo",
  APP_ENV: "development",
};

void test("the container reads its MiMo credential from a Secrets Store binding", async () => {
  const env = await resolveContainerEnvVars({
    ...LOCAL_ENV, MIMO_API_KEY: { get: () => Promise.resolve("store-mimo") },
  });
  assert.equal(env.MIMO_API_KEY, "store-mimo");
});

for (const name of ["DEEPSEEK_API_KEY", "MIMO_API_KEY", "ZEN_GO_API_KEY", "GOOGLE_MAPS_API_KEY", "LOGFIRE_TOKEN"]) {
  void test(`the container receives ${name} from its native binding`, async () => {
    const env = await resolveContainerEnvVars({ ...LOCAL_ENV, [name]: { get: () => Promise.resolve(`store-${name}`) } });
    assert.equal(env[name], `store-${name}`);
  });
}

void test("local development retains plain string credentials", async () => {
  assert.equal((await resolveContainerEnvVars(LOCAL_ENV)).MIMO_API_KEY, "local-mimo");
});

void test("an empty required store value refuses container startup", async () => {
  await assert.rejects(resolveContainerEnvVars({ ...LOCAL_ENV, MIMO_API_KEY: { get: () => Promise.resolve("") } }), /Missing required container env: MIMO_API_KEY/);
});

void test("an absent optional key remains absent from the process environment", async () => {
  assert.equal(Object.hasOwn(await resolveContainerEnvVars(LOCAL_ENV), "ZEN_GO_API_KEY"), false);
});

void test("edge-only secrets are never read or forwarded into the container", async () => {
  const unreadable = { get: () => Promise.reject(new Error("must not read")) };
  const env = await resolveContainerEnvVars({ ...LOCAL_ENV, TURNSTILE_SECRET: unreadable, ANON_ID_SECRET: unreadable, OTHER_SECRET: unreadable });
  assert.equal(Object.hasOwn(env, "TURNSTILE_SECRET"), false);
  assert.equal(Object.hasOwn(env, "ANON_ID_SECRET"), false);
  assert.equal(Object.hasOwn(env, "OTHER_SECRET"), false);
});

void test("the retired database binding is not read or forwarded", async () => {
  const env = await resolveContainerEnvVars({
    ...LOCAL_ENV, SUPABASE_DB_URL: { get: () => Promise.reject(new Error("retired credential must not be read")) },
  });
  assert.equal(Object.hasOwn(env, "SUPABASE_DB_URL"), false);
});
