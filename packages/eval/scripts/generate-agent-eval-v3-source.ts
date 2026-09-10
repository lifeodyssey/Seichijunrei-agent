/**
 * Re-encodes the Python-era agent_eval_v3 corpus (662 cases) into the native
 * Logfire source format used by packages/eval/datasets/source/ (#1557).
 *
 * One case family, one file, following the translation_v1 precedent: `id` →
 * `name` (original order preserved 1:1), `query` → `inputs.prompt`,
 * expectations and the original per-case metadata ride in `metadata` as
 * `source_metadata`, `expected_output` stays null, and there are no per-case
 * evaluators. This is a SOURCE FORMAT migration only — no native task consumes
 * these files yet.
 *
 * Session payloads cannot be expressed by the E1 CLI ({prompt, locale} only),
 * so `context` and `selected_point_ids` are preserved in `metadata` as
 * `seeded_context` / `seeded_selected_point_ids`, and the sidecar
 * datasets/source/agent_eval_v3.task-gaps.json records, per case in dataset
 * order, which native task shape is still missing: session-preseed (23 cases
 * with context), selection-prefix (12 cases with non-empty selected_point_ids),
 * or none (627).
 *
 * Byte stability: fixed key construction order, 2-space indent, UTF-8 without
 * ASCII escaping, trailing newline. Rerunning over an unchanged corpus
 * reproduces both files byte-for-byte.
 *
 * Run from packages/eval/ (writes datasets/, never calls a model):
 *   node --import tsx scripts/generate-agent-eval-v3-source.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const ORIGINAL_FILE = join(
  PACKAGE_DIR,
  '../../apps/agent/src/animichi/tests/eval/datasets/agent_eval_v3.json',
);
const SOURCE_FILE = join(PACKAGE_DIR, 'datasets/source/agent_eval_v3.json');
const SIDECAR_FILE = join(PACKAGE_DIR, 'datasets/source/agent_eval_v3.task-gaps.json');

const REQUIRED_ASSERTIONS = [
  'execution_pass',
  'tool_correctness_pass',
  'trajectory_pass',
  'data_keys_pass',
] as const;

type Locale = 'en' | 'ja' | 'zh';
type TaskShape = 'session-preseed' | 'selection-prefix' | 'none';

interface SeedOrigin {
  origin_lat: number;
  origin_lng: number;
}

interface SeedHistory {
  message_history: readonly unknown[];
}

type SeedContext = SeedOrigin | SeedHistory;

interface V3Case {
  readonly id: string;
  readonly path: string;
  readonly tier: string;
  readonly query: string;
  readonly locale: Locale;
  readonly acceptableStages: readonly string[];
  readonly expectedDataKeys: readonly string[];
  readonly context: SeedContext | null;
  readonly selectedPointIds: readonly string[] | null;
  readonly expectNonempty: boolean;
  readonly sourceMetadata: Readonly<Record<string, unknown>>;
}

interface NativeCase {
  readonly name: string;
  readonly inputs: { readonly prompt: string; readonly locale: Locale };
  readonly metadata: {
    readonly category: 'end-to-end';
    readonly path: string;
    readonly tier: string;
    readonly acceptable_stages: readonly string[];
    readonly expected_data_keys: readonly string[];
    readonly seeded_context?: SeedContext;
    readonly seeded_selected_point_ids?: readonly string[];
    readonly expect_nonempty?: true;
    readonly source_metadata: Readonly<Record<string, unknown>>;
    readonly required_assertions: readonly string[];
  };
  readonly expected_output: null;
}

interface SourceDoc {
  readonly name: 'agent_eval_v3';
  readonly cases: readonly NativeCase[];
  readonly evaluators: readonly [];
  readonly report_evaluators: readonly [];
}

interface SidecarCase {
  readonly id: string;
  readonly required_task_shape: TaskShape;
}

interface SidecarDoc {
  readonly dataset: 'agent_eval_v3';
  readonly source_of_truth: string;
  readonly note: string;
  readonly counts: Readonly<Record<TaskShape, number>>;
  readonly cases: readonly SidecarCase[];
}

function assertObject(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${where}: expected an object, got ${typeof value}`);
  }
  return value as Record<string, unknown>;
}

function assertString(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== 'string') throw new Error(`${where}: "${key}" must be a string`);
  return value;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function assertStringArray(record: Record<string, unknown>, key: string, where: string): string[] {
  const value = record[key];
  if (!isStringArray(value)) throw new Error(`${where}: "${key}" must be an array of strings`);
  return value;
}

function parseLocale(value: string, where: string): Locale {
  if (value === 'en' || value === 'ja' || value === 'zh') return value;
  throw new Error(`${where}: unknown locale "${value}"`);
}

function parseSeedContext(value: unknown, where: string): SeedContext | null {
  if (value === null) return null;
  const record = assertObject(value, where);
  if (typeof record.origin_lat === 'number' && typeof record.origin_lng === 'number') {
    return { origin_lat: record.origin_lat, origin_lng: record.origin_lng };
  }
  if (isHistoryList(record.message_history)) {
    return { message_history: record.message_history };
  }
  throw new Error(`${where}: unrecognized context shape`);
}

function isHistoryList(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function parseSelectedPointIds(value: unknown, where: string): readonly string[] | null {
  if (value === null) return null;
  if (!isStringArray(value)) {
    throw new Error(`${where}: "selected_point_ids" must be an array of strings`);
  }
  return value;
}

function parseExpectNonempty(record: Record<string, unknown>, where: string): boolean {
  const value = record.expect_nonempty;
  if (value === undefined || value === false) return false;
  if (value === true) return true;
  throw new Error(`${where}: "expect_nonempty" must be true when present`);
}

function parseSourceMetadata(raw: Record<string, unknown>, where: string): Record<string, unknown> {
  const metadata = assertObject(raw.metadata, `${where}.metadata`);
  for (const key of ['db_state', 'difficulty', 'notes'] as const) {
    if (typeof metadata[key] !== 'string') {
      throw new Error(`${where}.metadata: "${key}" must be a string`);
    }
  }
  return metadata;
}

function parseCase(raw: unknown, index: number): V3Case {
  const where = `agent_eval_v3 case ${String(index)}`;
  const record = assertObject(raw, where);
  return {
    id: assertString(record, 'id', where),
    path: assertString(record, 'path', where),
    tier: assertString(record, 'tier', where),
    query: assertString(record, 'query', where),
    locale: parseLocale(assertString(record, 'locale', where), where),
    acceptableStages: assertStringArray(record, 'acceptable_stages', where),
    expectedDataKeys: assertStringArray(record, 'expected_data_keys', where),
    context: parseSeedContext(record.context, where),
    selectedPointIds: parseSelectedPointIds(record.selected_point_ids, where),
    expectNonempty: parseExpectNonempty(record, where),
    sourceMetadata: parseSourceMetadata(record, where),
  };
}

function parseDataset(raw: unknown): V3Case[] {
  if (!Array.isArray(raw)) throw new Error('agent_eval_v3.json must be a top-level list of cases');
  return raw.map(parseCase);
}

function taskShape(entry: V3Case): TaskShape {
  if (entry.context !== null) return 'session-preseed';
  if (entry.selectedPointIds !== null && entry.selectedPointIds.length > 0) {
    return 'selection-prefix';
  }
  return 'none';
}

function seedMetadata(entry: V3Case): Pick<NativeCase['metadata'], 'seeded_context' | 'seeded_selected_point_ids' | 'expect_nonempty'> {
  return {
    ...(entry.context === null ? {} : { seeded_context: entry.context }),
    ...(entry.selectedPointIds === null
      ? {}
      : { seeded_selected_point_ids: entry.selectedPointIds }),
    ...(entry.expectNonempty ? { expect_nonempty: true } : {}),
  };
}

function buildCase(entry: V3Case): NativeCase {
  return {
    name: entry.id,
    inputs: { prompt: entry.query, locale: entry.locale },
    metadata: {
      category: 'end-to-end',
      path: entry.path,
      tier: entry.tier,
      acceptable_stages: entry.acceptableStages,
      expected_data_keys: entry.expectedDataKeys,
      ...seedMetadata(entry),
      source_metadata: entry.sourceMetadata,
      required_assertions: REQUIRED_ASSERTIONS,
    },
    expected_output: null,
  };
}

function buildSidecar(cases: readonly V3Case[]): SidecarDoc {
  const shapeCases = cases.map((entry) => ({ id: entry.id, required_task_shape: taskShape(entry) }));
  const count = (shape: TaskShape): number =>
    shapeCases.filter((entry) => entry.required_task_shape === shape).length;
  return {
    dataset: 'agent_eval_v3',
    source_of_truth: 'apps/agent/src/animichi/tests/eval/datasets/agent_eval_v3.json',
    note: [
      'SOURCE FORMAT ONLY: the source file preserves the corpus; these are the native',
      'task shapes still missing per case. The E1 CLI (command-task.ts) consumes',
      '{prompt, locale} only — session-preseed needs a seeded-session task extension',
      'and selection-prefix needs deterministic selection state (#1557).',
    ].join(' '),
    counts: {
      none: count('none'),
      'session-preseed': count('session-preseed'),
      'selection-prefix': count('selection-prefix'),
    },
    cases: shapeCases,
  };
}

function writeStable(path: string, document: object): void {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

function main(): void {
  const cases = parseDataset(JSON.parse(readFileSync(ORIGINAL_FILE, 'utf8')) as unknown);
  writeStable(SOURCE_FILE, {
    name: 'agent_eval_v3',
    cases: cases.map(buildCase),
    evaluators: [],
    report_evaluators: [],
  } satisfies SourceDoc);
  const sidecar = buildSidecar(cases);
  writeStable(SIDECAR_FILE, sidecar);
  console.log(
    `agent_eval_v3: ${String(cases.length)} cases → ${SOURCE_FILE} + ${SIDECAR_FILE}`,
  );
  console.log(
    `task gaps: ${String(sidecar.counts.none)} none / ${String(sidecar.counts['session-preseed'])} session-preseed / ${String(sidecar.counts['selection-prefix'])} selection-prefix`,
  );
}

main();
