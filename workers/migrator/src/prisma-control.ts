import { createPostgresControlClient, type ControlClient } from "@prisma/orm-postgres/control";
import { defineConfig } from "@prisma/orm-postgres/config";
import { readContractSnapshotJson } from "@prisma/orm-postgres/migration-tools/contract-snapshot-store";
import { executeMigrateShowPlan, type MigrateShowMigration } from "@prisma/orm-toolchain/cli/control-api";
import { PRISMA_MIGRATIONS_DIR, validPrismaRef } from "./prisma-target";
import { assertDirectDsn } from "./sql";

export interface PrismaPreview {
  targetHash: string;
  markerHash: string;
  migrations: readonly MigrateShowMigration[];
  usedLiveMarker: boolean;
}

export type PrismaReceipt = Extract<Awaited<ReturnType<ControlClient["migrate"]>>, { ok: true }>["value"];
export type NativeResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** The official show API ends before its DDL/marker boundary. */
export async function previewPrisma(dsn: string, ref: string, directory = PRISMA_MIGRATIONS_DIR): Promise<NativeResult<PrismaPreview>> {
  assertDirectDsn(dsn);
  if (!validPrismaRef(ref)) return { ok: false, error: "invalid_prisma_ref" };
  const config = defineConfig({ contract: `${directory}/snapshots/${ref}/contract.json`, migrations: { dir: directory } });
  const result = await executeMigrateShowPlan({ config, cwd: "/bundle", db: dsn, to: ref });
  if (!result.ok) return { ok: false, error: result.failure.code };
  const { migrations, renderMarkerHashBySpace, usedLiveMarker } = result.value;
  const markerHash = renderMarkerHashBySpace.get("app");
  if (markerHash === undefined) return { ok: false, error: "prisma_marker_unavailable" };
  return { ok: true, value: { targetHash: ref, markerHash, migrations, usedLiveMarker } };
}

/** Prisma owns graph traversal, per-migration transactions, locking and markers. */
export async function migratePrisma(dsn: string, ref: string, directory = PRISMA_MIGRATIONS_DIR): Promise<NativeResult<PrismaReceipt>> {
  assertDirectDsn(dsn);
  if (!validPrismaRef(ref)) return { ok: false, error: "invalid_prisma_ref" };
  const contract = await readContractSnapshotJson(directory, ref);
  const client = createPostgresControlClient();
  try {
    await client.connect(dsn);
    const result = await client.migrate({ contract, migrationsDir: directory, refHash: ref });
    return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.failure.code };
  } finally {
    await client.close();
  }
}
