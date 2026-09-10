import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/** Regression proofs for the #1557 source-format migration of agent_eval_v3:
 * the checked-in native source file and its task-gap sidecar must carry the
 * original 662 IDs 1:1, in order, with nothing from the other 546 corpus
 * cases and no seeded session payload dropped. */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SOURCE_FILE = join(REPO_ROOT, 'packages/eval/datasets/source/agent_eval_v3.json');
const SIDECAR_FILE = join(REPO_ROOT, 'packages/eval/datasets/source/agent_eval_v3.task-gaps.json');
const ORIGINALS_DIR = join(REPO_ROOT, 'apps/agent/src/animichi/tests/eval/datasets');
const SIBLING_DATASETS = [
  'agent_eval_heldout_v1',
  'injection_g1_v1',
  'input_guard_v1',
  'long_context_v1',
  'phase1c_selection_v1',
  'runtime_journey_v1',
  'translation_v1',
] as const;

interface OriginalCase {
  readonly id: string;
  readonly query: string;
  readonly locale: string;
  readonly context: unknown;
  readonly selected_point_ids: unknown;
}

interface SourceCase {
  readonly name: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly expected_output: unknown;
  readonly metadata: Readonly<Record<string, unknown>>;
}

interface Sidecar {
  readonly counts: Readonly<Record<string, number>>;
  readonly cases: readonly { readonly id: string; readonly required_task_shape: string }[];
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function casesOf(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object' && raw !== null && Array.isArray((raw as { cases: unknown }).cases)) {
    return (raw as { cases: unknown[] }).cases;
  }
  throw new Error('dataset is neither a case list nor a {cases: [...]} object');
}

function originalCases(name: string): OriginalCase[] {
  return casesOf(readJson(join(ORIGINALS_DIR, `${name}.json`))).map((entry) => entry as OriginalCase);
}

const original = originalCases('agent_eval_v3');
const source = (readJson(SOURCE_FILE) as { cases: SourceCase[] }).cases;
const sidecar = readJson(SIDECAR_FILE) as Sidecar;

/** The documented gap classification (#1557 ledger): context seeds a session,
 * non-empty selected_point_ids seed a selection prefix, anything else is
 * directly representable as {prompt, locale}. */
function gapOf(entry: OriginalCase): string {
  if (entry.context !== null) return 'session-preseed';
  const ids = entry.selected_point_ids as readonly string[] | null;
  if (ids !== null && ids.length > 0) return 'selection-prefix';
  return 'none';
}

void test('all 662 v3 IDs are present exactly once', () => {
  assert.equal(source.length, 662);
  assert.equal(new Set(source.map((entry) => entry.name)).size, 662);
});

void test('the source names map 1:1 onto the original IDs by order', () => {
  assert.deepEqual(
    source.map((entry) => entry.name),
    original.map((entry) => entry.id),
  );
});

void test('no ID from the other 546 corpus cases leaked in', () => {
  const sourceIds = new Set(source.map((entry) => entry.name));
  const leaked = SIBLING_DATASETS
    .flatMap((name) => originalCases(name).map((entry) => entry.id))
    .filter((id) => sourceIds.has(id));
  assert.deepEqual(leaked, []);
});

void test('the whole corpus still counts 1,208 IDs (662 + 546 siblings)', () => {
  const siblings = SIBLING_DATASETS.reduce((total, name) => total + originalCases(name).length, 0);
  assert.equal(original.length + siblings, 1208);
});

void test('every case carries its query as prompt and its locale, nothing else', () => {
  assert.deepEqual(
    source.map((entry) => entry.inputs),
    original.map((entry) => ({ prompt: entry.query, locale: entry.locale })),
  );
});

void test('seeded session payloads survive verbatim in metadata', () => {
  const payloadOf = (entry: SourceCase): unknown[] => [
    entry.metadata.seeded_context ?? null,
    entry.metadata.seeded_selected_point_ids ?? null,
  ];
  assert.deepEqual(
    source.map(payloadOf),
    original.map((entry) => [entry.context, entry.selected_point_ids]),
  );
});

void test('every case is end-to-end with the four registered assertions', () => {
  const assertions = ['execution_pass', 'tool_correctness_pass', 'trajectory_pass', 'data_keys_pass'];
  for (const entry of source) assert.equal(entry.metadata.category, 'end-to-end');
  for (const entry of source) assert.deepEqual(entry.metadata.required_assertions, assertions);
});

void test('cases stay preserved records: null expected_output, empty evaluator lists', () => {
  const doc = readJson(SOURCE_FILE) as { name: string; evaluators: unknown; report_evaluators: unknown };
  assert.equal(doc.name, 'agent_eval_v3');
  assert.deepEqual([doc.evaluators, doc.report_evaluators], [[], []]);
  for (const entry of source) assert.equal(entry.expected_output, null);
});

void test('the sidecar lists all 662 cases in order with the right gap', () => {
  assert.deepEqual(
    sidecar.cases,
    original.map((entry) => ({ id: entry.id, required_task_shape: gapOf(entry) })),
  );
});

void test('the sidecar counts split 627 none / 23 preseed / 12 selection', () => {
  assert.deepEqual(sidecar.counts, { none: 627, 'session-preseed': 23, 'selection-prefix': 12 });
});
