# packages/agent — AGENTS.md

`@animichi/agent` is the TypeScript agent domain library. The root exports ordinary functions,
constants and public contract data without runtime SDK/schema imports. Native tools are exposed
through `@animichi/agent/tools`, native model composition through `@animichi/agent/models`,
and direct SDK harness composition through `@animichi/agent/harness`.
Keep these package entrypoints separate so pure consumers retain their existing bundle boundary.
`workers/edge` remains the deployable host; Python
`apps/agent` is a separate workspace named `@animichi/agent-python` until W4 retirement.

## Commands

From this directory: `pnpm lint`, `pnpm typecheck`, `pnpm test`.
From root: `pnpm --filter @animichi/agent test`.

Tests use Node's native test runner with `tsx` and import the package's public entrypoints. Coverage includes
real `packages/agent/src/**/*.ts` files from the repo root, emits `coverage/lcov.info`, and enforces 95% lines/functions/branches.
`test/package-boundary.test.ts` also checks the compiler's resolved graph and pnpm's real
consumer closure. Edge's `test:bundle-smoke` builds the production consumer and executes a
small public-package consumer in workerd.

## Boundaries

- ESM TypeScript source exports work after `pnpm install --frozen-lockfile --ignore-scripts`;
  consumers must not depend on an unbuilt `dist` directory.
- No Cloudflare, Durable Object, gateway, API-test, staging seed, eval or Node runtime imports
  in `src/`. Oxlint's native restricted-import rule enforces these source boundaries.
- Use dependency-owned public types and ordinary domain data. Do not introduce a copied
  session/message/result model, generic port, compatibility facade or alternate agent engine.
- Harness composition returns SDK objects directly. Native Neon storage lives
  in `packages/pi-session-neon`; authenticated HTTP, admission/quota and hosting stay in edge.
- Keep new domain behavior covered through named public exports. The package README records
  current modules and the old consumer-bound rules waiting for their owning migration cards.
- Follow root 1-10-50, no suppression, no `any`, and test files at most 200 lines.
