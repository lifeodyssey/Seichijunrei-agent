import type { AgentHarnessToolInvocation } from "@earendil-works/pi-agent-core";
import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import type { Session } from "@earendil-works/pi-agent-core/harness/session";
import type { Api, Model, Models } from "@earendil-works/pi-ai";
import type { LatLng } from "@animichi/contract";
import type { createCatalogClient } from "./catalog-client.ts";

/** The host supplies current identity and an invocation-keyed business quota transaction. */
export interface PilgrimageToolContext {
  session: Session;
  branch: string;
  locale: string;
  origin?: LatLng;
  catalog: ReturnType<typeof createCatalogClient>;
  webFetch?: typeof globalThis.fetch;
  translation?: { models: Models; model: Model<Api>; payer: "platform" | "byok" };
  assertAuthorized(operationId: string, context: Context): Promise<void>;
  reserveToolUsage(invocationId: string, context: Context, operationId: string): Promise<void>;
}

/** Run on every execute, including safe replay; the host must make quota reservation idempotent. */
export async function authorizeInvocation(tools: PilgrimageToolContext, invocation: AgentHarnessToolInvocation, context: Context) {
  context.abortSignal?.throwIfAborted();
  await tools.assertAuthorized(invocation.operationId, context);
  await tools.reserveToolUsage(invocation.invocationId, context, invocation.operationId);
  context.abortSignal?.throwIfAborted();
}
