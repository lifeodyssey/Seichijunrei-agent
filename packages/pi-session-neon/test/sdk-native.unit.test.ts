import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import type { SessionRepo, Storage } from "@earendil-works/pi-agent-core/harness/session";
import { NeonSessionRepo, NeonStorage } from "@animichi/pi-session-neon";
import postgresClient from "@prisma/orm-postgres/runtime";
import contractJson from "../src/contract.json" with { type: "json" };
import type { Contract } from "../src/contract.d.ts";
import { build } from "esbuild";

void test("the resolved public SDK package is exactly 0.85.1", async () => {
  const metadata: unknown = JSON.parse(await readFile(new URL(import.meta.resolve("@earendil-works/pi-agent-core/package.json")), "utf8"));
  assert(metadata !== null && typeof metadata === "object" && "version" in metadata);
  assert.equal(metadata.version, "0.85.1");
});

void test("the native Storage seals admission without opening a database connection", async () => {
  const db = postgresClient<Contract>({ contractJson, url: "postgresql://unused:unused@127.0.0.1:1/unused" });
  const storage: Storage = new NeonStorage(db, { sessionId: "closed" });
  const repo: SessionRepo = new NeonSessionRepo(db);
  assert(repo instanceof NeonSessionRepo);
  await storage.close(BACKGROUND_CONTEXT);
  await storage.close(BACKGROUND_CONTEXT);
  await assert.rejects(storage.commit([], BACKGROUND_CONTEXT), /NeonStorage is closed/);
  await db.close();
});

void test("the public runtime bundles for Workers without Node-only conformance or test infrastructure", async () => {
  const result = await build({ entryPoints: [new URL("../src/index.ts", import.meta.url).pathname],
    bundle: true, platform: "browser", format: "esm", write: false, metafile: true });
  const nodeOnly = Object.keys(result.metafile.inputs).filter((path) =>
    /harness\/session\/testing\/|test-postgres|testcontainers|node-postgres|node:/.test(path));
  assert.deepEqual(nodeOnly, []);
  assert(result.outputFiles[0]?.text.includes("NeonSessionRepo"));
});
