/**
 * The exported dataset sets and the case count each one must keep.
 *
 * The counts are a tripwire, not a derived value: a fixture that silently
 * shrinks (a truncated export, an `EVAL_MAX_CASES` leak into the exporter)
 * would otherwise still load and still deep-equal itself.
 *
 * Producer: `scripts/export-eval-fixtures.sh`, one `EVAL_DATASET` per set.
 */
export interface ExportedDataset {
  readonly caseCount: number;
  readonly name: string;
}

export const EXPORTED_DATASETS: readonly ExportedDataset[] = [
  { caseCount: 662, name: 'agent_eval_v3' },
  { caseCount: 33, name: 'agent_eval_heldout_v1' },
  { caseCount: 23, name: 'injection_g1_v1' },
  { caseCount: 15, name: 'input_guard_v1' },
  { caseCount: 13, name: 'long_context_v1' },
  { caseCount: 5, name: 'phase1c_selection_v1' },
];

/**
 * The set name a runner was asked for, refused with the list rather than
 * guessed at. A typo that fell through to `Dataset.fromFile` would surface as
 * ENOENT on a path nobody typed; naming the six is what makes the refusal
 * actionable — and it lives here because this is where the six are declared.
 */
export function checkedDatasetName(name: string): string {
  const known = EXPORTED_DATASETS.map((set) => set.name);
  if (known.includes(name)) return name;
  throw new RangeError(`unknown dataset "${name}" — one of: ${known.join(", ")}`);
}

/**
 * How many cases an UNCAPPED run of a set evaluates — the pinned count above,
 * not a second reading of the file. `gate-run/baseline-capture.ts` compares a
 * finished run's `case_count` against it to tell a full run from a `--limit`
 * one, which is the same tripwire this list already is, asked a new question.
 */
export function exportedCaseCount(name: string): number {
  const set = EXPORTED_DATASETS.find((one) => one.name === checkedDatasetName(name));
  if (set === undefined) throw new RangeError(`unknown dataset "${name}"`);
  return set.caseCount;
}
