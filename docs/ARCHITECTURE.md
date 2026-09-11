# Architecture

This document describes the current source paths. Deployment receipts and platform acceptance
remain separate evidence; a local native candidate is not proof that production runs it.
The accepted agent target is [the native Pi harness spec](specs/2026-09-09-agent-on-pi-harness-spec.md).

## Request and execution

`workers/edge/src/entry.ts` composes the Hono gateway and exports `SessionAgent` under the
deployed `AgentSession` class name. The gateway verifies identity, applies rate limits and
Turnstile, and sends chat to the native host. There is no chat route flag or container fallback.
The remaining `RuntimeContainer` supports other existing service routes; it is not a second
execution authority for a failed native chat request.

The host composes published Cloudflare `Agent` with native Pi `AgentHarness`, `AgentLane`,
`Context` and results. It holds exclusion across awaits, registers durable recovery before
admission, reattaches after faults, and reads current inspectExecution/getResult witnesses.
Cloudflare schedules and keepAliveWhile own wakeups and lifetime. Native Pi owns the
operation lifecycle, tool replay, transcript, compaction and usage ledger.

| Responsibility | Source |
|---|---|
| Session host and native startup | `workers/edge/src/agent/host/` |
| Client-key admission, ownership and quota reservation | `workers/edge/src/agent/admission/` |
| Bounded durable intent/obligation discovery | `workers/edge/src/agent/recovery/scan.ts` |
| Result and usage settlement | `workers/edge/src/agent/settlement/native-settlement.ts` |
| Native storage and Prisma business schema | `packages/pi-session-neon/` |
| Shared production/Eval composition | `packages/agent/src/harness.ts` |
| Committed history and AI SDK SSE projection | `workers/edge/src/agent/views/` |

The old run machine, lease queue, SessionEnvelope, hand-written tool runtime and SQL
runs/messages/run_steps history reader are deleted. There is no compatibility converter,
dual read or dual write. Applied Atlas migrations and online data are unchanged.

## Tools, domain facts and selection

`createPilgrimageHarness` composes seven public SDK tools: resolve_anime, search_bangumi,
search_nearby, plan_route, translate_anime_title, web_search and respond. Catalog calls use
the actual oRPC contract and its validators. The catalog Worker owns anime availability,
ingest/enrichment and route planning; runtime requests do not query Anitabi or Bangumi directly.

Tools retain native parameters, replay policies and authorization/quota checks. Context
hooks derive facts and frozen summaries from successful executed arguments/results, and
commit optional annotations with the native result. Execution witnesses bind the operation,
tool call and actual arguments. An assistant's requested arguments are not executed evidence.

Deterministic selections use ordinary package functions and typed `animichi.selection` custom
entries. They do not invent model tool calls. References must resolve on the current branch;
claim/recovery and owner checks remain in the edge business transaction. Status context uses
escaped concise projections; full user/domain data remains in validated native storage.

## Identity and data boundaries

The edge strips client-supplied identity headers, verifies Neon Auth JWTs against the branch's
JWKS and forwards only verified identity. Users trusts that identity and does not verify JWTs
again. There is no Supabase verifier or API-key identity path. The published route inventory
and policy defaults live in `packages/contract/src/agent-paths.ts` and `identity-policy.ts`.

Anonymous identity is an HMAC-protected cookie, implemented in
`workers/edge/src/identity/auth.ts` and `workers/edge/src/identity/anonymous-id.ts`.
`ANON_ACCESS_ENABLED` and a non-empty `ANON_ID_SECRET` explicitly enable access;
there is no minimum-history threshold. Verified forwarded identity uses
`X-User-Type: anonymous` and `X-User-Id: anon_<hex>`. These headers never override
the gateway's verified native chat identity. Turnstile and rate limits remain at the gateway.

Native admission holds the owning session and atomically reserves the client's message quota.
`ANON_DAILY_COST_BUDGET_USD` is enforced before admission, drive and tool execution by
`workers/edge/src/agent/host/native-authority.ts`, reading `daily_usage`; the gateway maps
`anonymous_budget_exhausted` to the public `anon_budget_exhausted` guidance response.
Settlement records immutable native costs and refunds the original UTC reservation when
appropriate. Missing native evidence remains pending. Recorded zero cost cannot distinguish
free from unpriced usage because the published ledger does not provide that distinction.

Neon is the data plane. Prisma 8 owns native agent queries/storage and the migration chain in
`packages/pi-session-neon/migrations/`. Catalog and Users retain their query-only Drizzle mappings;
`migrations/neon` owns pre-existing objects through Atlas and the migrator Worker. Each object
has one migration owner. Source deletion does not drop tables or erase history.

## Browser and evaluations

`apps/web` is the only browser surface. The edge serves API/proxy routes and returns JSON 404
for unmatched paths. Web conventions and auth wiring live in `apps/web/AGENTS.md`.

`packages/eval/src/native/in-process-task.ts` uses the same production harness with a fresh
MemorySessionRepo per attempt. Logfire receives native LaneSnapshot output, raw hooks and usage.
The task tests cover production composition, native outcomes, cancellation and resource closure.
Native correctness, required assertions and pass^k remain independent Eval work; they are not
part of this task implementation. Old HTTP transcript and staging-prefix seed adapters are removed.

Existing Python code, exported corpora and statistical oracle fixtures remain historical or
other-service inputs, not the native Eval execution path. Complete E1 command/configuration,
recorded native prefix forks, production suite rosters and authorized real-model evidence are
still separate acceptance work. Public browser/platform verification and deployment evidence
must be reported explicitly rather than inferred from deterministic local tests.
