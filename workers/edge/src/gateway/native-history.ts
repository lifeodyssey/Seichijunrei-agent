import postgres from "@prisma/orm-postgres/runtime";
import contractJson from "@animichi/pi-session-neon/contract" with { type: "json" };
import type { Contract } from "@animichi/pi-session-neon/types";
import type { Env } from "../env.ts";
import { readNativeHistory } from "../agent/views/history.ts";

function pageIn(request: Request) {
  const params = new URL(request.url).searchParams;
  const limit = Number(params.get("limit") ?? 100);
  const offset = Number(params.get("offset") ?? 0);
  return Number.isInteger(limit) && limit >= 1 && limit <= 100 && Number.isInteger(offset) && offset >= 0 && offset <= 1000 ? { limit, offset } : null;
}

export async function nativeHistoryResponse(env: Env, request: Request, identityId: string, sessionId: string) {
  const page = pageIn(request);
  if (!page) return Response.json({ error: "Invalid pagination" }, { status: 422 });
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(sessionId)) return Response.json({ error: "Conversation not found." }, { status: 404 });
  const binding = env.AGENT_SVC_DATABASE_URL;
  const url = typeof binding === "string" ? binding : await binding?.get();
  if (!url) throw new Error("The native agent database is not configured");
  const db = postgres<Contract>({ contractJson, url });
  try {
    const result = await readNativeHistory(db, sessionId, identityId, page);
    return Response.json(result ?? { error: "Conversation not found." }, { status: result ? 200 : 404, headers: { "cache-control": "no-store" } });
  } finally { await db.close(); }
}
