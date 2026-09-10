import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";
import { createWorkerApp } from "../src/app.ts";
import { nativeAgentReceiver, type NativeAgentCall } from "./doubles/native-agent-receiver.ts";
import { alwaysAllowGuard, envWithContainer, stubCtx } from "../src/container/entry-env.ts";
import { USERS_BINDING_PREFIX } from "@animichi/contract/internal-binding";

// Issue #1005 AC1: every operation advertised by a generated OpenAPI document
// must be reachable through the edge's service binding route. The edge is the
// gateway — an advertised operation the edge 404s is a phantom surface. This
// test drives the real gateway (createWorkerApp) for every operation in the
// committed generated documents and asserts the request reaches the intended
// binding (CONTAINER for Agent, USERS for the Users service).

const PACKAGE_DIR = fileURLToPath(new URL("../../../packages/contract", import.meta.url));
const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

interface AdvertisedOperation {
  readonly method: string;
  readonly path: string;
}

function readDocument(filename: string): {
  paths: Record<string, Record<string, unknown>>;
} {
  return JSON.parse(readFileSync(`${PACKAGE_DIR}/${filename}`, "utf8")) as {
    paths: Record<string, Record<string, unknown>>;
  };
}

function operations(document: { paths: Record<string, Record<string, unknown>> }): AdvertisedOperation[] {
  const result: AdvertisedOperation[] = [];
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of Object.keys(item).filter((key) => HTTP_METHODS.has(key))) {
      result.push({ method: method.toUpperCase(), path });
    }
  }
  return result;
}

/** Substitute every `{param}` segment with a concrete value. */
function concretePath(path: string): string {
  return path.replace(/\{[^}]+\}/g, "test");
}

const authed = () => Promise.resolve({ ok: true, userId: "u1", userType: "human" } as const);

/** Minimal CONTAINER binding: any request gets the same stub response. */
function containerStub() {
  return {
    idFromName: () => "id",
    get: () => ({ fetch: () => Promise.resolve(new Response("container")) }),
  };
}

function usersEnv(users: { fetch(req: Request): Promise<Response> }) {
  return {
    EDGE_SHOWCASE_MODE: "false",
    EDGE_GUARD: alwaysAllowGuard,
    CONTAINER: containerStub(),
    USERS: users,
  } as never;
}

/** A USERS binding that records whether a request reached it. */
function usersBinding(reached: { value: boolean }) {
  return {
    fetch: () => {
      reached.value = true;
      return Promise.resolve(new Response("users"));
    },
  };
}

async function assertAgentOperationReachable(operation: AdvertisedOperation): Promise<void> {
  const captured: { req?: Request } = {};
  const calls: NativeAgentCall[] = [];
  const app = createWorkerApp({ authenticate: authed, agentTurns: nativeAgentReceiver(calls) });
  const res = await app.request(concretePath(operation.path), { method: operation.method }, envWithContainer(captured), stubCtx);
  assert.equal(res.status !== 404, true, `${operation.method} ${operation.path} must not 404`);
  assert.equal(Number(captured.req !== undefined) + calls.length, 1, `${operation.method} ${operation.path} must reach exactly one agent receiver`);
}

async function assertUsersOperationReachable(operation: AdvertisedOperation): Promise<void> {
  assert.equal(operation.path.startsWith(USERS_BINDING_PREFIX), true);
  const reached = { value: false };
  const app = createWorkerApp({ authenticate: authed });
  const env = usersEnv(usersBinding(reached));
  const res = await app.request(concretePath(operation.path), { method: operation.method }, env, stubCtx);
  assert.equal(res.status !== 404, true, `${operation.method} ${operation.path} must not 404`);
  assert.equal(reached.value, true, `${operation.method} ${operation.path} must reach the USERS binding`);
}

void test("every Agent OpenAPI operation reaches its gateway receiver", async () => {
  const agentOps = operations(readDocument("agent-openapi.json"));
  assert.ok(agentOps.length > 0, "agent-openapi.json must advertise operations");
  for (const operation of agentOps) {
    await assertAgentOperationReachable(operation);
  }
});

void test("every Users OpenAPI operation is reachable through the USERS binding", async () => {
  const usersOps = operations(readDocument("users-openapi.json"));
  assert.ok(usersOps.length > 0, "users-openapi.json must advertise operations");
  for (const operation of usersOps) {
    await assertUsersOperationReachable(operation);
  }
});
