# `api-test/` — the agent tier's staging lane (W1-4 #1253, unblocked by W1-7 #1256)

Opt-in, never in CI, never in a deploy unit. Four suites, one per question, over one
shared door — `lane-origin.ts`, which resolves `CATALOG_API_ORIGIN`,
`AGENT_TURN_BEARER` and the Cloudflare Access service token
(`CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`) for all of them, requires HTTPS of every
non-loopback origin before a credential is sent, and makes every request itself
(`laneFetch`) so neither the Access headers nor the no-redirect rule can be forgotten by
one call site. `http://localhost` and `http://127.0.0.1` are the one exception —
plaintext is fine on the loopback, there is no wire to intercept, and a local
`wrangler dev` is sent NO Access credential because it is behind no door. No
lane reads those variables or calls `fetch` for itself; `test/web-search-lane.test.ts`
fails if one starts to.

- `catalog-api.test.ts` — the catalog has no public door (spec Appendix D).
- `agent-turn.test.ts` — one real turn through the deployed edge actually calls a
  catalog tool, and the turn is readable back by conversation id. This is the
  **(api)** evidence #1253 had to defer.
- `web-search-turn.test.ts` — one real turn calls `web_search`, and what came
  back is wrapped in the untrusted preamble (W2-1 #1287). This is the only
  question the unit suite cannot answer: whether Cloudflare's egress reaches
  `html.duckduckgo.com`, and whether that endpoint answers a Worker the way it
  answered the laptop the adapter was measured on. A `tool-output-available`
  whose text starts with the preamble means the hop worked.

  A `Search failed for '<query>': <detail>` sentence means the search did not
  complete, and that is ALL it means on its own — the tool degrades every one of
  its failures into that one sentence rather than throwing. The `<detail>` is
  what tells them apart, and each spelling has a different fix:

  | `<detail>` | what happened | what to do |
  |---|---|---|
  | `egress denied: host_not_allowlisted` (or another `EgressDenyReason`) | our own guard refused the destination — typically a redirect off `html.duckduckgo.com` | read `web-search-egress.ts`; a legitimate new host is a reviewed allowlist edit, never a widened rule |
  | `search backend answered 202` | the anti-bot answer: DuckDuckGo served the Worker a challenge instead of results | the backend refused THIS caller; a keyed API behind the same `WebSearcher` port is the fix |
  | `search backend answered 429` / `5xx` | rate limited or upstream trouble, not a refusal of Workers as such | re-run the lane before concluding anything |
  | `the search timed out` | the 10s budget elapsed | check whether the hop is slow or hung; re-run before concluding |

  Anything else in `<detail>` came from the runtime (a DNS or TLS failure, say),
  which means the request never reached the backend at all. Every one of these
  is also on the server side as a `web_search_failed` entry in Workers Logs,
  with the same text — so a turn nobody was watching can still be diagnosed.

- `byok-probe.test.ts` — `POST /v1/byok/probe` answers the documented rejection
  for a deliberately invalid key, refuses a metadata-address base URL, and stays
  behind the login wall (W2-3 #1289). Every credential it sends is a zero-entropy
  fixture; the valid-key case — the one that answers `vision: true` — is the
  owner's manual step, because it needs a key that must not be written down.

```sh
CATALOG_API_ORIGIN=https://staging.animichi.com \
AGENT_TURN_BEARER="$(cat ~/.animichi/staging-access-token)" \
CF_ACCESS_CLIENT_ID="$(esc env open lifeodyssey/animichi/staging environmentVariables.CF_ACCESS_CLIENT_ID --format string)" \
CF_ACCESS_CLIENT_SECRET="$(esc env open lifeodyssey/animichi/staging environmentVariables.CF_ACCESS_CLIENT_SECRET --format string)" \
pnpm --filter edge-worker run test:catalog-api
```

Every variable fails closed: without `CATALOG_API_ORIGIN` the lane refuses to
guess an origin, without `AGENT_TURN_BEARER` the turn cases refuse to run, and with
exactly ONE of the two Access variables it refuses before building a request. The
two Access variables are the only ones that may be absent together — that is every
run against a target with no Access application in front of it, the loopback
included.

Run it only after a deploy that carries `AGENT_TURN_ROUTE = "edge"` — against
the container the turn is answered by `apps/agent`, which emits no
`x-session-id` header and the first assertion fails.

## The Cloudflare Access service token (D3 #1369)

Staging is behind Cloudflare Access. Humans sign in; automation gets in with a
**service token**: two request headers, `CF-Access-Client-Id` and `CF-Access-Client-Secret`,
which `lane-origin.ts` attaches to every non-loopback request. The values are a
Pulumi stack output
(`infra/src/staging-access.ts`), carried into the ESC environment
`lifeodyssey/animichi/staging` by the `pulumi-stacks` provider; read them with the
`esc env open` lines in the recipe above and never write them to a file in this repo.
It is `open`, not `get`, on purpose: `get` prints the environment's *definition* —
for these two keys that is the `pulumi-stacks` import expression, and for a static
secret it is ciphertext unless `--show-secrets` is passed. `open` is what resolves a
provider, which is also what `pulumi/esc-action` does for CI. Use
`esc env get lifeodyssey/animichi/staging environmentVariables` when you only need to
confirm the two keys EXIST, which prints no value.

Both variables or neither. Access answers a request carrying one of the two headers
exactly as it answers one carrying neither — a 302 to the identity provider's login
page — so half a token arrives as an HTML login page where the lane expected JSON,
and reads as a broken app. `@animichi/contract/access-service-token` refuses that
case by name before the request is built. Leaving both unset is the ordinary state
for any origin with no Access application in front of it.

Two rules follow from carrying a real credential, and both live in `lane-origin.ts`
rather than in any lane: a non-loopback origin must be HTTPS (the service token and
the Neon Auth bearer both ride these requests, and neither belongs on a plaintext
wire), and no request may follow a redirect — `fetch` replays headers on a 30x, so a
redirect would hand both credentials to whatever origin the `Location` named. Access
makes that load-bearing rather than defensive: a 302 to the identity provider is
exactly what an unauthenticated request gets, so it is the redirect these lanes are
most likely to meet. There is no legitimate redirect on any of these routes, so
`laneFetch` sets `redirect: "error"` and a 30x fails the lane loudly.

**A login page is the door, not the app.** If `/healthz` answers a 302 to
`*.cloudflareaccess.com`, or returns Cloudflare's own HTML, the request did not
reach our Worker: the token is missing, half-declared, or rotated out from under
this shell. It is not a broken deploy, and every assertion downstream of it fails
for that same unrelated reason — which is why the lane refuses to start on half a
token rather than let you read a login page as a bug.

The `x-staging-key` WAF gate this section used to describe was deleted with D3
(#1369), along with `STAGING_GATE_TOKEN` and `scripts/setup-staging-gate.sh`. A WAF
rule could only ever see hostnames on the zone, so the `*.workers.dev` origins CD
smoke-tests were never behind it (#539).

## Why the turn is signed in, and the anonymous path is not here

The anonymous door is behind Turnstile, and Turnstile is a challenge a headless
client cannot solve — that is the whole point of it. So this lane presents a
Neon Auth access token (any real staging login; the browser's session token
works, and it is short-lived by design). The ANONYMOUS half of the W1 exit
criterion — "staging 匿名可完整对话；切走再回来拉到完整结果" — is a manual browser
journey instead: `docs/ops/w1-staging-journey.md`.

## Why the catalog procedures still cannot be called directly

They ride the private `CATALOG` **service binding** (spec Appendix D: the
catalog is our own infrastructure, so it is never named by URL). A service
binding exists only as `env.CATALOG` inside a running Worker — there is no
hostname a laptop can send `POST /catalog/resolve` to.

The staging edge confirms it. Its bound routes are `/healthz`, `/img/*`,
`/tiles/*` and `/v1/*` (`infra/topology-staging.test.ts:41-44`); `/catalog/*` is
not among them, so `POST https://staging.animichi.com/catalog/resolve` is
answered by the web Worker's SPA 404, not by the catalog. Measured 2026-09-03.

What changed with #1256 is not that door — it is that the tools now RUN inside a
deployed Worker, so the hop is observable from its far side: the SD-9 frames
name the tool (`tool-input-start` carries `toolName`) and a
`tool-output-available` for the same `toolCallId` is the catalog having
answered. A `tool-output-error` instead means the binding hop failed, which is
exactly the failure this lane exists to catch.

## Running it behind a proxy

The script sets `NODE_USE_ENV_PROXY=1`. Cloudflare's WAF answers a direct
`fetch` from a laptop with a 403 challenge page, which would make the "no public
door" assertion vacuous — every path would be 403. With the proxy honoured the
staging origin answers `/healthz` 200 and every tool procedure exactly 404, so
the assertion is on the web Worker's real "no route here". The flag is inert
when no `HTTP_PROXY`/`HTTPS_PROXY` is set.
