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
 * `src/` decides and `scripts/` does the IO, as everywhere here: the refusals
 * about the RUN are `gate-run/baseline-capture.ts`' (any starved case, a capped
 * run, a red that is not a regression, a record already on disk without
 * `--replace`) and the ones about the FILE are `gate-run/baseline-candidate.ts`'
 * (unreadable, or a set nobody exports). What is left is the command line
 * itself, which nothing in `src/` has seen: a missing `--result`, and a flag
 * this command does not have. Every one of them reaches the operator the same
 * way — one stderr line, exit 1 — because they all reach them in the same
 * place; this file reads two paths, writes one, and prints.
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

import { knownCaseCount } from '../src/dataset-sets.ts';
import { baselinePath, writeBaselineRecord } from '../src/gate/baseline-store.ts';
import {
  parseBaselineCandidate,
  unknownDatasetRefusal,
  unreadableResultRefusal,
  type BaselineCandidate,
} from '../src/gate-run/baseline-candidate.ts';
import {
  captureBaseline,
  type CaptureTerms,
  type CaptureVerdict,
} from '../src/gate-run/baseline-capture.ts';
import { baselineLocation, BASELINE_MODEL, BASELINE_TIER } from '../src/gate-run/baseline-identity.ts';

/** The command line as `parseArgs` reads it: `--result` may be absent, and its
 * absence is a refusal below rather than a default here. */
interface CaptureFlags {
  readonly result: string | undefined;
  readonly replace: boolean;
}

/**
 * The two flags this command has, or `null` for a command line `parseArgs`
 * would not read at all — a misspelling, or a positional this command takes
 * none of. `parseArgs` throws on both, and the throw is caught here so the
 * operator meets a sentence rather than a stack trace over a typo.
 */
function captureFlags(argv: readonly string[]): CaptureFlags | null {
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: { result: { type: 'string' }, replace: { type: 'boolean', default: false } },
    });
    return { result: values.result, replace: values.replace };
  } catch {
    return null;
  }
}

/** The refusal for no `--result` at all — the same one clean line the four
 * capture refusals give, because an operator reading a stack trace over a
 * missing flag learns nothing the sentence does not say. */
const MISSING_RESULT =
  'refusing to write a baseline: pass --result <results/<date>-<dataset>.json>, ' +
  'a run file `eval:gate` committed.';

/** The refusal for a flag this command does not have. It names both of the
 * flags it does, because the mistake is almost always one of them mistyped. */
const UNKNOWN_FLAG =
  'refusing to write a baseline: this command takes --result ' +
  '<results/<date>-<dataset>.json> and --replace, and nothing else. ' +
  'Check the spelling of what you passed.';

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

/** What the pins and the disk know that a result file cannot say about itself. */
function captureTerms(datasetCaseCount: number, replace: boolean): CaptureTerms {
  return {
    modelId: BASELINE_MODEL,
    tier: BASELINE_TIER,
    datasetCaseCount,
    recordExists: existsSync(baselinePath(baselineLocation())),
    replace,
  };
}

/** A refusal this file owns, in the shape `src/` answers in, so every path
 * through the command ends at the same reporting. */
function refusedWith(line: string): CaptureVerdict {
  return { record: null, refusals: [line] };
}

/** What the command line asked for. */
function verdictFor(argv: readonly string[]): CaptureVerdict {
  const flags = captureFlags(argv);
  if (flags === null) {
    return refusedWith(UNKNOWN_FLAG);
  }
  if (flags.result === undefined) {
    return refusedWith(MISSING_RESULT);
  }
  return verdictForResult(flags.result, flags.replace);
}

/** What the file at `path` may become: nothing this can read, a run of a set
 * nobody exports, or a candidate the decision in `src/` judges. */
function verdictForResult(path: string, replace: boolean): CaptureVerdict {
  const candidate = candidateAt(path);
  if (candidate === null) {
    return refusedWith(unreadableResultRefusal(path));
  }
  const datasetCaseCount = knownCaseCount(candidate.dataset);
  if (datasetCaseCount === null) {
    return refusedWith(unknownDatasetRefusal(candidate.dataset));
  }
  return captureBaseline(candidate, captureTerms(datasetCaseCount, replace));
}

/** The only write, and the only exit code: the record's path on stdout, or
 * every reason there is no record on stderr, one per line. */
function report(verdict: CaptureVerdict): void {
  if (verdict.record === null) {
    process.stderr.write(`${verdict.refusals.join('\n')}\n`);
    process.exitCode = 1;
    return;
  }
  const written = writeBaselineRecord(verdict.record, baselineLocation());
  process.stdout.write(`Baseline written to: ${written}\n`);
}

function main(): void {
  report(verdictFor(process.argv.slice(2)));
}

main();
