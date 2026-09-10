import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { QueueLock } from "../../src/lock";
import { migrateSelected, preflightSelected } from "../../src/selected-migration";
import { productionChain } from "../../src/bundled-chain";
import { makeApp, testEnv } from "../migrate.worker.helpers";
import { preflightRequest } from "../preflight-fixtures";
import { PRISMA_TARGET } from "../../src/prisma-target";

export const TARGET = PRISMA_TARGET;
export const MIGRATIONS = fileURLToPath(import.meta.resolve("@animichi/pi-session-neon/migrations"));
/** The sealed app chain's length, counted from the checked-in migrations —
 * count assertions pin this, never a literal that drifts with the next migration. */
export const APP_MIGRATION_COUNT = readdirSync(`${MIGRATIONS}/app`, { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
export const requestMetadata = { expectedHead: "20260904000000_platform_usage_scope",
  atlasSum: productionChain.atlasSum(), stagingOnlyBaseline: false, expectedPrismaRef: TARGET };

export async function nativeApp(dsn: string, directory = MIGRATIONS) {
  const lock = new QueueLock();
  const { app, token } = await makeApp({ chain: productionChain, migrationsDir: directory,
    selected: {
      preflight: (connection, metadata) => lock.runExclusive(() => preflightSelected(connection, metadata, directory)),
      migrate: (connection, metadata) => lock.runExclusive(() => migrateSelected(connection, metadata, directory)),
    },
  });
  const env = { ...testEnv(), MIGRATOR_DATABASE_URL: dsn };
  return {
    preview: () => app.request(preflightRequest(requestMetadata, token), {}, env),
    migrate: () => app.request(new Request("https://migrator.test/migrate", {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(requestMetadata),
    }), {}, env),
  };
}
