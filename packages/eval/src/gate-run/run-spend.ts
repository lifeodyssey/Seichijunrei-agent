import type { EvaluationReport, ReportCase, ReportCaseFailure } from 'logfire/evals';

import { caseSubmissionsOf } from '../case-submissions.ts';
import type { ExportedAgentInput } from '../dataset-roundtrip.ts';

/**
 * What a staging run spent, as far as the wire can witness it.
 *
 * TOKENS AND DOLLARS ARE NOT HERE, and that is a measurement, not an omission.
 * Python reads them off `AgentResult.usage` — an in-process object
 * (`exec_tiers._output_usage`). The SD-9 stream publishes no usage part and
 * `GET /v1/conversations/{id}/messages` carries a run status and nothing about
 * cost, so a TS run against the deployed edge has no honest token count to
 * write down. The dollar figure for a double run comes from the provider
 * dashboard; inventing a number here would make the result file look like it
 * had measured one.
 *
 * WHAT IS HONEST is the quota the run puts on the signed-in QA identity, and
 * that is exactly countable: `caseSubmissionsOf` is a pure function of a case's
 * inputs, so the number of `POST /v1/chat` bodies a run calls for is known from
 * the cases alone — history replays included, which is why it is not the case
 * count. It is `turns_planned` rather than `turns_sent` because a case that
 * errored may have got some of its turns away before it did.
 *
 * `task_seconds` IS NOT (#1476). It used to be the sum of `ReportCase
 * .task_duration`, which `logfire/evals` measures as `performance.now()` across
 * the whole task call. `StagingTurnTask.run` enters `InFlightTurns` INSIDE that
 * call, so a case's measured duration is its queue wait plus its turn, and at
 * the documented bound of two the queue wait is most of it: the 662-case run of
 * 2026-09-07 walled 8,795 s and summed 3,043,667 "seconds", with the last case
 * alone reporting 8,793 — the whole run, spent waiting. Neither `ReportCase`
 * nor `ReportCaseFailure` carries a start or an end to difference instead, so
 * the field is `null` rather than a number nobody can read.
 */
/** What the field says instead of a number, so a reader is sent somewhere. */
export const TASK_SECONDS_NOTE = 'see #1476';

export interface RunSpend {
  /** `POST /v1/chat` submissions the run's cases call for, history included. */
  readonly turns_planned: number;
  /** Not measurable from this report (#1476) — see the note above the type. */
  readonly task_seconds: null;
  readonly task_seconds_note: string;
}

type AttemptedCase =
  | ReportCase<ExportedAgentInput>
  | ReportCaseFailure<ExportedAgentInput>;

export function runSpendOf(
  report: EvaluationReport<ExportedAgentInput>,
): RunSpend {
  const attempted: AttemptedCase[] = [...report.cases, ...report.failures];
  return {
    turns_planned: attempted.reduce((total, entry) => total + turnsOf(entry), 0),
    task_seconds: null,
    task_seconds_note: TASK_SECONDS_NOTE,
  };
}

function turnsOf(entry: AttemptedCase): number {
  return caseSubmissionsOf(entry.inputs).length;
}
