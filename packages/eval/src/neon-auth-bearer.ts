/**
 * Where the staging access token comes from (`docs/ops/auth-migration-neon.md`
 * §4, Path A — the CI default, no inbox involved).
 *
 * Two steps, and the order is the whole recipe: `POST /sign-in/email` answers
 * with an HttpOnly SESSION COOKIE, and `GET /token` exchanges that cookie for
 * the EdDSA JWT the edge verifies. The JSON `token` the first call returns is an
 * opaque session token — presenting it as a bearer to `/token` is a 401, because
 * the bearer plugin is off. Getting that backwards costs an afternoon, so it is
 * written down here rather than rediscovered.
 *
 * This is NOT a second door onto staging. Neon Auth is a different origin behind
 * no Access application: it takes no service token, and `CATALOG_API_ORIGIN` is never
 * read here. What it does share with the door is the refusal that matters — a
 * password and a JWT both cross this wire, so a non-HTTPS base URL is refused
 * before either is sent.
 */
import assert from "node:assert/strict";

import type { MintBearer } from "./staging-bearer.ts";

/** Better Auth rejects an origin-less POST; `allow_localhost` is on, and this is
 * the origin the operator recipe and the Playwright suite both send. */
const SIGN_IN_ORIGIN = "http://localhost:3000";

/** The QA identity an eval run signs in as. */
export interface QaSignIn {
  readonly baseUrl: string;
  readonly email: string;
  readonly password: string;
}

/** One request, however it is made. Injected so the mint is testable. */
export type SendRequest = (url: string, init?: RequestInit) => Promise<Response>;

/** The credentials, or a failed assertion naming the variable that is missing —
 * the same fail-closed rule `lane-origin.ts` applies to its three. */
export function qaSignInFrom(environment: Readonly<Record<string, string | undefined>>): QaSignIn {
  const baseUrl = environment.NEON_AUTH_BASE_URL;
  const email = environment.QA_NEON_USER_EMAIL;
  const password = environment.QA_NEON_USER_PASSWORD;
  assert.ok(baseUrl, "set NEON_AUTH_BASE_URL (docs/ops/auth-migration-neon.md §4)");
  assert.ok(email, "set QA_NEON_USER_EMAIL");
  assert.ok(password, "set QA_NEON_USER_PASSWORD");
  assert.equal(new URL(baseUrl).protocol, "https:", "NEON_AUTH_BASE_URL must be https — a password crosses it");
  return { baseUrl: baseUrl.replace(/\/$/, ""), email, password };
}

/** The `name=value` pairs of every cookie the sign-in set, as one header. */
function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");
}

async function signedIn(signIn: QaSignIn, send: SendRequest): Promise<string> {
  const response = await send(`${signIn.baseUrl}/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: SIGN_IN_ORIGIN },
    body: JSON.stringify({ email: signIn.email, password: signIn.password }),
  });
  assert.ok(response.ok, `Neon Auth refused the QA sign-in with ${String(response.status)}`);
  return cookieHeader(response);
}

async function exchanged(signIn: QaSignIn, cookie: string, send: SendRequest): Promise<string> {
  const response = await send(`${signIn.baseUrl}/token`, {
    headers: { Cookie: cookie, Origin: SIGN_IN_ORIGIN },
  });
  assert.ok(response.ok, `Neon Auth refused the token exchange with ${String(response.status)}`);
  const payload = (await response.json()) as { token?: unknown };
  assert.equal(typeof payload.token, "string", "the token exchange answered without a token");
  return payload.token as string;
}

/** One sign-in and one exchange, producing one fresh access token. */
export function neonAuthBearer(signIn: QaSignIn, send: SendRequest): MintBearer {
  return async () => exchanged(signIn, await signedIn(signIn, send), send);
}
