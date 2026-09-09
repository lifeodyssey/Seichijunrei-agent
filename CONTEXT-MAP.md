# Context map — Animichi

Multi-context monorepo. Glossaries are pure language (no implementation). Layout target: `docs/specs/2026-08-06-monorepo-target-layout.md`.

Consumer rules: `docs/agents/domain.md` (when present). Per-package `CONTEXT.md` files are **created lazily** when a term or decision is resolved — missing files are normal.

## Contexts

| Context | Glossary | Deployable / home |
| --- | --- | --- |
| **Contract** (published language) | [`packages/contract/CONTEXT.md`](./packages/contract/CONTEXT.md) | `packages/contract` |
| **Catalog** | [`workers/catalog/CONTEXT.md`](./workers/catalog/CONTEXT.md) | `workers/catalog` |
| **Users** | [`workers/users/CONTEXT.md`](./workers/users/CONTEXT.md) | `workers/users` |
| **Agent domain (TypeScript)** | [`packages/agent/CONTEXT.md`](./packages/agent/CONTEXT.md) | `packages/agent` (`@animichi/agent`), hosted by edge |
| **Agent runtime (Python)** | [`apps/agent/CONTEXT.md`](./apps/agent/CONTEXT.md) | `apps/agent` (`@animichi/agent-python`), retained until W4 |
| **Edge** | [`workers/edge/CONTEXT.md`](./workers/edge/CONTEXT.md) | `workers/edge` |
| **Web** | `apps/web/CONTEXT.md` (lazy) | `apps/web` |
| **Migrations** | `migrations/CONTEXT.md` (lazy) | `migrations/neon` (single authority, Atlas); `supabase/migrations/` is archived history (issue #1000) |
| **Infra** | `infra/CONTEXT.md` (lazy) | `infra` |
| **Auth appliance** | — | Neon Auth (Better Auth) integrated in `apps/web`; the edge verifies Neon JWKS only (AUTH-2 #950). `supabase/` is archived history, no package guide |
| **Browser E2E** | `e2e/CONTEXT.md` (lazy) | `e2e/` |

System-wide ADRs: `docs/adr/` (0002 published language · [0003 secrets architecture](./docs/adr/0003-secrets-architecture.md) · [0004 campaign merge](./docs/adr/0004-campaign-merge.md) · [0005 force-push policy](./docs/adr/0005-repo-force-push-policy.md) · [0006 platform over hand-written CI](./docs/adr/0006-platform-over-handwritten-ci.md)).

Greenfield (no dual wire names / table aliases):
[`docs/specs/2026-08-06-greenfield-language-and-data-plane.md`](./docs/specs/2026-08-06-greenfield-language-and-data-plane.md).

## Relationships

- **Web → Edge**: Browser talks only to the public edge (and its own Worker for SSR assets as configured).
- **Edge → Agent / Catalog / Users**: Gateway; Edge resolves **Identity** and owns no pilgrimage model.
  Since W1 it is also the **agent tier's host**: behind `AGENT_TURN_ROUTE = "edge"` a chat turn runs
  in Edge's own `AgentSession` DO against Neon instead of being forwarded to the Python container
  ([`docs/specs/2026-09-01-agent-ts-rewrite-spec.md`](./docs/specs/2026-09-01-agent-ts-rewrite-spec.md) §二–§三).
- **Edge → Agent domain**: Imports ordinary rules from `@animichi/agent`; platform hosting and the
  legacy runtime awaiting native cutover remain in edge. The [package guide](./packages/agent/README.md)
  identifies extracted rules and the remaining migration boundaries.
- **Agent → Catalog**: Customer–supplier; Agent needs Points / Bangumi / Itineraries; Catalog owns master data and planning.
- **Users → Catalog (by id only)**: **SavedRoute** stores `point_ids`, not Point rows; Users does not redefine Point.
- **Agent ↔ Users**: Claim anonymous **Session** / saved data after login (via Users APIs / product flows).
- **All → Contract**: Published language for cross-boundary DTOs; prefer glossary terms above over ad-hoc synonyms.

## Core vocabulary (cross-context)

| Term | Means | Avoid |
| --- | --- | --- |
| **Point** | Visitable seichi stop | PilgrimagePoint (legacy type name), Spot in contracts |
| **Bangumi** | One anime title in the catalog | Work, Anime-as-title |
| **Itinerary** | Computed ordered plan | bare Route |
| **SavedRoute** | User-owned saved record | bare Route |
| **Session** | Agent dialogue context | auth cookie “session” without qualifier |

## Domain model presence (skeleton refactor)

| Package | Pilgrimage `domain/` | Notes |
| --- | --- | --- |
| `workers/catalog` | **Yes** (target) | Full CA: domain / application / adapters |
| `packages/agent` | **Plain modules** | Platform-independent agent rules/data; no copied execution or storage engine |
| `apps/agent` | **Yes** (target) | Domain free of FastAPI/PydanticAI runtime imports |
| `workers/users` | **Shallow** | Pure rules + ports; no heavy DDD tree |
| `workers/edge` | **No pilgrimage domain** | Gateway tier: never `src/domain/` for Point / Bangumi / Itinerary / SavedRoute. Its `src/agent/` tier does own the **agent-turn** model (Session, Run, run step, settlement) — ported from `apps/agent` per [`docs/specs/2026-09-01-agent-ts-rewrite-spec.md`](./docs/specs/2026-09-01-agent-ts-rewrite-spec.md) §三, not a pilgrimage context |
| `apps/web` | **No** | UI — no `src/domain/` |
| `infra` | **No** | Topology / Cloudflare only |
| `packages/contract` | N/A | Published language, not a BC with domain/ |

Campaign: [#829](https://github.com/lifeodyssey/animichi/issues/829) · path tracker: [`docs/iterations/refactor-skeleton-2026-08/PATH-DELTA.md`](./docs/iterations/refactor-skeleton-2026-08/PATH-DELTA.md) · structure index: [`docs/specs/2026-08-06-structure-refactor-index.md`](./docs/specs/2026-08-06-structure-refactor-index.md).
