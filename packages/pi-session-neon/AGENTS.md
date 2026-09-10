# pi-session-neon — AGENTS.md

Native Pi storage schema and agent business obligations. Root guide: `../../AGENTS.md`.
Prisma 8 owns the seven new agent tables through `src/contract.prisma` and native
`migrations/`. Atlas SQL in `../../migrations/neon/` owns all pre-existing objects.
No object has two migration owners; preserve all applied Atlas SQL byte for byte.

- `pnpm run lint` — type-aware oxlint, warnings denied.
- `pnpm run typecheck` — TypeScript 7.
- `pnpm run test:integration` — Node's test runner, one disposable test-postgres container.
  `--test-isolation=none` shares the imported setup and serial tests; each test resets that
  disposable database. Never point these tests at a live Neon database.
  Node's native coverage enforces 95% lines on `src/` and writes `coverage/lcov.info` for CI.

The owner approved two declaration-style exceptions on 2026-09-10: generated
`src/contract.d.ts` and `migrations/snapshots/*/contract.d.ts` may retain Prisma's native
`consistent-type-definitions` and `no-empty-object-type` output. Package `.oxlintrc.json`
limits those exceptions to these files. All other lint rules, editable migrations and
application code remain checked; TypeScript keeps `skipLibCheck: false`.

The contract stores published Pi 0.85.1 `Entry`, `UsageRow` and `SessionMetadata` directly.
Do not create a custom Session, transcript converter, TurnStore or operation state machine.
The complete Storage/SessionRepo implementation and upstream conformance belong to #1541.
The business SQL examples under `test/` prove schema constraints and PostgreSQL transactions;
production admission, recovery and settlement must test their actual writers in their own cards.

`@animichi/test-postgres`, `pg` and Node APIs are test-only. Future production code must use
Neon's supported Worker transport and return upstream `StorageBackedSession`.

Author contract changes in Prisma's PSL, run `contract:emit`, then use native `migration plan`
with an explicit origin when no development ref exists. Regenerate edited native migrations
by running their rendered `migration.ts`; never hand-edit generated hashes or SQL bundles.
Use the public `rawSql` migration operation only for PostgreSQL grants that Prisma's contract
planner does not express. Runtime record validation belongs to native Pi session APIs.

Existing Atlas migrations are immutable. The two unpublished #1539 draft migrations were
replaced by this native Prisma migration. No old-table retirement is authorized by #1539.
