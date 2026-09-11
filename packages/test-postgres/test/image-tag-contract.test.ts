/**
 * Every consumer of the offline image must resolve the SAME tag (#1326).
 *
 * They used to carry three copies of it: the catalog spike fixture, the edge
 * agent-db fixture and `scripts/local-gates/db-fresh-schema.sh`. A tag that
 * drifts in one of them does not fail — it silently boots a different (or a
 * missing) image, which is why this is a gate rather than a convention. The
 * native rewrite (#1582) retired the single edge arm file, so the edge side of
 * this contract is now the set of lane fixtures, discovered the same way the
 * setup-budget witness discovers them.
 *
 * Two consumers are TypeScript and one is bash, so the single declaration is
 * `postgres-image.env` and each side reads it its own way. This test resolves
 * BOTH ways — it runs the shell read rather than reading the shell — and then
 * checks that no consumer kept a tag of its own to drift with.
 *
 * The fourth place the tag appears is the workflow step that BUILDS the image.
 * A `run:` can source the declaration, so that step keeps no copy either, and
 * this package no longer reads `.github/workflows/pr-verification.yml` to find
 * out (card B2 / #1360): pipeline text is the CI contract's to read, and
 * `.github/test/pr-verification-affected.test.rb` reads the declaration too, so
 * neither side holds a second copy of the tag.
 *
 * test-type: unit (reads checked-in files and one `bash -c`; no network).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { OFFLINE_POSTGRES_IMAGE } from "../src/postgres-image.ts";

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, ROOT), "utf8");

const IMAGE_DECLARATION = "packages/test-postgres/postgres-image.env";
const FRESH_SCHEMA_GATE = "scripts/local-gates/db-fresh-schema.sh";
const SPIKE_FIXTURE = "workers/catalog/test/spike-db-global.ts";
const EDGE_DIR = "workers/edge";

/** Every edge lane file that boots the shared postgres recipe, discovered from
 * the `*-test` lane directories rather than listed by hand. */
function edgePostgresFixtures(): string[] {
  return readdirSync(new URL(`${EDGE_DIR}/`, ROOT), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith("-test"))
    .flatMap((lane) =>
      readdirSync(new URL(`${EDGE_DIR}/${lane.name}/`, ROOT))
        .filter((file) => file.endsWith(".ts"))
        .map((file) => `${EDGE_DIR}/${lane.name}/${file}`),
    )
    .filter((path) => read(path).includes("startTestPostgres"));
}

/** The repository's image family. A consumer that names one names its own. */
const IMAGE_LITERAL = /animichi-test-postgres:/;
/** The only expression that may name an image to testcontainers. */
const CONTAINER_CONSTRUCTION = /new GenericContainer\(/;

/** Resolve the tag the way bash does: source the declaration, print the value. */
function shellResolvedImage(): string {
  const script = '. "$1"; printf %s "$TEST_POSTGRES_IMAGE"';
  const declaration = fileURLToPath(new URL(IMAGE_DECLARATION, ROOT));
  return execFileSync("bash", ["-c", script, "bash", declaration], { encoding: "utf8" });
}

void test("bash and TypeScript resolve the same tag from the one declaration", () => {
  assert.equal(shellResolvedImage(), OFFLINE_POSTGRES_IMAGE);
  assert.match(OFFLINE_POSTGRES_IMAGE, IMAGE_LITERAL);
});

void test("the fresh-schema gate sources that declaration instead of repeating it", () => {
  const gate = read(FRESH_SCHEMA_GATE);
  const sourced = new RegExp(`\\. "\\$ROOT/${IMAGE_DECLARATION.replaceAll(".", "\\.")}"`);
  assert.match(gate, sourced);
  assert.match(gate, /IMAGE="\$TEST_POSTGRES_IMAGE"/);
  assert.doesNotMatch(gate, IMAGE_LITERAL);
});

void test("the catalog spike fixture names no image and boots no container of its own", () => {
  const fixture = read(SPIKE_FIXTURE);
  assert.doesNotMatch(fixture, IMAGE_LITERAL);
  assert.doesNotMatch(fixture, CONTAINER_CONSTRUCTION);
  assert.match(fixture, /startTestPostgres\(/);
});

void test("every edge lane fixture names no image and boots no container of its own", () => {
  const fixtures = edgePostgresFixtures();
  assert.ok(fixtures.length > 0, `no startTestPostgres fixture found under ${EDGE_DIR}`);
  for (const fixture of fixtures) {
    const source = read(fixture);
    assert.doesNotMatch(source, IMAGE_LITERAL, fixture);
    assert.doesNotMatch(source, CONTAINER_CONSTRUCTION, fixture);
    assert.match(source, /startTestPostgres\(/, fixture);
  }
});
