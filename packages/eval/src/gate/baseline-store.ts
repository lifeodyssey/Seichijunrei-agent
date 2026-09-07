import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import {
  baselineRecordText,
  caseMetrics,
  parseBaselineRecord,
  type BaselineRecord,
} from './baseline-record.ts';

/**
 * Where a baseline record lives and when it stops counting.
 *
 * `gate.py` reads a baseline through one funnel — locate, load, judge fresh —
 * and answers "no usable baseline" three different ways: the file is missing,
 * it does not parse, or it describes a run this one cannot be compared with.
 * Python logs all three and carries on. This side does that for two of them and
 * FAILS on the middle one (#1341): a committed record that no longer parses is
 * damage, and warning about it disables the regression gate with a line that
 * reads exactly like a legitimate first run. Missing stays a warning, because a
 * first run legitimately has no baseline and must not be a crash.
 *
 * Only one line ever comes back: `_is_stale` short-circuits, and so does this.
 */

/** The three fields that always travel together to find a baseline on disk. */
export interface BaselineLocation {
  readonly layer: string;
  readonly modelId: string;
  readonly baselinesDir: string;
}

/** What the current run expects of a baseline before it will compare with it. */
export interface BaselineExpectations {
  readonly caseCount?: number;
  readonly metrics?: readonly string[];
  /** The evaluator vocabulary this runner scores in. Injected rather than
   * imported so `gate/` keeps no edge to `evaluators/`; the caller that gates a
   * real run passes `EVALUATOR_VERSION` (`gate-run/baseline-gated-settings.ts`). */
  readonly evaluatorVersion?: string;
}

/**
 * What one baseline read decided, in the gate's own two voices.
 *
 * `warnings` is the non-blocking half — no record yet, or one this run cannot be
 * compared with — and leaves the run reported but ungated. `failures` holds the
 * single blocking answer: the file is on disk and does not parse.
 */
export interface BaselineReadResult {
  readonly record: BaselineRecord | null;
  readonly failures: readonly string[];
  readonly warnings: readonly string[];
}

/** The minimum share of the expected cases a usable baseline must have scored. */
const EVALUATED_FLOOR = 0.8;

/** `baseline_path` — the model id becomes a filename by flattening its punctuation. */
export function baselinePath(location: BaselineLocation): string {
  const safeModel = location.modelId
    .replaceAll(':', '-')
    .replaceAll('@', '-')
    .replaceAll('/', '-');
  return `${location.baselinesDir.replace(/\/$/, '')}/${location.layer}_${safeModel}.json`;
}

export function readBaselineRecord(
  location: BaselineLocation,
  expectations: BaselineExpectations = {},
): BaselineReadResult {
  const path = baselinePath(location);
  if (!existsSync(path)) {
    return ungated(`Missing baseline for ${named(location)} at ${path}`);
  }
  const record = parseBaselineRecord(readFileSync(path, 'utf8'));
  if (record === null) {
    return baselineInvalid(location, path);
  }
  const mismatch = evaluatorVersionFailure(record, location, expectations.evaluatorVersion);
  if (mismatch !== null) {
    return { record: null, failures: [mismatch], warnings: [] };
  }
  return freshRecord(record, location, expectations);
}

export function writeBaselineRecord(record: BaselineRecord, location: BaselineLocation): string {
  mkdirSync(location.baselinesDir, { recursive: true });
  const path = baselinePath(location);
  writeFileSync(path, `${baselineRecordText(record)}\n`, 'utf8');
  return path;
}

/** `%s/%s` — how `gate.py` names a baseline in every one of its warnings. */
function named(location: BaselineLocation): string {
  return `${location.layer}/${location.modelId}`;
}

/** No usable baseline and nothing damaged: the run is reported, not gated. */
function ungated(warning: string): BaselineReadResult {
  return { record: null, failures: [], warnings: [warning] };
}

/** The one read outcome that blocks: the record is on disk and unreadable. */
function baselineInvalid(location: BaselineLocation, path: string): BaselineReadResult {
  return { record: null, failures: [invalidFailure(location, path)], warnings: [] };
}

/**
 * Python interpolates the pydantic `ValidationError` here. There is no such
 * object on this side, so the message names the schema it failed instead — the
 * one line of the five that is not text-identical across the two runners, and
 * the one this side raises from a warning to a failure.
 */
function invalidFailure(location: BaselineLocation, path: string): string {
  return `Invalid baseline for ${named(location)} at ${path}: not a schema-v2 baseline record`;
}

/**
 * A record scored by a vocabulary this runner does not implement (#1303).
 *
 * It is a FAILURE and not a staleness warning, for the reason a damaged record
 * is: an ungated run reads like a legitimate first run, and comparing
 * `official-v1` numbers against `official-v2` ones manufactures regressions on
 * exactly the metrics whose semantics moved. Nobody re-runs their way out of it
 * either — the record has to be re-created.
 *
 * A record that carries NO version is not judged here. That is the shape every
 * record committed before this field existed has, and Python still writes it
 * for the translation tier; the pinned record's own version is asserted by
 * `test/gate-baseline-record.test.ts` instead, where it is a fact about one
 * file rather than a rule about every file.
 *
 * Python reaches the same verdict on the same record and reports it in its own
 * voice (#1483): `gate.py::_scored_by_another_evaluator` logs `Invalid baseline
 * for …: scored by evaluator X, this runner scores Y` and drops the record,
 * the class it already uses for a baseline it cannot read, rather than failing.
 * It stays out of `baseline_staleness` in the shared oracle for the reason the
 * other invalid-baseline lines do — the message interpolates the path — and
 * because the two sides answer in different halves of this result; the Python
 * half is pinned by `tests/unit/test_eval_gate_evaluator_version.py`.
 */
function evaluatorVersionFailure(
  record: BaselineRecord,
  location: BaselineLocation,
  expected: string | undefined,
): string | null {
  const found = record.evaluator_version;
  if (expected === undefined || found === null || found === expected) {
    return null;
  }
  return `Baseline for ${named(location)} was scored by evaluator ${found}, this runner scores ${expected}`;
}

function freshRecord(
  record: BaselineRecord,
  location: BaselineLocation,
  expectations: BaselineExpectations,
): BaselineReadResult {
  const warning = stalenessWarning(record, location, expectations);
  return warning === null ? { record, failures: [], warnings: [] } : ungated(warning);
}

function stalenessWarning(
  record: BaselineRecord,
  location: BaselineLocation,
  expectations: BaselineExpectations,
): string | null {
  const expected = expectations.caseCount;
  if (expected !== undefined && record.case_count !== expected) {
    return `Stale baseline for ${named(location)}: expected ${String(expected)} cases, found ${String(record.case_count)}`;
  }
  if (expected !== undefined && record.evaluated_count < expected * EVALUATED_FLOOR) {
    return `Baseline for ${named(location)} has too few evaluated cases: ${String(record.evaluated_count)} < 80% of ${String(expected)}`;
  }
  return vocabularyWarning(record, location, expectations.metrics);
}

function vocabularyWarning(
  record: BaselineRecord,
  location: BaselineLocation,
  expected: readonly string[] | undefined,
): string | null {
  if (expected === undefined) {
    return null;
  }
  const current =
    sameNames(Object.keys(record.scores), expected) && sameNames(caseMetrics(record), expected);
  return current ? null : `Stale baseline for ${named(location)}: metric vocabulary changed`;
}

function sameNames(names: readonly string[], expected: readonly string[]): boolean {
  const left = new Set(names);
  const right = new Set(expected);
  return left.size === right.size && [...left].every((name) => right.has(name));
}
