/** Atlas v0.30 chain reader: atlas.sum order, version = prefix before `_`. */

export interface ChainSource {
  atlasSum(): string;
  file(name: string): string;
}

export interface ChainFile {
  filename: string;
  version: string;
  description: string;
  hash: string;
  body: string;
}

export function mapSource(sum: string, files: Readonly<Record<string, string>>): ChainSource {
  return { atlasSum: () => sum, file: (name) => bodyOf(files, name) };
}

export function filesFrom(source: ChainSource): ChainFile[] {
  return parseSum(source.atlasSum()).map((entry) => ({
    ...entry,
    ...splitFilename(entry.filename),
    body: source.file(entry.filename),
  }));
}

/**
 * The ledger heads this chain can reach, in atlas.sum order. Read from
 * atlas.sum alone: the migration handshake (#1365) asks which versions the
 * bundle carries, never what their bodies say, so no file body is loaded.
 */
export function headsOf(source: ChainSource): string[] {
  return parseSum(source.atlasSum()).map((entry) => headOf(splitFilename(entry.filename)));
}

/** The head a chain file leaves in the ledger — `ledger.ts`'s `version_description`. */
export function headOf(file: { version: string; description: string }): string {
  return file.description.length === 0 ? file.version : `${file.version}_${file.description}`;
}

export function parseSum(text: string): { filename: string; hash: string }[] {
  return text.split("\n").flatMap(parseSumLine);
}

export function splitFilename(filename: string): { version: string; description: string } {
  const base = filename.endsWith(".sql") ? filename.slice(0, -4) : filename;
  const cut = base.indexOf("_");
  if (cut < 0) return { version: base, description: "" };
  return { version: base.slice(0, cut), description: base.slice(cut + 1) };
}

function parseSumLine(line: string): { filename: string; hash: string }[] {
  const trimmed = line.trim();
  const cut = trimmed.indexOf(" h1:");
  if (cut <= 0 || !trimmed.slice(0, cut).endsWith(".sql")) return [];
  return [{ filename: trimmed.slice(0, cut), hash: trimmed.slice(cut + 1) }];
}

function bodyOf(files: Readonly<Record<string, string>>, name: string): string {
  const body = files[name];
  if (body === undefined) throw new Error("missing bundled migration");
  return body;
}
