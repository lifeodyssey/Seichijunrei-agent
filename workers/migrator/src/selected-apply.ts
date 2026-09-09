import { NeonDbError } from "@neondatabase/serverless";
import { assertDirectDsn } from "./sql";
import { applyChain, type ApplyInput } from "./http-apply";
import { parseSum, type ChainSource } from "./chain";
import type { ContainerOutcome } from "./migration";
import { compareMigrationPrefix } from "./preflight-compatibility";
import { readRevisionSnapshot } from "./preflight-ledger";
import { canonicalHash, type PreflightMetadata } from "./preflight-metadata";

function matchesBundle(source: ChainSource, metadata: PreflightMetadata): boolean {
  const bundled = parseSum(source.atlasSum()).slice(0, metadata.entries.length);
  return bundled.length === metadata.entries.length && metadata.entries.every((entry, index) =>
    bundled[index]?.filename === `${entry.version}_${entry.description}.sql` &&
    canonicalHash(bundled[index].hash) === entry.hash);
}

function failed(error: unknown): ContainerOutcome {
  if (error instanceof NeonDbError && error.code === "42P01") return { kind: "refused", reason: "ledger_missing" };
  return { kind: "failure", exitCode: 1, error: "migration_unavailable" };
}

async function applyCompatible(input: ApplyInput, metadata: PreflightMetadata): Promise<ContainerOutcome> {
  assertDirectDsn(input.dsn);
  if (!matchesBundle(input.source, metadata)) return { kind: "refused", reason: "bundle_checksum_mismatch" };
  const compatible = compareMigrationPrefix(metadata, await readRevisionSnapshot(input.dsn));
  if (!compatible.compatible) return { kind: "refused", reason: compatible.error };
  const outcome = await applyChain({ ...input, expectedHead: metadata.expectedHead });
  return outcome.kind === "failure" ? { kind: "failure", exitCode: outcome.exitCode, error: "migration_failed" } : outcome;
}

/** Called only while the fixed apply Durable Object holds its concurrency gate. */
export async function applySelectedChain(input: ApplyInput, metadata: PreflightMetadata): Promise<ContainerOutcome> {
  try {
    return await applyCompatible(input, metadata);
  } catch (error) {
    return failed(error);
  }
}
