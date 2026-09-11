import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { Miniflare } from "miniflare";
import { bundleLikeWrangler, deployedRuntime } from "../bundle-smoke/wrangler-bundle.ts";
import { dsn, IDENTITY } from "./postgres.ts";

/** Only the external model transport pauses; gateway, admission, watch and drive are production code. */
export async function reconnectWorker(context: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "native-reconnect-"));
  const outfile = join(directory, "worker.js");
  const entered = Promise.withResolvers<undefined>();
  const released = Promise.withResolvers<undefined>();
  const requests: Request[] = [];
  const resources: { worker?: Miniflare } = {};
  context.after(async () => { released.resolve(undefined); await resources.worker?.dispose(); await rm(directory, { recursive: true, force: true }); });
  await bundleLikeWrangler(new URL("./default-host.worker.ts", import.meta.url).pathname, outfile);
  const worker = resources.worker = new Miniflare({ modulesRoot: directory, modules: [{ type: "ESModule", path: outfile }], ...deployedRuntime(),
    bindings: { AGENT_SVC_DATABASE_URL: dsn, MIMO_API_KEY: "server-private-key", ANON_DAILY_MESSAGE_QUOTA: "2",
      TEST_IDENTITY: IDENTITY, TEST_USER_TYPE: "anonymous" },
    durableObjects: { AGENT_SESSION: { className: "AgentSession", useSQLite: true } },
    serviceBindings: { CATALOG: () => Promise.reject(new Error("This greeting must not call the catalog")) },
    outboundService: async (request: Request) => {
      requests.push(request.clone()); entered.resolve(undefined);
      await released.promise;
      return completion();
    } });
  await worker.ready;
  return { worker, entered: entered.promise, release: () => { released.resolve(undefined); }, requests };
}

function completion() {
  const delta = { tool_calls: [{ index: 0, id: "answer", type: "function", function: {
    name: "respond", arguments: JSON.stringify({ kind: "greeting", message: "Reconnected to the same native turn" }),
  } }] };
  const chunk = { id: "native", object: "chat.completion.chunk", created: 0, model: "mimo-v2.5",
    choices: [{ index: 0, delta, finish_reason: "tool_calls" }], usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 } };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
}
