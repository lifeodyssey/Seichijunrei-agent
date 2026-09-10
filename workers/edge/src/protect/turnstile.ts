/// <reference types="@cloudflare/workers-types" />

import { TURNSTILE_HEADER, TURNSTILE_WINDOW_MS } from "@animichi/contract/constants";

import { readStoreOrString } from "../container/container-env.ts";

export { TURNSTILE_HEADER, TURNSTILE_WINDOW_MS };

/**
 * Cloudflare Turnstile edge gate (S1.9 / issue #281).
 *
 * Verification is ALWAYS server-side: the browser only collects a token, the
 * Worker exchanges it at siteverify with the secret binding. The secret lives
 * in `env.TURNSTILE_SECRET` (a Secrets Store binding in deployed environments) — there is no
 * `process.env` in Workers, so never reach for it here.
 */

/** Cloudflare's canonical server-side verification endpoint. */
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * How long one successful verification keeps covering follow-up turns.
 * Turnstile tokens are single-use at siteverify (a replay returns
 * `timeout-or-duplicate`), so caching the pass is exactly what stops an
 * anonymous user from being re-challenged on every message.
 *
 * The cache is keyed by token AND identity (issue #447 review): keying it by
 * token alone would let one solved challenge cover ANY identity for its whole
 * window, so an attacker could drop the `aid` cookie (fresh identity, fresh
 * rate-limit bucket) and replay the same token — turning the attack this gate
 * exists to stop into one that merely costs a challenge every few minutes.
 * Keyed by identity, a cookie-dropper misses the cache, siteverify sees the
 * replay, answers `timeout-or-duplicate`, and the turn is rejected.
 */
export interface TurnstileResult {
  readonly ok: boolean;
  readonly errorCodes: readonly string[];
}

export interface TurnstileEnv {
  readonly TURNSTILE_SECRET: SecretsStoreSecret | string;
}

export interface TurnstileGate {
  readonly check: (
    token: string | null,
    clientIp: string,
    secret: string,
    identity: string,
  ) => Promise<TurnstileResult>;
}

const MISSING_TOKEN: TurnstileResult = { ok: false, errorCodes: ["missing-input-response"] };
const WINDOW_PASS: TurnstileResult = { ok: true, errorCodes: [] };
const BAD_RESPONSE: TurnstileResult = { ok: false, errorCodes: ["bad-siteverify-response"] };

/** How long siteverify gets before the call is abandoned. Verification sits in
 * front of every anonymous turn, so it must never hang one. */
const SITEVERIFY_TIMEOUT_MS = 5_000;

/** Verification outages fail closed: an unverified browser never enters chat.
 * The verdict is not cached, so the same gate can be retried immediately. */
const SITEVERIFY_UNAVAILABLE: TurnstileResult = { ok: false, errorCodes: ["siteverify-unavailable"] };

/** Structured, credential-free record of a verification outage. */
function logSiteverifyUnavailable(reason: string): void {
  console.error(JSON.stringify({ event: "edge_turnstile_siteverify_unavailable", reason }));
}

function stringsOf(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const items: readonly unknown[] = value;
  return items.filter((item): item is string => typeof item === "string");
}

/** Narrow the siteverify JSON at the trust boundary — never trust its shape. */
function readSiteverify(body: unknown): TurnstileResult {
  if (typeof body !== "object" || body === null) return BAD_RESPONSE;
  const record = body as Record<string, unknown>;
  return { ok: record.success === true, errorCodes: stringsOf(record["error-codes"]) };
}

function siteverifyRequest(token: string, clientIp: string, secret: string): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret, response: token, remoteip: clientIp }),
    signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
  };
}

async function siteverifyResult(
  token: string, clientIp: string, secret: string, fetchImpl: typeof fetch,
): Promise<TurnstileResult> {
  const response = await fetchImpl(SITEVERIFY_URL, siteverifyRequest(token, clientIp, secret));
  const body: unknown = await response.json();
  return readSiteverify(body);
}

/**
 * The canonical siteverify call. Pure apart from the injected `fetchImpl`.
 * Everything that can throw — the fetch itself, the timeout, a body that is not
 * JSON — resolves to a retryable fail-closed verdict instead of a bare 500.
 */
export async function verifySiteverify(
  token: string, clientIp: string, secret: string, fetchImpl: typeof fetch,
): Promise<TurnstileResult> {
  try {
    return await siteverifyResult(token, clientIp, secret, fetchImpl);
  } catch {
    logSiteverifyUnavailable("unreachable");
    return SITEVERIFY_UNAVAILABLE;
  }
}

export interface TurnstileGateOptions {
  readonly now?: () => number;
  readonly windowMs?: number;
  readonly verify?: typeof verifySiteverify;
  readonly fetchImpl?: typeof fetch;
}

interface GateState {
  readonly passed: Map<string, number>;
  readonly now: () => number;
  readonly windowMs: number;
  readonly verify: typeof verifySiteverify;
  readonly fetchImpl: typeof fetch;
}

function toState(options: TurnstileGateOptions): GateState {
  return {
    passed: new Map<string, number>(),
    now: options.now ?? (() => Date.now()),
    windowMs: options.windowMs ?? TURNSTILE_WINDOW_MS,
    verify: options.verify ?? verifySiteverify,
    fetchImpl: options.fetchImpl ?? ((input, init) => fetch(input, init)),
  };
}

/** One cache entry per (identity, token) pair — never per token alone. */
function windowKey(identity: string, token: string): string {
  return `${identity}\n${token}`;
}

/** True when this identity already passed this token inside the open window. */
function isWithinWindow(state: GateState, key: string): boolean {
  const expiresAt = state.passed.get(key);
  return expiresAt !== undefined && expiresAt > state.now();
}

/** Drop expired entries so the window map stays bounded. */
function prune(state: GateState): void {
  const now = state.now();
  for (const [token, expiresAt] of state.passed) {
    if (expiresAt <= now) state.passed.delete(token);
  }
}

/** Only a real siteverify pass earns a window slot. */
function isVerifiedPass(result: TurnstileResult): boolean {
  return result.ok && result.errorCodes.length === 0;
}

async function verifyAndCache(
  state: GateState, token: string, clientIp: string, secret: string, key: string,
): Promise<TurnstileResult> {
  const result = await state.verify(token, clientIp, secret, state.fetchImpl);
  if (isVerifiedPass(result)) state.passed.set(key, state.now() + state.windowMs);
  return result;
}

async function checkToken(
  state: GateState, token: string | null, clientIp: string, secret: string, identity: string,
): Promise<TurnstileResult> {
  if (token === null || token === "") return MISSING_TOKEN;
  const key = windowKey(identity, token);
  if (isWithinWindow(state, key)) return WINDOW_PASS;
  prune(state);
  return verifyAndCache(state, token, clientIp, secret, key);
}

/** Build a gate with its own short-lived verification window. */
export function createTurnstileGate(options: TurnstileGateOptions = {}): TurnstileGate {
  const state = toState(options);
  return {
    check: (token, clientIp, secret, identity) =>
      checkToken(state, token, clientIp, secret, identity),
  };
}

/**
 * The rejection envelope. `retryable` tells the client to re-render the widget
 * and resend rather than treating this as a dead end. Siteverify error codes
 * are deliberately NOT echoed — they would disclose edge configuration state.
 */
function rejection(): Response {
  return Response.json(
    { error: { code: "turnstile_required", message: "Turnstile verification required.", retryable: true } },
    { status: 403 },
  );
}

/** Wire-level marker for an environment that opened anonymous access without
 * provisioning the secret: every anonymous turn is then rejected, which would
 * otherwise look exactly like a bot wave. Callers still get a plain 403 — the
 * record is edge-internal and names no token, identity or secret. */
function logMissingSecret(): void {
  console.error(JSON.stringify({ event: "edge_turnstile_secret_missing" }));
}

async function turnstileSecret(env: TurnstileEnv): Promise<string | null> {
  const secret = await readStoreOrString(env.TURNSTILE_SECRET) ?? null;
  if (secret === null) logMissingSecret();
  return secret;
}

/**
 * Edge guard. Returns `null` when the caller may proceed to forward the
 * request, or a 403 Response the caller MUST return without ever touching the
 * container. `identity` scopes the pass window — see TURNSTILE_WINDOW_MS.
 */
export async function guardTurnstile(
  request: Request, env: TurnstileEnv, gate: TurnstileGate, identity: string,
): Promise<Response | null> {
  const secret = await turnstileSecret(env);
  if (secret === null) return rejection();
  const token = request.headers.get(TURNSTILE_HEADER);
  const clientIp = request.headers.get("CF-Connecting-IP") ?? "";
  const result = await gate.check(token, clientIp, secret, identity);
  return result.ok ? null : rejection();
}
