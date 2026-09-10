# Native recovery scanner database lane

`pnpm run test:agent-db` runs bounded selection, admission and settlement-obligation
queries through the production Prisma client against disposable PostgreSQL. The fixture
uses `@animichi/test-postgres` and the unchanged Atlas chain. Coordinate the Docker slot.

The old run-store, lease sweeper and Drizzle history tests are retired. Actual admission
and host behavior live in `admission-test/` and `host-integration-test/`; selection
transactions live in `selection-test/`. None of these tests may enter the Worker bundle.
No command here selects a hosted database or changes applied migrations.
