import type { Env } from "../env.ts";
import type { TurnstileGate } from "../protect/turnstile.ts";
import { guardTurnstile } from "../protect/turnstile.ts";
import { credentialsRequired } from "../gateway/responses.ts";
import { resolveAnonymous } from "./auth.ts";
import { issueTurnstilePass } from "./turnstile-pass.ts";
import { readStoreOrString } from "../container/container-env.ts";

function verifiedResponse(setCookie: string | null, passCookie: string): Response {
  const headers = new Headers();
  if (setCookie !== null) headers.append("Set-Cookie", setCookie);
  headers.append("Set-Cookie", passCookie);
  return new Response(null, { status: 204, headers });
}

/** Verify and establish the stable anonymous identity used by the first turn. */
export async function verifyAnonymousEntry(
  env: Env, request: Request, gate: TurnstileGate,
): Promise<Response> {
  const identity = await resolveAnonymous(request, env);
  if (identity === null) return credentialsRequired();
  const challenged = await guardTurnstile(request, env, gate, identity.userId);
  if (challenged !== null) return challenged;
  const secret = await readStoreOrString(env.ANON_ID_SECRET);
  if (secret === undefined) return credentialsRequired();
  return verifiedResponse(identity.setCookie, await issueTurnstilePass(identity.userId, secret, Date.now()));
}
