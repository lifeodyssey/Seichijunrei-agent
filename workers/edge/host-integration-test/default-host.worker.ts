import { neonAgentTurnTier } from "../src/gateway/agent-turn.ts";
import type { Env } from "../src/env.ts";
export { SessionAgent as AgentSession } from "../src/agent/host/session-agent.ts";
const tier = neonAgentTurnTier();

/** Test boundary supplies an already verified gateway identity, never native resources or business handlers. */
export default { fetch(request: Request, env: Env) {
  const identity = { userId: String(env.TEST_IDENTITY), userType: String(env.TEST_USER_TYPE) };
  const sessionId = new URL(request.url).pathname.split("/")[3];
  if (request.method === "GET" && sessionId && new URL(request.url).pathname.endsWith("/stream")) return tier.stream(env, request, identity, sessionId);
  if (request.method === "GET" && sessionId) return tier.transcript(env, request, identity, sessionId);
  return tier.chat(env, request, identity);
} };
