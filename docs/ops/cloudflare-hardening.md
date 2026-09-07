# Cloudflare Hardening Runbook

## Scope

This runbook captures Cloudflare dashboard changes that are intentionally not stored in Git:

- `/v1/*` WAF and rate-limit controls
- coarse prompt-injection edge filtering
- rollback procedure for over-blocking rules
- the future AI Gateway insertion point

For the full deployment topology, auth flow, and env-var boundaries see `deployment.md` in this directory.

## Request Flow

```text
Browser / API client
  │
  ▼
Cloudflare Edge (Worker: workers/edge/src/entry.ts)
  ├─ page HTML ──────────────────────────────────▶ apps/web Worker (TanStack Start; not this Worker)
  ├─ /img/* ─────────────────────────────────────▶ Worker image proxy → Anitabi CDN (cached)
  ├─ /tiles/* ───────────────────────────────────▶ private R2 tile proxy
  ├─ /healthz ───────────────────────────────────▶ RuntimeContainer (no auth)
  ├─ /v1/users/* ────────────────────────────────▶ USERS service binding
  └─ /v1/* ── authenticate ── strip Authorization
       │        inject X-User-Id, X-User-Type
       ▼
     RuntimeContainer (Durable Object → Python FastAPI on port 8080)
       ├─ agent-domain Postgres (SUPABASE_DB_URL)
       ├─ catalog.internal (private) ─────────────▶ CATALOG service binding
       │    (no public /catalog/* browser route)
       └─ MiMo/DeepSeek model provider (MIMO_API_KEY / DEEPSEEK_API_KEY) —
          photo-search recognition rides this same chat model (#656)
```

## Auth Flow

The only bearer credential type is a human JWT, validated at the Worker edge:

| Credential | Format | Validation |
|---|---|---|
| Human JWT | `Bearer <neon_auth_jwt>` | `authenticate()` verifies the signature locally against the branch's Neon Auth JWKS (EdDSA via jose `createRemoteJWKSet`), checking issuer/audience/exp — no round-trip to the auth origin. AUTH-2 #950 hard cut: `NEON_AUTH_JWKS_URL` is the edge's ONLY identity source; the Supabase verifier and the dual-issuer flag are deleted. |

The `sk_*` API-key credential and the `api_keys` table are deleted (AUTH-1 #945): an `sk_*`
Bearer token is rejected as invalid, never mapped to an "agent" identity. Anonymous access uses a
worker-minted cookie identity, not a credential.

On success the Worker sets `X-User-Id` and `X-User-Type`, deletes the `Authorization` header, and forwards to the container. The container never sees raw bearer tokens. `/v1/users/*` likewise gets `Authorization` stripped and the verified identity forwarded as `X-User-Id`/`X-User-Type` (AUTH-2 #950) — the users Worker trusts only that header.

## Env Var Boundary

| Variable | Boundary | Notes |
|---|---|---|
| `NEON_AUTH_JWKS_URL` | Worker-only | Branch JWKS — the edge's ONLY identity source (AUTH-2 #950). issuer/audience are derived from it in `workers/edge/src/identity/auth.ts`; production is unset (fails closed) until its Neon Auth branch is provisioned |
| `SUPABASE_DB_URL` | Container-only | Direct Postgres connection for asyncpg (legacy data plane; agent container) |
| `CORS_ALLOWED_ORIGIN` | Container-only | Agent CORS allowlist |
| `GOOGLE_MAPS_API_KEY` | Container-only (optional) | Geocoding |
| `LOGFIRE_TOKEN` | Container-only (optional) | Observability |
| `VITE_*` (web build) | `apps/web` build-time only | Injected by CI into the web Worker; not edge-Worker secrets |
| `VITE_NEON_AUTH_BASE_URL` | `apps/web` build-time only | Better Auth client origin (login UI + JWT exchange) |

The full container env allowlist is `CONTAINER_ENV_KEYS` / `CONTAINER_REQUIRED_KEYS` in
`workers/edge/src/container/container-env.ts` (consumed by `workers/edge/src/entry.ts`).

## Current Trust Boundary

- Browser clients hit `apps/web`; API clients hit the edge Worker hostname
- Worker-only auth secrets stay at the edge: `NEON_AUTH_JWKS_URL`; the edge JWT path verifies against the branch's public JWKS, so no Supabase/anon key is involved
- Container runtime receives only its explicit allowlist from `workers/edge/src/container/container-env.ts`
- Agent auth trust starts from `X-User-Id` and `X-User-Type`, not from raw bearer tokens

## 1. `/v1/*` Rate Limit Rule

Cloudflare dashboard path:

- Security → WAF → Rate limiting rules

Recommended rule:

- Expression: `http.host eq "seichijunrei.zhenjia.org" and starts_with(http.request.uri.path, "/v1/")`
- Counting characteristic: source IP
- Threshold: `60` requests
- Period: `1 minute`
- Action: `Block`
- Response: `429` if the zone plan exposes custom response options; otherwise keep Cloudflare default block handling

Notes:

- leave `/healthz` outside this rule
- do not include static asset paths
- if trusted internal automation needs higher throughput later, add a narrowly-scoped bypass instead of loosening the global rule

## 2. Prompt-Injection Coarse Filter

Cloudflare dashboard path:

- Security → WAF → Custom rules

Goal:

- block obviously hostile prompt text before it reaches Worker logs or model-provider spend
- keep this filter coarse and reversible

Suggested phrases:

- `ignore previous instructions`
- `system prompt`
- `output your prompt`
- `pretend you are`

Safer baseline expression when only URI/query inspection is available:

```text
http.host eq "seichijunrei.zhenjia.org"
and starts_with(http.request.uri.path, "/v1/")
and (
  lower(http.request.uri.query) contains "ignore previous instructions"
  or lower(http.request.uri.query) contains "system prompt"
  or lower(http.request.uri.query) contains "output your prompt"
  or lower(http.request.uri.query) contains "pretend you are"
)
```

Operational guidance:

- start with `Managed Challenge` if you are unsure about false positives
- switch to `Block` only after observing clean hits
- if your Cloudflare plan supports request-body inspection for custom WAF rules, extend the same phrase list there
- if body inspection is unavailable, keep this query/header-only rather than reimplementing ad-hoc content filtering in the Worker
- this is only a coarse edge filter; application-level prompt guardrails still remain required

## 3. AI Gateway Insertion Point

If AI Gateway is enabled later:

- place it between the container and the upstream model provider (MiMo / DeepSeek)
- do not place it in the browser
- do not place it in the Worker

Planned env design:

- `CLOUDFLARE_AI_GATEWAY_URL` as an optional container-only env

Before enabling it, backend model configuration must support provider base-URL override through env. Until that exists, keep AI Gateway disabled and treat this section as a forward path only.

## 4. Rollback Procedure

If legitimate traffic is blocked:

1. disable the custom prompt-injection rule first
2. keep the `/v1/*` rate-limit rule enabled unless it is the clear source of the incident
3. inspect Worker logs for `401`, `429`, and upstream `5xx` spikes
4. only then reintroduce narrower filters

If the rate limit is too aggressive:

1. raise the threshold above `60 req/min/IP`, or
2. switch action from `Block` to `Managed Challenge`

If an app deploy is at fault instead of WAF:

1. revert and redeploy the app separately
2. leave WAF changes untouched unless they contributed to the incident
3. verify `/healthz`, `/v1/runtime`, and static asset delivery independently

## 5. Post-Change Verification

After manual dashboard changes:

- confirm `/healthz` still succeeds without auth
- confirm `/v1/runtime` still requires auth and returns `401` when missing credentials
- confirm a valid authenticated `/v1/runtime` request still reaches the agent container
- confirm `apps/web` page routes are unaffected (they are a separate Worker)
- inspect Worker logs for unexpected spikes in blocked traffic or auth failures

## 6. Egress Network Policy (container-level defense-in-depth — #284 Task 7)

### Threat model reference

This section closes **Task 7** of the BYOK design spec
(`docs/specs/2026-07-28-284-byok-design.md`, now landed in this tree — see the
Threat Model table there for the full T1–T14 list), whose OQ-5 ruling required a **spike before
implementation**: verify whether the Cloudflare Containers runtime "grants `NET_ADMIN` / can
express an egress policy **at all**" — a kernel-level or platform-level block of RFC1918 +
`169.254.0.0/16` + `100.64.0.0/10` *behind* the application-layer SSRF guard (`egress_guard`,
Task 1 / #458), as a second line of defense against threat **T12** ("application-layer guard
bypassed by a code path that builds its own client"). OQ-5 has two independent clauses; getting
only the first one right is not sufficient to trigger the pre-authorized fallback — see below.

### Spike, clause 1: NET_ADMIN / iptables — CONFIRMED unavailable

Evidence from Cloudflare's own documentation (via the `cloudflare-docs` MCP tool and web search;
no live deploy was performed — deploys stay CI/CD-only per the repo's no-local-deploy rule):

- **Cloudflare Containers FAQ** states explicitly: *"Cloudflare Containers do not support
  iptables manipulation. The `--iptables=false` and `--ip6tables=false` flags prevent Docker from
  attempting to configure network rules, which would otherwise fail."* and *"Containers run
  without root privileges"* (Docker-in-Docker guidance tells users to use `docker:dind-rootless`
  precisely because the outer container has no root).
- The Wrangler `[[containers]]` configuration schema
  (`https://developers.cloudflare.com/workers/wrangler/configuration/#containers`) exposes only
  image/build, placement, rollout, SSH, and `constraints` settings — `image`, `class_name`,
  `instance_type`, `max_instances`, `name`, `image_build_context`, `image_vars`,
  `rollout_active_grace_period`, `rollout_step_percentage`, `ssh`, `authorized_keys`,
  `constraints.regions`, `constraints.jurisdiction`. **No capability, security-context, or
  network-policy field exists** anywhere in that schema.
- This repo's own `wrangler.toml` `[[containers]]` block (`class_name = "RuntimeContainer"`) and
  the `./Dockerfile` are consistent with this: the Dockerfile already runs as a non-root
  `appuser`, matching the platform's documented no-root/no-`NET_ADMIN` posture, not something we
  can loosen from our side.

**This clause holds: NET_ADMIN / iptables-style egress policy is confirmed unavailable on
Cloudflare Containers today.**

### Spike, clause 2 (corrected twice now — see both corrections below): a platform-enforced URL-hostname denylist IS available, and does not require NET_ADMIN — but it is a glob matcher, not a CIDR parser

An earlier version of this section claimed the platform's only egress-shaping primitive was
HTTP(S)-scoped Worker request routing (`outboundByHost`), and concluded that clause 2 of OQ-5 was
also unmet. **That was wrong.** The next revision corrected it to "`deniedHosts` accepts IP CIDR
ranges" — citing the official docs' own example, `deniedHosts = ["some-nefarious-website.com",
"141.101.64.0/18"]` — and shipped a `string[]` of literal CIDR strings (`"10.0.0.0/8"`, etc.).
**That was also wrong, and worse: it shipped as a silent no-op.**

A second review round read the vendored **implementation**, not just the type declaration or the
docs prose (`node_modules/@cloudflare/containers/dist/lib/container.js`,
`@cloudflare/containers@0.3.7`), and found:

```js
function simpleGlobMatch(pattern, value) {
    const parts = pattern.split('*');
    if (parts.length === 1) return pattern === value;
    // ... prefix/suffix/substring matching on `parts`, no numeric parsing at all
}
function matchesHostList(hostname, patterns) {
    return patterns.some(pattern => simpleGlobMatch(pattern, hostname));
}
```

`deniedHosts`/`allowedHosts` are matched against the **request URL's hostname string** with a
plain `*`-wildcard string matcher — there is no `/`-suffix (CIDR) parsing anywhere in this
function, and it never resolves DNS, so it cannot match a hostname's *resolved* IP either. The
literal string `"10.0.0.0/8"` only ever matches a hostname that is exactly the eleven characters
`10.0.0.0/8` — it does not match `10.0.0.1`, `10.5.3.200`, or anything else. The previous revision
of `workers/edge/src/entry.ts` shipped exactly that: five CIDR-notation strings that matched nothing,
ever — a complete no-op, caught only because a reviewer decided that "the type is `string[]`"
does not establish "the semantics are CIDR" and went and read the matcher's actual source instead
of trusting the docs' prose example. **The type of a config field is not proof of what a runtime
does with it — the implementation is the ground truth,** and that lesson is recorded here on
purpose, not smoothed over.

The corrected, verified claim: the Container-runtime egress control that exists without NET_ADMIN
is a **string/glob denylist matched against the request URL's hostname**, not a CIDR-aware network
filter. It is real, it is enforced before any outbound handler
(`container.js:203`, `if (deniedHosts && matchesHostList(hostname, deniedHosts)) return new
Response('Origin is disallowed', { status: 520 })` — see the "What actually happens on a match"
note below), and it does not require `enableInternet: false`. But its coverage claim has to be
stated in glob terms, not CIDR terms — see "What is implemented" below for exactly what that
buys.

**Corrected conclusion: OQ-5's clause 2 is met — the platform can express *a* URL-hostname-layer
egress policy without NET_ADMIN — but it is narrower than "an egress policy" reads in the abstract.
It is not a CIDR/network-layer filter, and it does not see resolved IPs.** The pre-authorized
fallback ("document that the application layer is the sole control") still does not fully trigger,
because this is a real, additional, platform-enforced control layer — but the application-layer
guard (`egress_guard`/`GuardedAsyncTransport`) remains the layer that actually understands
IP/network semantics (DNS resolution, `ipaddress` classification, DNS-rebinding defense). Task 7
ships as an implemented (glob-based, URL-hostname-layer) policy plus the pre-existing
application-layer guard — not a documented-acceptance closure, and not a claim of network-layer
enforcement either.

### What is implemented

`RuntimeContainer.deniedHosts` (`workers/edge/src/entry.ts`) is set from `DENIED_EGRESS_HOSTS`
(`workers/edge/src/container/container-env.ts`, split out for the same Node-import-chain reason as
`buildContainerEnvVars` — see that file's header comment). It is a set of dotted-decimal glob
prefixes and exact hostnames — **not CIDR strings** — chosen to be the glob-equivalent of the
spec's target ranges when a request URL's hostname is already a bare IPv4 literal (the common
shape for cloud-metadata SSRF, and the exact shape of the spec's Task 7 AC):

```ts
export const DENIED_EGRESS_HOSTS = [
  "10.*",                       // RFC1918 10.0.0.0/8 — glob-exact equivalent
  "172.16.*", ..., "172.31.*",  // RFC1918 172.16.0.0/12 — 16 generated entries, one per octet
  "192.168.*",                  // RFC1918 192.168.0.0/16 — glob-exact equivalent
  "169.254.*",                  // link-local 169.254.0.0/16 — glob-exact equivalent (AWS/Azure/GCP IMDS)
  "100.64.*", ..., "100.127.*", // CGNAT 100.64.0.0/10 — 64 generated entries, one per octet
  "100.100.100.200",            // Alibaba/Tencent metadata (exact; already covered above, kept explicit)
  "192.0.0.192",                // Oracle Cloud Infrastructure metadata
  "metadata.google.internal",   // GCP metadata hostname literal — glob ranges above cannot match a hostname
  "[::1]",                      // IPv6 loopback (best-effort — see limit 4)
  "[fd00:ec2::254]",            // AWS IMDSv2 ULA (matches egress_guard.py's own metadata-IP deny set)
  "[::ffff:a9fe:a9fe]",         // IPv4-mapped 169.254.169.254
  "[::ffff:6464:64c8]",         // IPv4-mapped 100.100.100.200
  "[::ffff:c000:c0]",           // IPv4-mapped 192.0.0.192
  "[fe80:*", "[fd00:*",         // IPv6 link-local / ULA convention prefixes (plain string prefixes)
];
```

The 16 and 64 per-octet entries are generated (`Array.from({ length: 16 }, (_, i) => \`172.${16 +
i}.*\`)`, etc.), not hand-typed, so the source stays short even though the effective list is long;
this is what makes full-range coverage (rather than a metadata-IP-only subset) the practical
choice here. The IPv6 entries are individually verified literals/prefixes, not a generated range —
see limit 4 below for why IPv6 coverage stops there rather than being similarly exhaustive.

**What actually happens on a match:** `ContainerProxy.fetch` (the `WorkerEntrypoint` that
performs this check — see the `ContainerProxy` export note below) returns a synthesized
**`520 Origin is disallowed`** HTTP response. Nothing is "refused at the network layer" in the
sense of a socket-level RST or connection timeout — the platform's egress proxy answers the
request itself, and the container never gets a TCP connection to the target. Functionally
equivalent for SSRF purposes (no bytes reach the target, no bytes come back), but a future
engineer debugging a `520` from inside the container should know this policy is what produced it.

Pinned by `workers/edge/test/container-env.test.ts` (run via `pnpm run test:worker`), which — after two
earlier revisions each fixed one layer of the same problem (a hand-rolled `ipInCidr()` helper that
validated its own invented semantics, then a hand-ported copy of the real algorithm that could
still silently drift from a future vendored change) — now **extracts and evaluates the real
`simpleGlobMatch`/`matchesHostList` functions directly from the vendored source file at test
time**, so every assertion runs against the actual shipped behavior with no copy in between. A
behavioral canary asserts extraction succeeded and exercises exact-match, glob-match, and
literal-CIDR-string-does-not-match semantics against the real functions — if a future package
version ever adds genuine CIDR parsing, that last assertion flips and the canary fails loudly,
rather than a source-text pin staying green while the semantics quietly change underneath it.
Coverage assertions run against this same real, extracted matcher: every spec Task 7 AC
error-path address is matched, the two extra metadata endpoints are matched, three representative
public addresses are not matched, the full 16- and 64-entry octet ranges are matched at their
exact boundaries (and the addresses just outside those boundaries are not), the concrete IPv6
literal cases are matched, an unrelated public IPv6 literal is not, the deliberate
subdomain-over-match is asserted as intentional rather than accidental, and an emptied denylist
fails the coverage assertions (a mutation guard against the exact silent-no-op failure mode this
correction exists because of).

**Required for the policy to run at all — `ContainerProxy` export.** `applyOutboundInterception`
(`container.js:1207`) hard-throws at container start if `ctx.exports.ContainerProxy` is undefined:

```
if (ctx.exports.ContainerProxy === undefined) {
    throw new Error('ctx.exports.ContainerProxy is undefined, export ContainerProxy from the
    containers package in your worker entrypoint');
}
```

`workers/edge/src/entry.ts` now re-exports it (`export { ContainerProxy } from "@cloudflare/containers";`),
matching the pattern in Cloudflare's own `Container` class reference example. This is not a
regression introduced by this change — the repo already exercised `outboundByHost` for
`catalog.internal` before this PR, which also depends on the same interception machinery — but it
was never verified as present, and `deniedHosts` makes it load-bearing for the first genuinely
security-relevant use of this mechanism. `workers/edge/test/entry.test.ts` asserts (via a source-text match,
since `entry.ts`'s `@cloudflare/containers` import chain cannot be loaded under plain `node
--test` — see that file's comment) that the export line is present, as a regression guard against
silently losing it again.

### Scope and an honest limit: glob-matchable plain HTTP is covered; DNS rebinding and HTTPS are not, by design of this layer

Three separate limits, stated precisely rather than glossed:

1. **This is a URL-hostname string match, not a network-layer IP check — DNS rebinding is out of
   scope for this control.** A request to `http://evil.example.com/` where `evil.example.com`
   *resolves* to `169.254.169.254` is not matched by `DENIED_EGRESS_HOSTS` at all (the hostname
   string is `evil.example.com`, which matches none of the glob patterns) — `deniedHosts` never
   resolves DNS to check. Defense against that shape of attack is entirely the application-layer
   guard's job (`egress_guard`'s dual-condition `ipaddress` classification on the *resolved*
   address, plus `GuardedAsyncTransport`'s connect-time re-validation and IP pinning — T4). This
   control only catches requests whose URL already names a denied IP literal or the one denied
   hostname literal (`metadata.google.internal`) directly.
2. **Plain HTTP is covered; HTTPS is not, without an additional, deferred cost.** Per the vendored
   type declaration, `deniedHosts` filtering runs as part of the Container runtime's outbound-HTTP
   interception, which is unconditional for plain HTTP. HTTPS traffic is only decrypted/inspected
   for filtering when `interceptHttps: true` is additionally set (`applyOutboundInterception`'s
   doc comment: *"When `interceptHttps` is enabled, also applies HTTPS interception"*). We
   evaluated turning this on and **did not**, for one concrete, evidenced reason: `interceptHttps`
   MITMs all outbound HTTPS with an ephemeral per-instance CA
   (`/etc/cloudflare/certs/cloudflare-containers-ca.crt`), which the container's Python process
   must be configured to trust (`httpx`/`certifi` does not trust arbitrary system CAs by default).
   Flipping this on without first wiring that trust — and verifying it in a real deploy, which this
   task cannot do — would silently break **every** production HTTPS call (MiMo, the DeepSeek
   fallback, any BYOK provider), not just close a gap. That is a materially worse failure mode than
   the gap it would close, given the exact AC error-path scenario in the spec uses
   `http://169.254.169.254/` (plain HTTP) — already covered — and real cloud-metadata IMDS
   endpoints are HTTP-only in practice.
3. **Setting `deniedHosts` promotes the container to intercept-all mode for plain HTTP.**
   `shouldInterceptAllOutbound()` (`container.js:1121`) returns `true` whenever a denylist is
   configured, and that promotion is sticky "until the instance restarts" — before this change the
   container ran in cheaper per-host interception (only the `catalog.internal` binding hop); after
   it, every plain-HTTP outbound takes a Workers-runtime hop through `ContainerProxy` instead of
   going direct. Non-HTTP egress (`asyncpg`'s Postgres connection) is unaffected — `interceptAll`
   only applies to HTTP(S) — and is correspondingly **not** covered by this denylist either way.
4. **IPv6 literals are not comprehensively covered.** `url.hostname` renders IPv6 in bracketed
   compressed form (`[::1]`, `[fd00:ec2::254]`, `[::ffff:a9fe:a9fe]` — the IPv4-mapped form of
   `169.254.169.254`), which no dotted-quad glob matches — verified directly against the real
   vendored matcher: all three previously returned `false` against the plain-IPv4 entries above.
   ULA (`fd00::/8`), IPv6 link-local (`fe80::/10`), and IPv4-mapped IPv6 are largely out of scope
   for this layer by construction — IPv6 has too many equivalent textual representations
   (zero-compression, leading-zero suppression) for a hand-built glob list to be exhaustive the way
   the IPv4 ranges above are. `DENIED_EGRESS_HOSTS` does now include a **best-effort, individually
   verified** set of the concretely-named cases (loopback `[::1]`; the AWS IMDSv2 ULA address
   `[fd00:ec2::254]`, matching `egress_guard.py`'s own metadata-IP deny set; the IPv4-mapped forms
   of all three metadata IPs above; and two plain string-prefix globs, `[fe80:*` and `[fd00:*`, for
   the link-local and ULA convention prefixes) — this closes the concrete, named threats without
   claiming general IPv6 coverage. DNS rebinding, general ULA/link-local addresses outside those
   two prefixes, and any other IPv6 textual form remain the application-layer guard's job
   (`egress_guard` already handles IPv4-mapped-IPv6 in its own resolved-address classification,
   independent of this layer).

**Two notes to stop a future contributor from "fixing" things that are already handled or already
intentional:**

- **Encoded IPv4 (decimal/octal/hex) is already closed, for free — do not add redundant entries.**
  `ContainerProxy.fetch` runs `new URL(request.url)` before matching, and the WHATWG URL host
  parser normalizes numeric hosts. Verified directly: `http://2852039166/`, `http://0xA9FEA9FE/`,
  and `http://0251.0376.0251.0376/` (decimal, hex, and octal encodings of `169.254.169.254`) all
  produce the hostname `169.254.169.254` before `deniedHosts` ever sees the request; uppercase
  hostnames are lowercased the same way (`METADATA.GOOGLE.INTERNAL` → `metadata.google.internal`).
  A future contributor who thinks encoded-IPv4 is a live bypass and adds entries for it would be
  adding dead weight, not closing a gap.
- **Prefix globs over-matching subdomains (e.g. `10.0.0.1.evil.com` matches `"10.*"`) is
  deliberate and fail-closed.** `simpleGlobMatch`'s prefix check is a string match, not an IP
  anchor, so any hostname that merely *starts with* a denied prefix is blocked too — this can only
  cause an improbable legitimate hostname to be blocked, never the reverse, so it is left as-is
  rather than "fixed" into a narrower (and more fragile) pattern.

**Follow-ups, not required for Task 7's closure:** (a) turning on `interceptHttps` needs its own
spec'd rollout (Python CA-trust wiring + a staging verification pass); (b) the DNS-rebinding gap
above is not a gap introduced by this PR — it was always the application-layer guard's job — but
it means this section's control inventory below should not be read as "the network layer now
handles SSRF"; it handles one narrow, real slice of it (literal IP/known-hostname requests over
plain HTTP), on top of the guard that handles the general case.

### AC disposition

The spec's three Task 7 ACs, checked against what is actually shipped here (config + unit tests
that exercise the real vendored glob algorithm, not a live-container integration test — this task
cannot deploy, so the following is what is verified today vs. what still needs a manual staging
check before being marked fully closed):

- **Happy path** (public egress succeeds): satisfied by design — none of the three representative
  public addresses (`1.1.1.1`, `8.8.8.8`, a placeholder provider hostname) match
  `DENIED_EGRESS_HOSTS` under the ported real matcher; pinned by
  `workers/edge/test/container-env.test.ts`. Not yet verified against a live deployed instance, and not yet
  verified that `ContainerProxy` is actually reachable via `ctx.exports` at runtime (see the
  live-verification checklist below — step 1).
- **Null/empty** (catalog `outboundByHost` hop + the MiMo provider call still succeed):
  satisfied by design — the catalog hop is a private-hostname binding interception, a different
  code path from `deniedHosts` entirely; the MiMo provider's public hostname does not match any
  entry in the list. Not yet verified against a live deployed instance.
- **Error path** (`169.254.169.254`, `100.100.100.200`, `10.0.0.1` "refused at the network
  layer"): satisfied **for plain HTTP requests whose URL names one of these addresses or hostname
  literals directly**, matching the spec's own literal AC wording (`http://169.254.169.254/`);
  pinned against the real ported glob algorithm by `workers/edge/test/container-env.test.ts`. The
  spec's "refused at the network layer" phrasing is satisfied **in effect** (nothing reaches the
  target, nothing comes back) but not **literally** — see "What actually happens on a match"
  above: enforcement returns a synthesized HTTP `520`, not a refused connection. **Not** covered:
  HTTPS to the same addresses (see limit 2 above), or a DNS name that merely *resolves* to one of
  these addresses (see limit 1 above; that case is the application-layer guard's job, unaffected
  by this section).

A live-container verification pass is a required follow-up, not fabricated as done here. Its
checklist, in order:

1. **Confirm `ContainerProxy` is exported and reachable via `ctx.exports`, and that the container
   starts without the `ctx.exports.ContainerProxy is undefined` throw.** This is a precondition
   for every claim below it — if this throws or is silently unreachable, none of the `deniedHosts`
   enforcement described in this section is active. (Whether the repo's pre-existing
   `catalog.internal` `outboundByHost` hop already exercised this path successfully, or has a
   latent problem of its own, is unknown before this check — either way it predates this PR.)
2. Confirm the intercept-all promotion (limit 3 above) does not introduce a latency/availability
   regression on the MiMo provider call now that it routes through `ContainerProxy`.
3. Confirm the happy-path, null/empty, and error-path ACs against a real deployed instance, per the
   AC disposition above.
4. Confirm the HTTPS and DNS-rebinding gaps are exactly as scoped (i.e. that nothing about a real
   deployment closes them incidentally, which would mean this section under-claims coverage rather
   than over-claims it — the safer direction of error, but worth confirming either way).

### Defense-in-depth control inventory (what enforces this, end to end)

1. **`RuntimeContainer.deniedHosts`** (this section) — the Worker's URL-hostname glob denylist
   described above (plain HTTP, literal IP/hostname requests only — not CIDR-aware, not
   DNS-rebinding-aware); the actual Task 7 deliverable.
2. **`egress_guard.validate_base_url()`** (`apps/agent/src/animichi/infrastructure/egress_guard.py`,
   Task 1 / #458) — SSRF pre-flight check run against any user-supplied BYOK `base_url` before a
   model client is constructed; rejects private/link-local/CGNAT/reserved targets (dual-condition
   `is_global` + deny-flag check, T3/T6) with a `400` before any socket is opened.
3. **`GuardedAsyncTransport` / `build_guarded_async_client`**
   (`apps/agent/src/animichi/infrastructure/egress_transport.py`, Task 1) — the only sanctioned way to
   build a BYOK-path HTTP client (all three provider families — OpenAI-compatible, Anthropic,
   Gemini — route through it via `agents/byok_models.py`, #477). It:
   - re-validates at connect time and **pins the socket to the validated IP with a rewritten
     `Host` header** (`_rewrite_for_pinned_endpoint`), closing the DNS-rebinding/TOCTOU window
     (**T4**);
   - **refuses every 3xx response** (`EgressBlockReason.REDIRECT_REFUSED`), closing the
     redirect-based bypass (**T5**);
   - is constructed with **`trust_env=False`** and no `mounts`/proxy, closing **T13** (a proxy env
     var silently defeating IP pinning);
   - **opts itself out of global Logfire/OTel httpx instrumentation**
     (`_exclude_from_httpx_instrumentation`, Task 2 / #474) so the credential-stripping middleware
     is not bypassed by an auto-instrumented span on this specific transport.
4. **`X-BYOK-*` deny-capture** (Task 2 / #474) — credential headers never reach logs/spans/
   exception payloads, so a bypass cannot be bootstrapped from leaked telemetry.
5. **Task 9 authenticated-path rate limiting** (#451) at the Worker — bounds the blast radius of any
   single identity hammering an egress target, independent of whether that target is blocked. This
   bound is currently scoped to **server-key traffic**; BYOK-specific quota-exemption semantics
   land in Task 4/5 (`feat/284-t45-exemption-probe`, unmerged at the time of writing) and will
   change this bound once merged — re-check this item then.

Production today is **MiMo-only** (the DeepSeek fallback is provisioned but disabled) — "the MiMo
provider call" above, not "two live provider hops"; re-word this bullet if/when DeepSeek is
re-enabled.

### Residual risk (T12), and the AGENTS.md convention that backs it

**T12** — "a future contributor adds a code path that builds its own HTTP client, bypassing the
guarded factory" — is now **partially** mitigated at runtime, not solely by code review: a raw
socket/`httpx` client making a **plain-HTTP request whose URL names a denied IP or hostname
literal directly** is blocked by `RuntimeContainer.deniedHosts` regardless of which Python code
path constructed it. That partial mitigation does **not** extend to (a) HTTPS to the same
addresses, or (b) a hostname that only *resolves* to a denied address (DNS rebinding) — both
remain the guarded-factory convention's job. `apps/agent/AGENTS.md`'s HTTP conventions section
states this explicitly (previously it said the opposite: "leave `trust_env` at httpx's default
(`True`)", without carving out the BYOK/egress-guarded path, which would have told a future
contributor to recreate the exact T13 bypass this section closes — that has been corrected).
Owner: whoever lands new outbound HTTP call sites in `apps/agent/src/animichi/` must construct clients
via `egress_transport.build_guarded_async_client`; PR review is the enforcement point for the
HTTPS and DNS-rebinding residuals.

### Process-level socket guard — evaluated, not implemented

The spec's fallback explicitly allows an *optional* process-level guard (e.g., a Python `socket`
patch that inspects the destination of every outbound `connect()` and rejects RFC1918/link-local/
CGNAT targets before the OS attempts the connection) as a cheaper stand-in for a kernel policy.
Now that `deniedHosts` closes the plain-HTTP-with-a-literal-address case at the Worker's
URL-hostname layer, the remaining cases such a guard would add are the HTTPS-to-private-IP gap and
the DNS-rebinding gap above. This was evaluated and **not implemented**,
for two concrete reasons (a third reason from an earlier draft of this section — that Task 1/3
were still unmerged — no longer holds: #458, #474, and #477 are all merged; the two reasons below
stand on their own regardless):

1. **Blast radius vs. benefit.** A global monkeypatch of `socket.socket.connect`/`connect_ex`
   affects every outbound connection the process makes — Postgres (`asyncpg`), the catalog
   binding hop, the MiMo provider call, and any future dependency — not just the BYOK path. The
   marginal benefit over `deniedHosts` (platform layer, HTTP) plus the guarded-factory convention
   (application layer, HTTPS, code-review-enforced) is closing one narrow HTTPS-to-private-IP
   bypass scenario, while the downside of a global socket patch misbehaving is an outage across
   every network call the container makes.
2. **Two independent guards drift apart.** A process-level socket guard would duplicate
   `egress_guard`'s validation logic (dual-condition IP classification, IPv6-mapped-IPv4 handling,
   `0x`-encoded octets, etc.) in a second implementation. Two guards with subtly different edge-case
   handling is a known SSRF-bypass anti-pattern in its own right — independent of whether the
   guarded factory is merged or not, maintaining one validation implementation instead of two is
   the safer design. The single-guard approach (guard the one factory that builds every client) is
   deliberately the pattern the spec already chose.

If a future engineer wants to revisit this, the correct home for a socket-level guard is inside
`egress_guard` itself as a `socket.getaddrinfo` / custom `httpx` transport hook scoped **only** to
BYOK-constructed clients (not a global patch) — which is what the guarded-client design already
sets up the seam for.

### Upgrade path

Two independent follow-ups, tracked separately from Task 7's closure:

1. **HTTPS coverage of the denylist** — wire Python CA trust for
   `/etc/cloudflare/certs/cloudflare-containers-ca.crt`, set `interceptHttps: true`, verify in a
   real staging deploy that legitimate HTTPS (MiMo) still works before enabling in production.
2. **Resolved-IP (DNS-rebinding-aware) matching, if Cloudflare ever adds it to `deniedHosts`** —
   today the matcher only sees the request URL's hostname string, never a resolved address; if a
   future SDK version resolves DNS before matching, re-check whether the application-layer guard's
   DNS-rebinding defense (T4) becomes partially redundant with this layer (it should stay either
   way — defense-in-depth — but the residual-risk note above would need updating).
3. **True kernel-level / network-layer policy, if Cloudflare ever ships it** — re-check the
   Wrangler `containers` configuration schema changelog
   (`https://developers.cloudflare.com/workers/wrangler/configuration/#containers`) and the
   Containers changelog (`https://developers.cloudflare.com/changelog/product/containers/`) for a
   `NET_ADMIN`/capability field; if one ships, it would be additive to `deniedHosts`, not a
   replacement — the application-layer guard (`egress_guard`/`GuardedAsyncTransport`) remains the
   layer that actually understands IP/DNS semantics regardless of what ships at the network layer.

A live-container verification pass (the AC-disposition gaps above) is the immediate next step,
independent of either follow-up.
