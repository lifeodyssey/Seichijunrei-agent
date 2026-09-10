import test from "node:test";
import assert from "node:assert/strict";
import { AGENT_PATHS } from "@animichi/contract/agent-paths";
import {
  ANON_V1_PATHS,
  PUBLIC_V1_PATHS,
  isAnonymousV1,
  isPublicV1,
} from "../src/gateway/routing-policy.ts";
import { classifyRatePolicy } from "../src/gateway/rate-policy.ts";

// EDGE-1 #963: the edge's route tables derive from the AGENT_PATHS inventory
// (CONTRACT-1 #938) instead of floating as hand-maintained magic strings. A
// table entry that is not in the inventory fails module load (fail closed),
// so a retired path can never silently re-enter an allowlist.
//
// Rate-limit classification itself is one decision table in
// `rate-policy.ts`; this file only pins the identity-class tables in the
// routing policy.

const inventoryPaths = new Set(AGENT_PATHS.map((entry) => entry.path));

function assertEveryEntryInInventory(paths: readonly string[], table: string): void {
  for (const path of paths) {
    assert.equal(
      inventoryPaths.has(path),
      true,
      `${table} entry "${path}" is not in the AGENT_PATHS inventory — delete the route or update the table`,
    );
  }
}

void test("every PUBLIC_V1 table entry exists in the AGENT_PATHS inventory", () => {
  assertEveryEntryInInventory(PUBLIC_V1_PATHS, "PUBLIC_V1");
});

void test("every ANON_V1 table entry exists in the AGENT_PATHS inventory", () => {
  assertEveryEntryInInventory(ANON_V1_PATHS, "ANON_V1");
});

void test("retired /v1/runtime paths match no inventory and classify as unmanaged", () => {
  assert.equal(inventoryPaths.has("/v1/runtime"), false);
  assert.equal(inventoryPaths.has("/v1/runtime/stream"), false);
  assert.equal(classifyRatePolicy("POST", "/v1/runtime").limiter, "none", "a retired path must not be classified into a guarded cell");
  assert.equal(classifyRatePolicy("POST", "/v1/runtime/stream").limiter, "none");
});

void test("the guide route pattern derives from the inventory's parameter template", () => {
  assert.equal(isPublicV1("/v1/bangumi/485/guide"), true);
  assert.equal(isPublicV1("/v1/bangumi/guide"), false, "the parameter segment is required");
  assert.equal(isPublicV1("/v1/bangumi/485/guide/"), false, "trailing slash must not extend the template");
  assert.equal(isPublicV1("/v1/bangumi/485/guide/extra"), false, "an anchored template must not prefix-match");
});

void test("anonymous allowlist membership matches the inventory's paths", () => {
  assert.equal(isAnonymousV1("/v1/chat"), true);
  assert.equal(isAnonymousV1("/v1/photo-search"), true);
  assert.equal(isAnonymousV1("/v1/photo-search/confirm"), true);
  assert.equal(isAnonymousV1("/v1/feedback"), false);
});

void test("the retired staging prefix route remains outside public allowlists", () => {
  assert.equal(inventoryPaths.has("/v1/staging/sessions/{session_id}/prefix"), false);
  assert.equal(isPublicV1("/v1/staging/sessions/s-1/prefix"), false);
  assert.equal(isAnonymousV1("/v1/staging/sessions/s-1/prefix"), false);
  assert.equal(classifyRatePolicy("POST", "/v1/staging/sessions/s-1/prefix").limiter, "none");
});
