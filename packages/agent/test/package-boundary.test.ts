import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PACKAGE = fileURLToPath(new URL("..", import.meta.url));

void test("the compiler resolves public domain code without edge or eval infrastructure", () => {
  const files = execFileSync("pnpm", ["exec", "tsc", "--listFilesOnly"], { cwd: PACKAGE, encoding: "utf8" });
  assert.match(files, /packages\/agent\/src\/index\.ts/);
  assert.doesNotMatch(files, /\/workers\/|\/packages\/eval\/|\/harness\/session\/testing/);
});

void test("pnpm includes the real edge consumer and keeps the Python workspace separate", () => {
  const names = execFileSync("pnpm", ["ls", "-r", "--depth", "-1", "--filter", "...@animichi/agent"], { cwd: PACKAGE, encoding: "utf8" });
  assert.match(names, /@animichi\/agent@0\.1\.0/);
  assert.match(names, /edge-worker/);
  assert.doesNotMatch(names, /@animichi\/agent-python/);
});
