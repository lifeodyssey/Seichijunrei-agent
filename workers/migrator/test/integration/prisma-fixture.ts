import { fileURLToPath } from "node:url";
import { QueueLock } from "../../src/lock";
import { migrateSelected, preflightSelected } from "../../src/selected-migration";
import { productionChain } from "../../src/bundled-chain";
import { makeApp, testEnv } from "../migrate.worker.helpers";
import { preflightRequest } from "../preflight-fixtures";

export const TARGET = "da06cd8aaa95cd2a12b6ec7af3ccd003366dcdaa88e3c78dfd5578ecf323459a";
export const MIGRATIONS = fileURLToPath(import.meta.resolve("@animichi/pi-session-neon/migrations"));
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
