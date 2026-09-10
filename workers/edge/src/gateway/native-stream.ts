import postgres from "@prisma/orm-postgres/runtime";
import contractJson from "@animichi/pi-session-neon/contract" with { type: "json" };
import type { Contract } from "@animichi/pi-session-neon/types";
import { NeonStorage } from "@animichi/pi-session-neon";
import { laneState, operationMeta, operationResult } from "@earendil-works/pi-agent-core/harness/session";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import type { Env } from "../env.ts";
import { ownsConversation } from "../agent/admission/session-owner.ts";
import { conversationNotFound } from "./agent-turn-responses.ts";

/** Authorize and discover existing native work before waking its host. This route never admits work. */
export async function nativeStreamResponse(env: Env, request: Request, identityId: string, sessionId: string): Promise<Response> {
  const requested = new URL(request.url).searchParams.get("operation_id");
  if (!validStreamLookup(sessionId, requested)) return conversationNotFound();
  const binding = env.AGENT_SVC_DATABASE_URL;
  const url = typeof binding === "string" ? binding : await binding?.get();
  if (!url) throw new Error("The native agent database is not configured");
  const db = postgres<Contract>({ contractJson, url });
  let operationId: string;
  try {
    if (!await ownsConversation(db, sessionId, identityId)) return conversationNotFound();
    const storage = new NeonStorage(db, { sessionId });
    const selected = requested ?? await latestOperation(storage);
    if (!selected) return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    if (!await nativeOperationExists(storage, selected)) return conversationNotFound();
    operationId = selected;
  } finally { await db.close(); }
  if (!env.AGENT_SESSION) throw new Error("The native SessionAgent namespace is not bound");
  const { sessionAgentStub } = await import("../agent/host/session-agent-stub.ts");
  return (await sessionAgentStub(env.AGENT_SESSION, sessionId)).watchChat(identityId, operationId);
}

function validStreamLookup(sessionId: string, requested: string | null) {
  return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(sessionId)
    && (requested === null || (requested.length > 0 && requested.length <= 200));
}

async function latestOperation(storage: NeonStorage) {
  const state = (await storage.getValue(laneState("main"), BACKGROUND_CONTEXT))?.value;
  return state?.currentOperationId ?? state?.lastOperationId;
}

async function nativeOperationExists(storage: NeonStorage, id: string) {
  const meta = (await storage.getValue(operationMeta(id), BACKGROUND_CONTEXT))?.value;
  const result = (await storage.getValue(operationResult(id), BACKGROUND_CONTEXT))?.value;
  return meta?.lane === "main" || result !== undefined;
}
