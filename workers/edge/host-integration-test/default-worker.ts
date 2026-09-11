import { selectedItinerary } from "./seed-selection.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { Miniflare } from "miniflare";
import { bundleLikeWrangler, deployedRuntime } from "../bundle-smoke/wrangler-bundle.ts";
import { dsn, IDENTITY, SESSION } from "./postgres.ts";

export async function defaultWorker(context: TestContext, bindings: Record<string, string> = {}, network: { model?: (request: Request) => Response | Promise<Response>; catalog?: (request: Request) => Response | Promise<Response> } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "default-native-host-"));
  const outfile = join(directory, "worker.js");
  await bundleLikeWrangler(new URL("./default-host.worker.ts", import.meta.url).pathname, outfile);
  const requests: Request[] = [];
  const catalogRequests: Request[] = [];
  const options = { modulesRoot: directory, modules: [{ type: "ESModule" as const, path: outfile }], ...deployedRuntime(), bindings: { AGENT_SVC_DATABASE_URL: dsn, MIMO_API_KEY: "server-private-key", ANON_DAILY_MESSAGE_QUOTA: "2",
      TEST_IDENTITY: IDENTITY, TEST_USER_TYPE: "anonymous", ...bindings }, durableObjectsPersist: join(directory, "state"),
    durableObjects: { AGENT_SESSION: { className: "AgentSession", useSQLite: true } },
    serviceBindings: { CATALOG: (request: Request) => { catalogRequests.push(request.clone()); return network.catalog?.(request) ?? Promise.resolve(Response.json(selectedItinerary)); } },
    outboundService: (request: Request) => { requests.push(request.clone()); return network.model?.(request) ?? respondCompletion(); } };
  let worker = new Miniflare(options);
  context.after(async () => { await worker.dispose(); await rm(directory, { recursive: true, force: true }); });
  await worker.ready;
  return { worker, requests, catalogRequests, restart: async () => { await worker.dispose(); worker = new Miniflare(options); await worker.ready; return worker; } };
}

function respondCompletion() {
  const delta = { tool_calls: [{ index: 0, id: "answer", type: "function", function: { name: "respond", arguments: JSON.stringify({ kind: "greeting", message: "Hello from the native host" }) } }] };
  const chunk = { id: "native", object: "chat.completion.chunk", created: 0, model: "mimo-v2.5", choices: [{ index: 0, delta, finish_reason: "tool_calls" }], usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 } };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
}

export const chatHeaders = { "content-type": "application/json", "x-session-id": SESSION, "x-turn-id": "native-first" };
export const chatBody = JSON.stringify({ messages: [{ id: "user", role: "user", parts: [{ type: "text", text: "Hello" }] }] });
