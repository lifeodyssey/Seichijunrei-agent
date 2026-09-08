/**
 * The deployment a staging lane talks to, and the credential it presents.
 *
 * One door, deliberately. Every file in this directory sends a real request to
 * a real origin, and two of them send a real Neon Auth access token with it, so
 * the checks that decide WHERE that goes cannot live in each lane: three copies
 * are three places for one of them to be forgotten, and the copy that was
 * forgotten is the one an operator finds by leaking a token.
 *
 * Three refusals, all fail-closed:
 *   - an unset origin is never guessed. A lane with no origin has nothing to
 *     assert about, and a lane that invented `localhost` would pass vacuously.
 *   - a non-HTTPS origin is refused before anything is sent (CWE-319), off the
 *     loopback. The very next thing that happens is a bearer token going over
 *     that wire, and an operator who exported `CATALOG_API_ORIGIN=http://…` for
 *     a local experiment would otherwise put a staging credential on it in
 *     plaintext. The loopback exception is the same one `e2e/global-setup.ts`
 *     makes, and for the same reason: `wrangler dev` serves plaintext and there
 *     is no wire to intercept. The refusal is here rather than at the call sites
 *     for the same reason the module exists — `catalog-api.test.ts` carries no
 *     token today, but it is one edit away from carrying one.
 *   - a half-declared Cloudflare Access service token is refused before the
 *     request is built (D3 #1369). Access answers a request carrying one of the
 *     two headers exactly as it answers one carrying neither — a 302 to the
 *     login page — so half a token reads as a broken app in the same way the
 *     missing gate credential below does.
 *   - a missing staging gate credential is refused rather than sent anyway
 *     (#1294). Staging is behind a WAF rule that blocks every request without an
 *     allowlisted source IP, the gate cookie, or the `x-staging-key` header, so
 *     a lane that omits it gets a Cloudflare 403 block page for `/healthz` and
 *     every assertion below fails for a reason that has nothing to do with the
 *     code under test. It only ever passed because the operator's own IP
 *     happened to be allowlisted. Failing with the variable's NAME is the whole
 *     point: a 403 that looks like a broken app costs an afternoon.
 *
 * Not a `*.test.ts` file, so `pnpm run test:catalog-api`'s glob does not run it
 * as a suite; it is imported by the lanes that do.
 */
import assert from "node:assert/strict";

import {
  accessServiceTokenHeaders,
  isLoopbackHostname,
} from "@animichi/contract/access-service-token";

/** Read at CALL time, not at import time: a lane that resolved its
 * environment once at module load could not be driven through both its
 * loopback and its staging branch by a test, and a rule nobody can exercise is
 * a rule nobody can trust. */
function environment(): { origin?: string; bearer?: string; gate?: string } {
  return {
    origin: process.env.CATALOG_API_ORIGIN,
    bearer: process.env.AGENT_TURN_BEARER,
    gate: process.env.STAGING_GATE_TOKEN,
  };
}

/** The header form of the staging gate. The WAF accepts it or the cookie; a
 * header needs no cookie jar, which is the whole reason these lanes use it. */
const GATE_HEADER = "x-staging-key";

/** The loopback, the one origin that is not behind the staging gate.
 *
 * Delegates rather than spelling the hostnames again: this door checked
 * `localhost` and `127.0.0.1` only, so `https://[::1]` took the credentialed
 * staging path and was handed both the gate token and the Access service token
 * (PR #1498 review). The one list lives with the credential it protects. */
function isLoopback(url: URL): boolean {
  return isLoopbackHostname(url.hostname);
}

/** Where a lane may talk to, and what it must present to get in. */
interface LaneDestination {
  origin: string;
  /** The staging gate credential, or `null` for the loopback, which has no gate. */
  gate: string | null;
  /** The Cloudflare Access service token headers, empty when none is declared. */
  access: Readonly<Record<string, string>>;
}

/**
 * The destination, refused unless it is one these lanes may safely talk to.
 *
 * The loopback returns before the gate is even read, which is the point: a
 * local `wrangler dev` is not behind the WAF, so sending it the staging
 * credential would be handing a production-adjacent secret to whatever is
 * listening on a port. Every other origin must present one, and is refused
 * here rather than allowed to come back as a Cloudflare 403 nobody can read.
 */
function checkedDestination(): LaneDestination {
  const { origin, gate } = environment();
  assert.ok(origin, "set CATALOG_API_ORIGIN (see api-test/README.md); this lane never guesses");
  const url = new URL(origin);
  if (isLoopback(url)) return { origin, gate: null, access: {} };
  assert.equal(
    url.protocol,
    "https:",
    "CATALOG_API_ORIGIN must be https for any non-loopback origin — these lanes send real credentials",
  );
  assert.ok(
    gate,
    "set STAGING_GATE_TOKEN (the variable the e2e suite already uses; see api-test/README.md) — staging's WAF answers 403 to a request without it, and that 403 reads as a broken app",
  );
  // Read after the loopback returns, for the same reason the gate is: a local
  // `wrangler dev` is behind no Access application, and handing it staging's
  // service token would put a real credential on whatever is listening. The
  // reader refuses a HALF-declared token here rather than sending one header.
  return { origin, gate, access: accessServiceTokenHeaders(process.env) };
}

/** The staging origin, without its trailing slash, or a failed assertion. */
export function laneOrigin(): string {
  return checkedDestination().origin.replace(/\/$/, "");
}

/** The Neon Auth access token a signed-in lane presents, or a failed assertion. */
export function laneBearer(): string {
  const { bearer } = environment();
  assert.ok(bearer, "set AGENT_TURN_BEARER to a Neon Auth access token (see api-test/README.md)");
  return bearer;
}

/**
 * One request's headers: whatever the call itself needs, plus the gate.
 *
 * The gate header and the Cloudflare Access service token are added last and
 * cannot be overridden by a caller: a lane has no reason to send a different one
 * and every reason to send these. `checkedDestination` decides whether there ARE
 * any — `null` and `{}` for the loopback, which is behind neither door and must
 * not be handed either credential — so this function has no policy of its own to
 * get wrong.
 */
export function laneHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  const { gate, access } = checkedDestination();
  if (gate !== null) headers.set(GATE_HEADER, gate);
  for (const [name, value] of Object.entries(access)) headers.set(name, value);
  return headers;
}

/**
 * The only way a lane makes a request.
 *
 * A wrapper rather than a `laneHeaders()` a lane remembers to call, for the
 * reason #1291 gave the origin its own door: a check every caller must opt into
 * is a check the next caller forgets, and the request that forgot is the one
 * that comes back 403. Taking the PATH rather than a URL is what makes that
 * structural — a lane cannot reach staging without coming through here.
 *
 * `redirect: "error"` is set AFTER the spread, so no caller can opt out of it,
 * and it is not politeness: `fetch` replays request headers on a followed
 * redirect, so a 30x from staging — a WAF rule, a stray trailing slash, a
 * hostile response on a compromised hop — would carry `x-staging-key` AND the
 * Neon Auth bearer to whatever origin and scheme the `Location` named. There is
 * no legitimate redirect on any of these routes, so a redirect is a finding,
 * and a rejected promise says so where a followed one would say nothing. Once
 * staging is behind Cloudflare Access (D3 #1369 PR 2) the rule earns a second
 * job: an unauthenticated request is answered with a 302 to the identity
 * provider, and following it would carry the service token to that origin.
 */
export function laneFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${laneOrigin()}${path}`, {
    ...init,
    headers: laneHeaders(init.headers),
    redirect: "error",
  });
}
