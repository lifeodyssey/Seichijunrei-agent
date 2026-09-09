# `agent-db-test/` — the edge's agent-tier database arm (W1-2, #1251)

Separate from `test/` on purpose, exactly as `bundle-smoke/` is: this lane needs
Docker and the offline `animichi-test-postgres` image, and it is the only place
that can answer for the two properties the intake rests on — dedupe is a partial
unique index and atomicity is the transaction itself, so a double could only
lie about either.

- `pnpm run test:agent-db` — boots a disposable PostgreSQL container, creates a clean
  database from `template1`, applies the committed `migrations/neon` Atlas
  chain, and runs the statements the production adapters run. No Neon
  credentials, no network. It runs the files **serially**
  (`--test-concurrency=1`): each one brings its own container, and starting
  them all at once leaves every container waiting past the port wait strategy's
  timeout. Budget roughly half a minute per file for the boot and the chain.
- Prerequisite (one-time, needs network):
  `docker build -f apps/agent/docker/test-postgres/Dockerfile -t animichi-test-postgres:18-3.6-pgvector-0.8.5 .`
- Not in the edge package's `test` chain, so **run it by hand before pushing
  agent-tier changes**. That chain is what CI's `CI / affected (edge-worker)`
  leg and the pre-push hook both run, and adding this arm to it means declaring
  the Postgres image as one of that lane's prerequisites — an owner call,
  tracked as a W1 follow-up. The chain's segments are pinned by
  `test/repo-config/package-test-segments.test.rb`.
- Test-only: it lives outside `src/`, so no Worker bundle can reach it
  (`packages/test-postgres/test/never-bundled.test.ts` proves it).
- Not `db-test/`, which is the W0-S4 spike's opt-in lane: that one is pointed at a
  database someone else provisioned (`SPIKE_TEST_DATABASE_URL`) and is deleted
  when the spike closes. This lane brings its own database and outlives W0.
