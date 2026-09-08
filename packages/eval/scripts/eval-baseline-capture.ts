/**
 * Capture one finished, uncapped TS gate run as the new baseline (#1515).
 *
 * The owner's 2026-09-08 decision on #1303: the TS tier's own staging run
 * becomes the record every later run is judged against, and the Python-versus-TS
 * paired comparison (#1480) is dropped. This is the mechanism for it, and it is
 * a SECOND command over a COMMITTED result file rather than a flag on
 * `eval-gate.ts` — the run being judged must not be able to write what judges
 * it, so `gate-exit-code.ts` keeps its two answers and this keeps its own
 * blast radius.
 *
 * `src/` decides and `scripts/` does the IO, as everywhere here: every refusal
 * is `gate-run/baseline-capture.ts`' (any starved case, a capped run, a record
 * already on disk without `--replace`), and this file reads two paths, writes
 * one, and prints.
 *
 * Usage (from the repo root, after the uncapped run committed its result):
 *
 *   pnpm --filter @animichi/eval run eval:baseline:capture \
 *     --result results/<date>-agent_eval_v3.json --replace
 *
 * `--result` is resolved against `packages/eval/`, the directory
 * `pnpm --filter … run` works in.
 *
 * NO `--` BEFORE THE FLAGS, for the reason `eval-gate.ts` states: pnpm 10
 * forwards that separator and `parseArgs` reads what follows as a positional.
 *
 * `--replace` is not optional in practice today: the path is occupied by the
 * Python-written record this one retires.
 */
import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { exportedCaseCount } from '../src/dataset-sets.ts';
import { baselinePath, writeBaselineRecord } from '../src/gate/baseline-store.ts';
import {
  parseBaselineCandidate,
  unreadableResultRefusal,
  type BaselineCandidate,
} from '../src/gate-run/baseline-candidate.ts';
import { captureBaseline, type CaptureVerdict } from '../src/gate-run/baseline-capture.ts';
import { baselineLocation, BASELINE_MODEL, BASELINE_TIER } from '../src/gate-run/baseline-identity.ts';

interface CaptureArgs {
  readonly result: string;
  readonly replace: boolean;
}

function captureArgs(argv: readonly string[]): CaptureArgs | null {
  const { values } = parseArgs({
    args: [...argv],
    options: { result: { type: 'string' }, replace: { type: 'boolean', default: false } },
  });
  if (values.result === undefined) {
    return null;
  }
  return { result: values.result, replace: values.replace };
}

/** The refusal for no `--result` at all — the same one clean line the four
 * capture refusals give, because an operator reading a stack trace over a
 * missing flag learns nothing the sentence does not say. */
const MISSING_RESULT =
  'refusing to write a baseline: pass --result <results/<date>-<dataset>.json>, ' +
  'a run file `eval:gate` committed.';

/**
 * A result file that cannot be read — or that cannot say what each case scored
 * — cannot become a record. Both answer `null` and both print the same one
 * line: a path nobody can open and a file nobody can parse are the same
 * mistake to the operator, and an ENOENT stack trace says less than the
 * sentence does.
 */
function candidateAt(path: string): BaselineCandidate | null {
  const text = readResult(path);
  return text === null ? null : parseBaselineCandidate(text);
}

function readResult(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function verdictFor(candidate: BaselineCandidate, replace: boolean): CaptureVerdict {
  return captureBaseline(candidate, {
    modelId: BASELINE_MODEL,
    tier: BASELINE_TIER,
    datasetCaseCount: exportedCaseCount(candidate.dataset),
    recordExists: existsSync(baselinePath(baselineLocation())),
    replace,
  });
}

function refuse(lines: readonly string[]): void {
  process.stderr.write(`${lines.join('\n')}\n`);
  process.exitCode = 1;
}

function main(): void {
  const args = captureArgs(process.argv.slice(2));
  if (args === null) {
    refuse([MISSING_RESULT]);
    return;
  }
  const candidate = candidateAt(args.result);
  if (candidate === null) {
    refuse([unreadableResultRefusal(args.result)]);
    return;
  }
  const { record, refusals } = verdictFor(candidate, args.replace);
  if (record === null) {
    refuse(refusals);
    return;
  }
  process.stdout.write(`Baseline written to: ${writeBaselineRecord(record, baselineLocation())}\n`);
}

main();
