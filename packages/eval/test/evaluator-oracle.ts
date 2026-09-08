/**
 * Reading side of `fixtures/evaluator-oracle.json`, the committed dump of what
 * the Python evaluators score for a set of synthetic transcripts.
 *
 * Producer: `apps/agent/src/animichi/tests/eval/evaluator_oracle.py`. The point
 * of the file is that the TS assertions compare against Python's numbers rather
 * than against a second derivation of the same formulas — so nothing in here
 * computes a score.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { EvaluatorContext } from 'logfire/evals';

import type {
  ExportedAgentExpected,
  ExportedAgentInput,
} from '../src/dataset-roundtrip.ts';
import type { TranscriptResult } from '../src/evaluators/index.ts';

export interface OracleCase {
  readonly caseId: string;
  readonly inputs: ExportedAgentInput;
  readonly metadata: ExportedAgentExpected;
  readonly scores: Readonly<Record<string, number>>;
  readonly transcript: TranscriptResult;
}

export interface EvaluatorOracle {
  readonly cases: readonly OracleCase[];
  readonly evaluatorVersion: string;
  readonly metricNames: {
    readonly withNonemptyCases: readonly string[];
    readonly withoutNonemptyCases: readonly string[];
    readonly withoutParamsRecorded: readonly string[];
    readonly withoutMeasuredSteps: readonly string[];
  };
}

const ORACLE_PATH = fileURLToPath(
  new URL('../fixtures/evaluator-oracle.json', import.meta.url),
);

export const ORACLE: EvaluatorOracle = JSON.parse(
  readFileSync(ORACLE_PATH, 'utf8'),
) as EvaluatorOracle;

export function oracleCase(caseId: string): OracleCase {
  const found = ORACLE.cases.find((entry) => entry.caseId === caseId);
  if (found === undefined) {
    throw new Error(`no oracle case named ${caseId}`);
  }
  return found;
}

/** The context shape `Dataset.evaluate` hands an evaluator, minus the span tree. */
export function contextFor(
  entry: OracleCase,
): EvaluatorContext<ExportedAgentInput, TranscriptResult, ExportedAgentExpected> {
  return {
    attributes: {},
    duration: 0,
    expectedOutput: undefined,
    inputs: entry.inputs,
    metadata: entry.metadata,
    metrics: {},
    name: entry.caseId,
    output: entry.transcript,
    get spanTree(): never {
      throw new Error('the TS port scores the wire transcript, never a span tree');
    },
  };
}
