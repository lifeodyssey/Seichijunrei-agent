# Native agent replacement evidence

The 82-row W2 map described the retired custom engine. It is superseded by the accepted
[Pi harness spec](../specs/2026-09-09-agent-on-pi-harness-spec.md) and #1553's native deletion
criteria. Git history retains the original W2 checklist; its old filenames are not a
requirement to preserve a duplicate runtime. This page records source test locations, not
owner ticks, deployment status or fabricated platform acceptance.

| Product behavior | Native source | Behavioral evidence |
|---|---|---|
| Public identity, Turnstile and rate limits | `workers/edge/src/gateway/`, `identity/`, `protect/` | `workers/edge/test/operation-reachability.test.ts`, `turnstile-arm.test.ts` |
| Ownership, idempotency and quota | `workers/edge/src/agent/admission/` | `workers/edge/admission-test/admit.test.ts`, `deleted-conversation.test.ts` |
| Fault reattachment, durable recovery and lost BYOK | `workers/edge/src/agent/host/` | `workers/edge/host-integration-test/default-host.test.ts`, `policies.test.ts` |
| Independent settlement obligation | `workers/edge/src/agent/settlement/native-settlement.ts` | `workers/edge/host-integration-test/independent-settlement.test.ts` |
| Native replay and authorization | `packages/agent/src/tool-context.ts` | `packages/agent/test/native-replay.test.ts`, `native-replay-effects.test.ts` |
| Catalog, routes and references | `packages/agent/src/tools.ts` | `packages/agent/test/native-result-refs.test.ts`, `native-route-integrity.test.ts` |
| Clarifications and deterministic selection | `packages/agent/src/selection.ts` | `packages/agent/test/native-selection-replan.test.ts`, `workers/edge/selection-test/selection.test.ts` |
| Facts, frozen summaries and injection-safe context | `packages/agent/src/native-context-hooks.ts` | `packages/agent/test/native-executed-facts.test.ts`, `native-summary-reopen.test.ts`, `native-selection-context.test.ts` |
| Native history, executed arguments and streaming | `workers/edge/src/agent/views/` | `workers/edge/test/native-history.test.ts`, `native-watch-response.test.ts` |
| Raw native Eval output, observations and outcomes | `packages/eval/src/native/` | `packages/eval/test/native-production-composition.test.ts`, `native-task-observations.test.ts`, `native-task-outcomes.test.ts` |

Run database lanes serially against disposable PostgreSQL, using the package guides.
Actual production resources, browser journeys, APAC timing, crash/reconnect scenarios and
the full accepted criteria still require their own recorded results. Native E1 command,
prefix fork corpus, calibrated judge and real-model suites are not complete merely because
old prefix endpoints and transcript adapters were deleted. See #1545, #1552, #1553, #1557,
#1558 and #1559 for those ownership boundaries.

The owner clarified on 2026-09-10 that production needs no backward compatibility. History
reads only native committed entries; this does not authorize deleting applied Atlas
migrations or online data. No legacy SQL history converter is retained.
