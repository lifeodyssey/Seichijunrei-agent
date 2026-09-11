import type { AgentTurnTier, TurnIdentity } from "../../src/gateway/agent-turn.ts";

export interface NativeAgentCall {
  request: Request;
  identity: TurnIdentity;
  sessionId?: string;
}

/** Captures the authenticated gateway seam; it does not simulate a business admission writer. */
export function nativeAgentReceiver(calls: NativeAgentCall[] = [], response = () => new Response("agent")): AgentTurnTier {
  const receive = (request: Request, identity: TurnIdentity, sessionId?: string) => {
    calls.push({ request, identity, ...(sessionId === undefined ? {} : { sessionId }) });
    return Promise.resolve(response());
  };
  return { chat: (_env, request, identity) => receive(request, identity),
    probe: (request, identity) => receive(request, identity),
    transcript: (_env, request, identity, sessionId) => receive(request, identity, sessionId),
    stream: (_env, request, identity, sessionId) => receive(request, identity, sessionId) };
}
