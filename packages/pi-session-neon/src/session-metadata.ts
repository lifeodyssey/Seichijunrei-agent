import type { SessionMetadata } from "@earendil-works/pi-agent-core/harness/session";
import type { SessionReader } from "./database.ts";

export const NEON_STORAGE_VERSION = 1;

export function requireStorageVersion(metadata: SessionMetadata): SessionMetadata {
  if (metadata.storageVersion !== NEON_STORAGE_VERSION) {
    throw new Error(`Unsupported session storage version: ${String(metadata.storageVersion)}`);
  }
  return metadata;
}

export async function readMetadata(db: SessionReader, id: string): Promise<SessionMetadata> {
  const row = await db.orm.public.PiSession.select("metadata").first({ id });
  if (row === null) throw new Error(`Unknown session: ${id}`);
  return requireStorageVersion(row.metadata as unknown as SessionMetadata);
}
