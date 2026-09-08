import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { GateRunResult } from './gate-run-result.ts';

/**
 * Where a gate run lands: `packages/eval/results/<date>-<dataset>.json`.
 *
 * COMMITTED, NOT IGNORED. W3-5's sign-off *is* this file — "the gate verdict is
 * no regression on every metric, with intervals and the seed in the report
 * committed under `results/`" is the acceptance criterion (#1303) — and a
 * result that only ever existed on the runner's laptop cannot be evidence for
 * an exit gate. Nothing here is a secret: scores, intervals and case counts.
 *
 * NAMED FOR THE DATE AND THE SET, so one run of each of the six sets sits side
 * by side and a re-run of the same set on the same day overwrites rather than
 * accumulating near-identical files. The date is the record's own
 * `generated_at`, not a second reading of the clock.
 */
export const RESULTS_DIR = fileURLToPath(new URL('../../results/', import.meta.url));

export function resultFileName(result: GateRunResult): string {
  return `${result.generated_at.slice(0, 10)}-${result.dataset}.json`;
}

/** Two-space JSON with a trailing newline — `model_dump_json(indent=2)`'s shape,
 * so a result file diffs the way the baselines beside it do. */
export function gateRunResultText(result: GateRunResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function writeGateRunResult(
  result: GateRunResult,
  resultsDir: string = RESULTS_DIR,
): string {
  mkdirSync(resultsDir, { recursive: true });
  const path = `${resultsDir.replace(/\/$/, '')}/${resultFileName(result)}`;
  writeFileSync(path, gateRunResultText(result), 'utf8');
  return path;
}
