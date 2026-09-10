# Edge

This package owns the authenticated request gateway and the native Cloudflare SessionAgent
host. Chat, BYOK probing and history use the native tier. Catalog and Users retain their
service boundaries; the web Worker owns HTML. Remaining container support is not a fallback
for a failed native chat request.

Pilgrimage domain tools, facts, summaries and deterministic selections live in
`packages/agent`. Pi Session/AgentHarness/AgentLane own execution and committed history.
Prisma 8 and `NeonSessionRepo` persist native session storage and business obligations.
Cloudflare Agent schedules and keepAliveWhile own host wakeups and lifetime.

| Responsibility | Source |
|---|---|
| Identity, Turnstile, rate limits and forwarding | `src/identity/`, `src/protect/`, `src/gateway/` |
| Exclusive attachment, recovery registration and drive | `src/agent/host/` |
| Client-key admission and anonymous quota reservation | `src/agent/admission/` |
| Bounded durable obligation discovery | `src/agent/recovery/` |
| Immutable native usage/result settlement | `src/agent/settlement/native-settlement.ts` |
| Deterministic selection intents | `src/agent/selection/` |
| Native committed history and AI SDK stream projection | `src/agent/views/` |

The old run machine, envelope, lease sweeper, tool adapters and SQL history reader are
retired. Applied Atlas migrations remain intact; no legacy data is converted or dual-read.
Read `AGENTS.md` for gates and `../../docs/specs/2026-09-09-agent-on-pi-harness-spec.md`
for acceptance criteria. Source presence and local tests do not certify a deployed rollout.
