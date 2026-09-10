import { nativeHistoryResponse } from "./native-history.ts";
import { nativeStreamResponse } from "./native-stream.ts";
import type { Env } from "../env.ts";
import { ByokRejection } from "../agent/byok/byok-credential.ts";
import { byokCredentialIn, byokSignalIn } from "../agent/byok/byok-headers.ts";
import { ByokProbe } from "../agent/byok/byok-probe.ts";
import { ChatEnvelopeError, requestLocale } from "./chat-envelope.ts";
import { byokHeadersRequired, byokProbed, byokRefused, byokRequiresLogin, envelopeRefused, turnResponse } from "./agent-turn-responses.ts";
import { submissionOf, type NativeSubmission } from "./native-submission.ts";
import { anonymousMessageAllowance } from "../agent/intake/anonymous-message-allowance.ts";
export { submissionOf, MESSAGE_MAX_CHARS } from "./native-submission.ts";

export interface TurnIdentity { readonly userId: string; readonly userType: string }
export interface AgentTurnTier {
  chat(env: Env, request: Request, identity: TurnIdentity): Promise<Response>;
  probe(request: Request, identity: TurnIdentity): Promise<Response>;
  transcript(env: Env, request: Request, identity: TurnIdentity, sessionId: string): Promise<Response>;
  stream(env: Env, request: Request, identity: TurnIdentity, sessionId: string): Promise<Response>;
}

function byokLoginRefusal(request: Request, identity: TurnIdentity) {
  return (identity.userType === "anonymous" || identity.userId.startsWith("anon_")) && byokSignalIn(request.headers) ? byokRequiresLogin() : null;
}

async function handOff(env: Env, input: NativeSubmission) {
  if (!env.AGENT_SESSION) throw new Error("The native SessionAgent namespace is not bound");
  const { sessionAgentStub } = await import("../agent/host/session-agent-stub.ts");
  const host = await sessionAgentStub(env.AGENT_SESSION, input.sessionId);
  const { byok, selection, ...request } = input;
  if (selection) return host.submitSelection({ ...request, selection });
  return host.submitChat(request, { anonymousAllowance: anonymousMessageAllowance(env.ANON_DAILY_MESSAGE_QUOTA), now: Date.now() }, byok);
}
async function chatResponse(env: Env, request: Request, identity: TurnIdentity) {
  const refusal = byokLoginRefusal(request, identity);
  if (refusal) return refusal;
  const submission = await submissionOf(request, identity, requestLocale(request.headers.get("x-locale")));
  return turnResponse(await handOff(env, submission), submission.sessionId);
}
async function probeResponse(probe: ByokProbe, request: Request, identity: TurnIdentity) {
  const refusal = byokLoginRefusal(request, identity);
  if (refusal) return refusal;
  const credential = byokCredentialIn(request.headers);
  return credential ? byokProbed(await probe.run(credential)) : byokHeadersRequired();
}
export function refusalFor(error: unknown): Response | null {
  if (error instanceof ByokRejection) return byokRefused(error);
  if (error instanceof ChatEnvelopeError) return envelopeRefused(error);
  return null;
}
async function refusable(work: () => Promise<Response>) {
  try { return await work(); }
  catch (error) { const refusal = refusalFor(error); if (refusal) return refusal; throw error; }
}

/** Native production entry; unsupported surfaces fail explicitly and never reach the old engine. */
export function neonAgentTurnTier(probe: ByokProbe = new ByokProbe()): AgentTurnTier {
  return { chat: (env, request, identity) => refusable(() => chatResponse(env, request, identity)),
    probe: (request, identity) => refusable(() => probeResponse(probe, request, identity)),
    transcript: (env, request, identity, sessionId) => nativeHistoryResponse(env, request, identity.userId, sessionId),
    stream: (env, request, identity, sessionId) => nativeStreamResponse(env, request, identity.userId, sessionId) };
}
