# Agent domain package

`@animichi/agent` supplies platform-independent domain functions to the edge host. Public
exports run directly in Node and in a bundled Worker; this package has no deploy command,
bindings or storage. `@animichi/agent-python` names the existing Python workspace at
`apps/agent`; its Python modules, container and path-based CI lane are unchanged.

```ts
import { localizedCityName, selectedRouteMessage } from "@animichi/agent";

localizedCityName("Uji", "ja"); // 宇治
selectedRouteMessage("en", 2); // Created a route with 2 selected stops.
```

## Current public modules

These retain-domain files from #1536 moved without changing their behavior. The old paths
below are relative to `workers/edge/src/agent/`; no forwarding modules remain there.

| Old path | Current source | Responsibility |
|---|---|---|
| `memory/trusted-text.ts` | `src/trusted-text.ts` | Control characters and UTF-8 byte bounds |
| `session/status-value.ts` | `src/status-value.ts` | Status structure injection bounds |
| `egress/host-address.ts` | `src/host-address.ts` | Literal host/address classification |
| `tools/anitabi-image-proxy.ts` | `src/anitabi-image-proxy.ts` | Public screenshot URL projection |
| `tools/localized-city-name.ts` + `tools/city-names.json` | Same basenames under `src/` | Localized display names and unchanged corpus |
| `tools/title-variant-conflict.ts` | `src/title-variant-conflict.ts` | Wrong-season/title variant checks |
| `tools/web-source-tier.ts` | `src/web-source-tier.ts` | Domain-based web-source trust |
| `selection/selection-copy.ts` | `src/selection-copy.ts` | Localized deterministic outcomes |

## Migration boundary

The exhaustive historical source list and delete/rewrite obligations remain in
[the #1536 disposition](../../docs/iterations/production-readiness-2026-08/AGENT-FILE-DISPOSITION.md).
Its 47 delete and 43 rewrite-domain rows remain in edge until their owning stories replace
their consumers. They are not copied here. #1545 owns SDK composition; #1547 owns native
tools/credentials; #1548 owns domain memory hooks; #1551 owns deterministic selections;
#1552 owns legacy history reads; #1553 removes the old engine after cutover.

The remaining retain-domain rules stay at their existing edge paths with the consumer migrations
below. The table records each current consumer boundary and its owning card. Several leaves
already run without platform dependencies; their owners can relocate the plain rules when
replacing those consumers.

| Path under `workers/edge/src/agent/` | Current boundary / owner |
|---|---|
| `byok/byok-family.ts` | Browser/provider vocabulary still coupled to old credential construction; #1547 |
| `egress/egress-decision.ts` | Current guard's error class; native transport policy in #1547 |
| `egress/egress-policy.ts` | Current class-based guarded transport; #1547 |
| `egress/provider-allowlist.ts` | Current guard's policy object; #1547 |
| `egress/secret-scrub.ts` | Current credential scrubbing object; #1547 |
| `egress/web-search-egress.ts` | Current GuardedFetch construction; #1547 |
| `intake/anonymous-message-allowance.ts` | Edge identity and quota admission; #1546 |
| `intake/quota-reservation.ts` | Edge payer and business accounting; #1546 |
| `memory/rescued-entity.ts` | Current result/memory integration; #1548 |
| `retrieval/issuing-run.ts` | Isolated historical decoder, never a new-session interface; #1552 |
| `selection/merged-works.ts` | Current catalog result carrier; native selection in #1551 |
| `selection/selection-request.ts` | Browser HTTP validation remains at the edge; #1551 |
| `tools/catalog-title-translation.ts` | Current catalog client boundary; #1547 |
| `tools/duckduckgo-result-page.ts` | Current WebResult carrier; #1547 |
| `tools/search-result-payload.ts` | Current tool-result carrier; #1547 |
| `tools/web-result-trust.ts` | Current WebResult carrier; #1547 |

Future Node eval consumers import this public package. The existing `packages/eval` dependency
on `edge-worker` still has API-test readers and is removed by their owning migration, not by
this extraction. Node eval, conformance and test infrastructure must never become production
imports of this package or enter the Worker artifact.

## Verification

`pnpm lint`, `pnpm typecheck` and `pnpm test` are the same package scripts selected by local
and PR affected gates. Coverage is written to `coverage/lcov.info` and uploaded by the PR
matrix. Root type-aware lint includes this package explicitly. Edge has a real `workspace:*`
dependency, so pnpm's dependent closure selects its tests and the existing CD edge cohort.

The boundary test reads TypeScript's resolved graph and pnpm's consumer closure. Edge's
bundle smoke checks the production artifact graph and runs public domain behavior in workerd.
