import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TestContext } from "node:test";
import { neon, neonConfig } from "@neondatabase/serverless";
import { GenericContainer, Wait } from "testcontainers";
import { startTestPostgres, SPIKE_SETUP_BUDGET } from "@animichi/test-postgres";

// Published multi-platform packaging of upstream Neon Proxy release-proxy-8853.
const IMAGE = "ghcr.io/timowilhelm/local-neon-http-proxy@sha256:cd2ae14edf2feafbc3330492de5c80506f77274c3bd013154cdef697bdeb768a";
const execute = promisify(execFile);

export async function catalogPostgres(context: TestContext) {
  const postgres = await startTestPostgres({ database: "native_catalog_tools", budget: SPIKE_SETUP_BUDGET });
  context.after(() => postgres.stop());
  const proxy = await startProxy(postgres.dsn);
  context.after(() => proxy.stop().then(() => undefined));
  const endpoint = `http://${proxy.getHost()}:${String(proxy.getMappedPort(4444))}/sql`;
  const connection = new URL(postgres.dsn); connection.hostname = "db.localtest.me"; connection.port = "5432";
  const previous = neonConfig.fetchEndpoint; neonConfig.fetchEndpoint = endpoint;
  context.after(() => { neonConfig.fetchEndpoint = previous; });
  return { connectionString: connection.href, endpoint, sql: neon(connection.href) };
}

async function startProxy(dsn: string) {
  const upstream = new URL(dsn); upstream.hostname = await postgresAddress(upstream.port); upstream.port = "5432";
  return new GenericContainer(IMAGE).withEnvironment({ PG_CONNECTION_STRING: upstream.href }).withExposedPorts(4444)
    .withWaitStrategy(Wait.forAll([Wait.forLogMessage("serving initial configuration"),
      Wait.forSuccessfulCommand("bash -c '</dev/tcp/127.0.0.1/4445'")])).withStartupTimeout(60_000).start();
}

async function postgresAddress(port: string) {
  const listed = await execute("docker", ["ps", "--filter", `publish=${port}`, "--format", "{{.ID}}"]);
  const ids = listed.stdout.trim().split(/\s+/); assert.equal(ids.length, 1); assert.ok(ids[0]);
  const inspected = await execute("docker", ["inspect", ids[0]]);
  const containers = JSON.parse(inspected.stdout) as { NetworkSettings: { Networks: Record<string, { IPAddress: string }> } }[];
  assert.ok(containers[0]); const address = Object.values(containers[0].NetworkSettings.Networks)[0]?.IPAddress;
  assert.ok(address); return address;
}
