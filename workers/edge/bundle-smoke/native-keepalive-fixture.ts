import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { Miniflare } from "miniflare";
import { bundleLikeWrangler, deployedRuntime } from "./wrangler-bundle.ts";

export interface Observation {
  deadlineId: string | null; deadlineTime: number; alarm: number | null;
  callbackCount: number; callbackDuringDrive: boolean; driveActive: boolean; completedStatus: string;
}

async function workspace(context: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "native-keepalive-"));
  const resources: { worker?: Miniflare } = {};
  context.after(async () => { try { await resources.worker?.dispose(); } finally { await rm(directory, { recursive: true, force: true }); } });
  return { directory, resources };
}

export async function nativeWorker(context: TestContext) {
  const { directory, resources } = await workspace(context);
  const outfile = join(directory, "worker.mjs");
  await bundleLikeWrangler(new URL("./native-keepalive.worker.ts", import.meta.url).pathname, outfile);
  const worker = new Miniflare({ modulesRoot: directory, modules: [{ type: "ESModule", path: outfile }],
    ...deployedRuntime(), durableObjects: { SESSION: { className: "KeepaliveProbe", useSQLite: true } } });
  resources.worker = worker;
  return worker;
}

/** Start consuming each returned body immediately, including the independently pending drive response. */
export async function request(worker: Miniflare, path: string) {
  const response = await worker.dispatchFetch(`https://probe.test${path}`);
  const body = await response.text();
  assert.equal(response.status, 200, body);
  return body;
}

export async function inspect(worker: Miniflare, path = "/inspect") {
  return JSON.parse(await request(worker, path)) as Observation;
}

export async function releaseAndRestore(worker: Miniflare, drive: Promise<string>) {
  try { await request(worker, "/release"); await drive; }
  finally { await request(worker, "/restore"); }
}
