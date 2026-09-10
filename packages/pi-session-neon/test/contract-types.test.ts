import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const dependencies = fileURLToPath(new URL("../../../node_modules/", import.meta.url));
const contract = fileURLToPath(new URL("../src/contract", import.meta.url));
const imports = `import postgres from "@prisma/orm-postgres/runtime";
import type { Entry } from "@earendil-works/pi-agent-core/harness/session";
import type { Contract } from "${contract}.d.ts";
import contractJson from "${contract}.json" with { type: "json" };
const db = postgres<Contract>({ contractJson });
const entry: Entry = { id: "entry", parentId: null, seq: 0, timestamp: 123,
  type: "custom", customType: "choice", data: { city: "京都" } };`;

async function compile(query: string) {
  const directory = await mkdtemp(join(tmpdir(), "pi-contract-types-"));
  try {
    await symlink(dependencies, join(directory, "node_modules"));
    await writeFile(join(directory, "query.mts"), `${imports}\n${query}\n`);
    return spawnSync(join(dependencies, ".bin/tsc"), ["--noEmit", "--strict", "--skipLibCheck", "false",
      "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2022",
      "--lib", "ES2022,ESNext.Temporal,DOM",
      "--types", "node", "--resolveJsonModule", "--allowImportingTsExtensions", join(directory, "query.mts")],
    { cwd: directory, encoding: "utf8" });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

void test("published Prisma and Pi types accept the emitted native session query without declaration suppression", async () => {
  const result = await compile('db.sql.public.pi_sessions.insert([{ id: entry.id, metadata: { id: entry.id }, next_seq: entry.seq }]).build();');
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

void test("an unknown native query field fails compilation", async () => {
  const result = await compile('db.sql.public.pi_sessions.select("invented_field").build();');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /error TS2769: No overload matches/);
});

void test("a string cannot replace the native numeric sequence", async () => {
  const result = await compile('db.sql.public.pi_sessions.insert([{ id: entry.id, metadata: {}, next_seq: "wrong" }]).build();');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /Type 'string' is not assignable to type/);
});
