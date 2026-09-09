import { validPrismaRef } from "./prisma-target";

export const MAX_PREFLIGHT_BYTES = 65_536;

export interface MigrationChecksum {
  version: string;
  description: string;
  hash: string;
}

export interface PreflightMetadata {
  expectedHead: string;
  stagingOnlyBaseline: boolean;
  entries: readonly MigrationChecksum[];
  expectedPrismaRef?: string;
}

interface MetadataBody {
  expectedHead: string;
  atlasSum: string;
  stagingOnlyBaseline: boolean;
  expectedPrismaRef?: string;
}

/** Atlas stores bare SHA-256 base64; the HTTP executor adds only `h1:`. */
export function canonicalHash(value: string): string | undefined {
  const hash = value.startsWith("h1:") ? value.slice(3) : value;
  if (!/^[A-Za-z0-9+/]{43}=$/.test(hash)) return undefined;
  return btoa(atob(hash)) === hash ? hash : undefined;
}

function checksumEntry(line: string): MigrationChecksum | undefined {
  const match = /^(\d{14})_([a-z0-9][a-z0-9_]*)\.sql h1:([A-Za-z0-9+/]{43}=)$/.exec(line);
  if (!match) return undefined;
  const [, version, description, encoded] = match;
  if (version === undefined || description === undefined || encoded === undefined) return undefined;
  const hash = canonicalHash(encoded);
  return hash === undefined ? undefined : { version, description, hash };
}

function checksumEntries(sum: string): MigrationChecksum[] | undefined {
  const lines = sum.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const header = lines.shift();
  if (!header?.startsWith("h1:") || canonicalHash(header) === undefined) return undefined;
  const entries = lines.map(checksumEntry);
  if (entries.length === 0 || entries.some((entry) => entry === undefined)) return undefined;
  return entries.filter((entry) => entry !== undefined);
}

function ordered(entries: readonly MigrationChecksum[]): boolean {
  return entries.every((entry, index) => index === 0 || entry.version > (entries[index - 1]?.version ?? ""));
}

function metadataKeys(value: object): boolean {
  const keys = Object.keys(value).filter((key) => key !== "expectedPrismaRef");
  if (keys.sort().join(",") !== "atlasSum,expectedHead,stagingOnlyBaseline") return false;
  return !("expectedPrismaRef" in value) || validPrismaRef(value.expectedPrismaRef);
}

function metadataBody(value: unknown): value is MetadataBody {
  if (typeof value !== "object" || value === null || !metadataKeys(value)) return false;
  return "expectedHead" in value && typeof value.expectedHead === "string" &&
    "atlasSum" in value && typeof value.atlasSum === "string" &&
    "stagingOnlyBaseline" in value && typeof value.stagingOnlyBaseline === "boolean";
}

function decodeBody(value: unknown): PreflightMetadata | undefined {
  if (!metadataBody(value)) return undefined;
  const entries = checksumEntries(value.atlasSum);
  const last = entries?.at(-1);
  if (!entries || !last || !ordered(entries)) return undefined;
  if (value.expectedHead !== `${last.version}_${last.description}`) return undefined;
  return { expectedHead: value.expectedHead, stagingOnlyBaseline: value.stagingOnlyBaseline, entries,
    ...(value.expectedPrismaRef === undefined ? {} : { expectedPrismaRef: value.expectedPrismaRef }) };
}

/** Decode verified-artifact metadata, never SQL or caller-selected connectivity. */
export function parsePreflightMetadata(raw: string): PreflightMetadata | undefined {
  if (new TextEncoder().encode(raw).byteLength > MAX_PREFLIGHT_BYTES) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    return decodeBody(value);
  } catch {
    return undefined;
  }
}
