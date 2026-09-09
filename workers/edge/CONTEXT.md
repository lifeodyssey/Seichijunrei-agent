# Edge

Two things live in this package. **The request gateway**: identity, rate limits, routing to Catalog / Users / Agent container, image and tile proxies. **The agent tier** (`src/agent/`, W1): behind `AGENT_TURN_ROUTE = "edge"` this Worker answers the chat turn, the BYOK probe and the transcript GET itself (`edgeTierRoute` in `src/gateway/routing-policy.ts`) — intake writes the turn to Neon in one transaction, an `AgentSession` Durable Object runs it inside its own `alarm()`, and settlement closes the run. Every other value of the flag forwards the turn to the Python container instead.

**Tier:** Gateway for the pilgrimage contexts — it **does not own** Point, Bangumi, Itinerary, or SavedRoute, and has **no `src/domain/`**. The agent-turn vocabulary below is the one model it does own, ported from `apps/agent` per `docs/specs/2026-09-01-agent-ts-rewrite-spec.md`.

Plain agent-domain rules live in `packages/agent` and are imported through `@animichi/agent`.
The runtime terms here describe the existing edge host until native SDK cutover; they are not
interfaces to copy into that package.

Structure (implemented): `src/` production (entry/app/env + agent/db/identity/gateway/protect/proxy/container), `test/` + `test/doubles/` (node:test).
Design docs: `docs/specs/2026-08-06-edge-gateway-structure-design.md` (gateway) · `docs/specs/2026-09-01-agent-ts-rewrite-spec.md` (agent tier)

Greenfield path strings:
`docs/specs/2026-08-06-greenfield-language-and-data-plane.md`

## Domain model?

**No pilgrimage model.** Gateway vocabulary, plus the agent-turn terms the tier brought with it:

| Term | Means |
|---|---|
| **Identity** | Who is calling (anon / JWT sub / API key) — not Agent Session |
| **Forward** | Pass /v1 to Catalog, Users, or Agent container with injected headers |
| **Policy** | Pure path allowlists / rate-limit scope — not business rules |
| **Proxy** | Image / tiles / R2 — not catalog SQL |
| **Container** | Python agent runtime lifecycle — not a pilgrimage entity |
| **Run** | One chat turn's durable execution on the agent tier: `running` → `succeeded` / `failed`, with `(run_id, step_index)` steps |
| **Settlement** | How a run ENDS — terminal row + `daily_usage` rollup + quota refund, on the session's own transaction |

## Owns / does not own

| Owns | Does not own |
|---|---|
| Authn at edge, rate limits, turnstile, forwarding | Itinerary planning, SavedRoute CRUD |
| Container env / egress denylist config | HTML pages (apps/web) |
| The agent turn behind the flag: intake, `AgentSession` DO, run settlement | Catalog master data — it calls Catalog for it |
