import { basename } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { UNSTRATIFIED } from './paired-bootstrap.ts';

/**
 * `stats.py`'s `load_case_strata`: case id → behaviour path.
 *
 * The strata come from the **canonical** dataset in `apps/agent`, not from the
 * exported fixture this package reads elsewhere. `Dataset.to_file` keeps only
 * the fields of `AgentExpected` (`acceptable_stages`, `data_keys`,
 * `expect_nonempty`), so a row's `path` does not survive the export — measured
 * on `fixtures/agent_eval_v3.json`, whose 662 cases carry no `path` anywhere.
 * Python reads the canonical file for the same reason; a stratified gate driven
 * off the exported fixture alone would silently degrade to `unstratified`.
 *
 * A CANONICAL SET MAY ALSO CARRY NO `path` COLUMN (#1478): five of the eight do
 * (`injection_g1_v1`, `input_guard_v1`, `phase1c_selection_v1`,
 * `runtime_journey_v1`, `translation_v1`). Those load as ONE stratum — every
 * case `UNSTRATIFIED`, exactly what `bootstrapGate` already does with a case
 * the strata do not name — and the run carries a warning saying the interval is
 * pooled. Refusing them instead would leave those sets ungateable; throwing (as
 * this did) threw after every staging turn had already been paid for.
 *
 * Errors and the warning name the DATASET, never the absolute path: the warning
 * is written into a committed result file, and a machine-specific path there is
 * both a leak and a diff nobody can compare.
 */

export const CANONICAL_DATASETS_DIR = fileURLToPath(
  new URL('../../../../apps/agent/src/animichi/tests/eval/datasets/', import.meta.url),
);

export function canonicalDatasetPath(setName: string): string {
  return `${CANONICAL_DATASETS_DIR}${setName}.json`;
}

/** The strata one dataset yields, and what the run must say about them. */
export interface CaseStrata {
  readonly byCase: Readonly<Record<string, string>>;
  readonly warnings: readonly string[];
}

/** Case-id to behaviour-path strata, from a canonical eval dataset. */
export function loadCaseStrata(path: string): CaseStrata {
  return caseStrataFromText(readFileSync(path, 'utf8'), basename(path, '.json'));
}

/** `case_strata_from_text`: one dataset's rows, stratified or pooled. */
export function caseStrataFromText(text: string, dataset: string): CaseStrata {
  const rows = datasetRows(text, dataset);
  const stratified = rows.some(carriesPath);
  const byCase = Object.fromEntries(
    rows.map((row, index) => stratumEntry(row, index, dataset, stratified)),
  );
  if (stratified) return { byCase, warnings: [] };
  return { byCase, warnings: [pooledStratumWarning(dataset)] };
}

/** The line a pooled run says for itself, on both runners. */
export function pooledStratumWarning(dataset: string): string {
  return (
    `${dataset}: no "path" column, so every case pools into one stratum ` +
    'and the interval is unstratified'
  );
}

function datasetRows(text: string, dataset: string): readonly unknown[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new TypeError(`${dataset}: an eval dataset must be a list of rows`);
  }
  return parsed;
}

function carriesPath(row: unknown): boolean {
  return fieldsOf(row).path !== undefined;
}

function stratumEntry(
  row: unknown,
  index: number,
  dataset: string,
  stratified: boolean,
): [string, string] {
  const caseId = rowText(row, 'id', index, dataset);
  if (!stratified) return [caseId, UNSTRATIFIED];
  return [caseId, rowText(row, 'path', index, dataset)];
}

function rowText(row: unknown, field: string, index: number, dataset: string): string {
  const value = fieldsOf(row)[field];
  if (typeof value !== 'string') {
    throw new TypeError(`${dataset}: row ${String(index)} has no string "${field}"`);
  }
  return value;
}

function fieldsOf(row: unknown): Record<string, unknown> {
  return row !== null && typeof row === 'object' ? (row as Record<string, unknown>) : {};
}
