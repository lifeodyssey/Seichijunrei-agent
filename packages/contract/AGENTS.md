# packages/contract — AGENTS.md

Shared oRPC/Zod contract and single source of truth for catalog/users wire types. The catalog
Worker and Python agent keep deliberate hand-mirrors where bundling or sentinel defaults require
them. Root guide: `../../AGENTS.md`; detailed mirror checklist: `README.md`.

## Commands (from `packages/contract/`)

- `pnpm run lint` / `pnpm run lint:oxlint` — type-aware oxlint over `src/` and `scripts/`, warnings
  denied. That is the package's TypeScript program: `tsconfig.json` does not include `test/`, so a
  type-aware pass there would report on `any` (bringing the tests into the program is a separate
  outcome — `tsc` has ~60 findings under them today).
- `pnpm run typecheck` — TypeScript 7.0.2 `tsc --noEmit`.
- `pnpm test` — vitest, then the compat gate (`vet:baseline`) and the OpenAPI drift check
  (`test:openapi-drift`). One command, the same one CI runs (#1358).
- `pnpm run emit:openapi` — regenerate `openapi.json`, `users-openapi.json`, and `agent-openapi.json`.
- `pnpm run emit:tool-schemas` — regenerate `src/agent-tool-schemas.ts` from
  `src/agent-tool-parameters.ts`. This is the repo's **single** zod↔JSON-Schema conversion
  (agent TS rewrite spec §二, "schema 边界"): the agent's four catalog tool parameter schemas, the
  two web tools' (`web_search`, `translate_anime_title`, #1287) and the `respond` answer tool's are
  declared here in zod — the catalog ones composed from the catalog's own request constraints, the
  web ones composing nothing because there is no second declaration for them to agree with — and
  `workers/edge` consumes the generated module without loading zod. The module
  also carries `ANSWER_TOOL_NAME` and `CHAT_RESPONSE_INTENTS` (read off `ChatResponseDataPart`'s
  own union, #1283) for the same reason — the Worker names the tool and builds the part but cannot
  load zod to learn either vocabulary. `test/agent-tool-schemas.test.ts` fails on committed drift,
  the way the OpenAPI documents do; `test/chat-answer-part.test.ts` parses what the edge's
  projection actually emits. Never hand-edit the generated file.
- `pnpm run vet:openapi <baseline.json> <candidate.json>` — OpenAPI compat gate
  (issue #1005 AC4/AC5): fails on unapproved breaking changes, approves additive
  ones, and rejects a future major path unless its superseded operation carries
  `deprecated: true` + `x-sunset`. `--allow-breaking` is the explicit approval
  flag — never pass it in the normal CI gate.

OpenAPI emission is byte-stable: JSON is pretty-printed with one trailing newline. Regenerate on
every contract change and commit all three outputs. `pnpm test` reruns emission and fails on
committed drift (`scripts/local-gates/contract-drift.sh`), then runs `vet:openapi` for each document
against the merge-base baseline (the published contract) through `scripts/vet-openapi-baseline.ts` —
unapproved breaking `/v1` changes fail closed there, locally and in CI alike. The baseline is always
the merge base's own copy of the document, never the source head's: a document the merge base does
not carry is brand-new, so it gets an empty `{"paths": {}}` baseline that approves every operation in
it as additive, while a merge base the repository cannot read at all — missing tree or blob, shallow
clone, corrupt object — exits 1 rather than approving an unreviewed deletion. The merge base is
`HEAD` against `CONTRACT_BASE_REF` (default `origin/main`), so a checkout without that ref fails
closed too; fetch the base branch before running the gate. The retired check-in/share bootstrap
fallback (#1005 AC3) was deleted in #1347 once every branch was post-cut.

## Conventions

- Zod schemas and oRPC contracts live in `src/`; export public types through `src/index.ts`.
- `zod@4.4.3` and `@orpc/*@1.14.10` are one coupled exact-pin set across this package,
  `workers/catalog`, `workers/users`, and `apps/web`. Change them together.
- Catalog internals use type-only hand-mirrors so Zod stays out of the Worker bundle; Python models
  remain hand-written because their sentinel defaults intentionally differ.
- Semantic contract freeze is the red line: do not change wire meaning without an approved story.
  Formatting churn is acceptable only when the OpenAPI drift check stays green.

## Key files + entrypoints

- `src/models.ts` — shared Zod data models.
- `src/agent-paths.ts` — `AGENT_PATHS`, the complete Agent HTTP path inventory ·
  `src/identity-policy.ts` — `DEFAULT_IDENTITY_POLICY`, the deployed identity matrix ·
  `test/import-free-modules.test.ts` — the gate over both. `workers/edge` reads these two
  documents at RUNTIME, so they are declared apart from the zod modules that give them meaning
  (`agent-contract.ts`, `identity-contract.ts`), which do NOT re-export them: a value import from
  a zod module pulls all 79 of zod's files into the Worker bundle (#1285, measured by
  `workers/edge/bundle-smoke/entry-bundle.test.ts`). Nothing is generated and nothing is mirrored
  — each is the one declaration, and the emitters, the edge and the drift tests all read it there.
- `src/agent-tool-parameters.ts` — the agent's catalog tool parameters, the two web tools' and the
  `respond` answer tool's, in zod (not a wire type: no oRPC procedure and no OpenAPI document references them) ·
  `src/agent-tool-schemas.ts` — their generated JSON Schema · `scripts/emit-tool-schemas.ts` — the
  conversion · `test/agent-tool-schemas.test.ts` — its drift gate ·
  `test/chat-answer-part.test.ts` — the conformance gate on the edge's `data-response` projection.
- `src/staging-prefix-path.ts` — `STAGING_PREFIX_PATH_TEMPLATE` + `STAGING_APP_ENV`, import-free
  because `workers/edge` reads them at RUNTIME · `src/staging-prefix-contract.ts` — the frozen
  trajectory prefix body `packages/eval` posts (E-1 #1380). **Neither is emitted**: the procedure
  is mounted only where `APP_ENV === "staging"`, so the path stays out of `AGENT_PATHS` and out of
  every OpenAPI document — publishing it would document a route production must not have. The
  edge re-reads the same body by hand (`workers/edge/src/agent/session/trajectory-prefix.ts`, no zod in the
  bundle), and `workers/edge/test/trajectory-prefix-body.test.ts` parses one body through both
  readers so they cannot drift.
- `src/access-service-token.ts` — the Cloudflare Access service token every automated
  caller presents at staging (D3 #1369): the two variable names, the two header names,
  and the fail-closed reader that refuses a HALF-declared token. Import-free, like
  `staging-prefix-path.ts`, because its consumers are a Playwright config
  (`e2e/playwright.config.ts`), a Node lane door (`workers/edge/api-test/lane-origin.ts`)
  and — through that door — `packages/eval`, none of which should load zod to learn two
  header names. `test/access-service-token.test.ts` holds it; the values come from the
  `infra` stack output, never from anything checked in.
- `src/contract.ts` — catalog procedures and error attachments.
- `src/users-contract.ts` — users-service procedures and errors.
- `src/errors.ts` — canonical catalog error registry.
- `scripts/emit-openapi.ts` — deterministic OpenAPI emitter.
- `scripts/vet-openapi.ts` — OpenAPI compat gate CLI (baseline vs candidate) ·
  `scripts/vet-openapi-baseline.ts` — the merge-base baseline the package's `test` vets against.
- `openapi.json` · `users-openapi.json` · `agent-openapi.json` — committed generated wire artifacts.
- `src/openapi-changes.ts` · `src/openapi-schema-diff.ts` · `src/openapi-diff.ts` ·
  `src/openapi-vet.ts` · `test/openapi-diff-endpoints.test.ts` ·
  `test/openapi-diff-schemas.test.ts` · `test/openapi-diff-errors.test.ts` ·
  `test/openapi-gate.test.ts` · `test/vet-gate.test.ts` — change vocabulary, classifier,
  gate decisions, and the package-script wiring of the compat gate.

## Pitfalls

- Catalog errors move in three-mirror lockstep:
  `src/errors.ts` ↔ `workers/catalog/src/lib/errors.ts` ↔
  `apps/agent/src/animichi/clients/catalog_errors.py`.
- Extend `workers/catalog/test/contract-parity.worker.test.ts` and the Python error tests with any
  mirror change; do not rely on OpenAPI generation alone.
- Do not introduce runtime value imports into the catalog's type mirror.
