import contract from "@animichi/pi-session-neon/contract";
import { readContractSnapshotJsonTolerant } from "@prisma/orm-postgres/migration-tools/contract-snapshot-store";

export const PRISMA_TARGET = contract.storage.storageHash;
export const PRISMA_MIGRATIONS_DIR = "/bundle/migrations";

/** The request selects a sealed native snapshot, never a filesystem path. */
export function validPrismaRef(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export async function hasPrismaSnapshot(ref: string, directory = PRISMA_MIGRATIONS_DIR): Promise<boolean> {
  if (!validPrismaRef(ref)) return false;
  return await readContractSnapshotJsonTolerant(directory, ref) !== undefined;
}
