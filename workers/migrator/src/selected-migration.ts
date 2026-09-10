import { NeonDbError } from "@neondatabase/serverless";
import { productionChain } from "./bundled-chain";
import { parseSum } from "./chain";
import { applyChain } from "./http-apply";
import { NeonMigrationsLedger } from "./ledger";
import { runMigration, type MigrationRunResult } from "./migration";
import { compareMigrationPrefix, type MigrationCompatibility } from "./preflight-compatibility";
import { readRevisionSnapshot } from "./preflight-ledger";
import { canonicalHash, type PreflightMetadata } from "./preflight-metadata";
import { hasPrismaSnapshot, PRISMA_MIGRATIONS_DIR } from "./prisma-target";
import { migratePrisma, previewPrisma, type PrismaPreview, type PrismaReceipt } from "./prisma-control";
import { assertDirectDsn, neonClient } from "./sql";

export type SelectedMetadata = PreflightMetadata & { expectedPrismaRef: string };
export type SelectedPreflight =
  | (Extract<MigrationCompatibility, { compatible: true }> & { prisma: PrismaPreview })
  | { compatible: false; error: string };
export type SelectedMigration = MigrationRunResult & { prisma?: PrismaReceipt };
export interface SelectedExecutor {
  preflight(dsn: string, metadata: SelectedMetadata): Promise<SelectedPreflight>;
  migrate(dsn: string, metadata: SelectedMetadata): Promise<SelectedMigration>;
}

function matchesBundle(metadata: PreflightMetadata): boolean {
  const bundled = parseSum(productionChain.atlasSum()).slice(0, metadata.entries.length);
  return bundled.length === metadata.entries.length && metadata.entries.every((entry, index) =>
    bundled[index]?.filename === `${entry.version}_${entry.description}.sql` &&
    canonicalHash(bundled[index].hash) === entry.hash);
}

function unavailable(error: unknown): SelectedPreflight {
  if (error instanceof NeonDbError && error.code === "42P01") return { compatible: false, error: "ledger_missing" };
  return { compatible: false, error: "preflight_unavailable" };
}

async function checkSelected(dsn: string, metadata: SelectedMetadata, directory: string): Promise<SelectedPreflight> {
  assertDirectDsn(dsn);
  if (!matchesBundle(metadata)) return { compatible: false, error: "bundle_checksum_mismatch" };
  if (!await hasPrismaSnapshot(metadata.expectedPrismaRef, directory)) return { compatible: false, error: "stale_prisma_bundle" };
  const atlas = compareMigrationPrefix(metadata, await readRevisionSnapshot(dsn));
  if (!atlas.compatible) return atlas;
  const native = await previewPrisma(dsn, metadata.expectedPrismaRef, directory);
  return native.ok ? { ...atlas, prisma: native.value } : { compatible: false, error: native.error };
}

/** Both routes call this inside the same fixed Durable Object gate. */
export async function preflightSelected(dsn: string, metadata: SelectedMetadata, directory = PRISMA_MIGRATIONS_DIR): Promise<SelectedPreflight> {
  try { return await checkSelected(dsn, metadata, directory); }
  catch (error) { return unavailable(error); }
}

async function applyAtlas(dsn: string, expectedHead: string): Promise<MigrationRunResult> {
  const result = await runMigration(dsn, {
    runContainer: () => applyChain({ dsn, source: productionChain, connect: neonClient, now: () => new Date(), expectedHead }),
    readAppliedHead: (connection) => new NeonMigrationsLedger().readAppliedHead(connection),
  }, expectedHead);
  if (result.kind === "success" && result.appliedHead !== expectedHead) return { kind: "refused", reason: "atlas_head_mismatch" };
  return result;
}

async function applySelected(dsn: string, metadata: SelectedMetadata, directory: string): Promise<SelectedMigration> {
  const preview = await checkSelected(dsn, metadata, directory);
  if (!preview.compatible) return { kind: "refused", reason: preview.error };
  const atlas = await applyAtlas(dsn, metadata.expectedHead);
  if (atlas.kind !== "success") return atlas;
  const native = await migratePrisma(dsn, metadata.expectedPrismaRef, directory);
  if (!native.ok) return { kind: "failure", exitCode: 1, error: native.error };
  if (native.value.markerHash !== metadata.expectedPrismaRef) return { kind: "failure", exitCode: 1, error: "prisma_marker_mismatch" };
  return { ...atlas, prisma: native.value };
}

/** Recheck both owners after acquiring the lock; a prior preview is no authority. */
export async function migrateSelected(dsn: string, metadata: SelectedMetadata, directory = PRISMA_MIGRATIONS_DIR): Promise<SelectedMigration> {
  try { return await applySelected(dsn, metadata, directory); }
  catch { return { kind: "failure", exitCode: 1, error: "migration_unavailable" }; }
}
