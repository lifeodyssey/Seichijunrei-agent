import type { EvaluationReport, ReportCase, ReportCaseFailure } from 'logfire/evals';

import { caseSubmissionsOf } from '../case-submissions.ts';
import type { ExportedAgentInput } from '../dataset-roundtrip.ts';
import { TURN_SECONDS_ATTRIBUTE } from '../staging-turn-task.ts';

/**
 * What a staging run spent, as far as the wire can witness it.
 *
 * TOKENS AND DOLLARS ARE NOT HERE, and that is a measurement, not an omission.
 * Python reads them off `AgentResult.usage` — an in-process object
 * (`report_case_rows._output_usage`). The SD-9 stream publishes no usage part
 * and `GET /v1/conversations/{id}/messages` carries a run status and nothing
 * about cost, so a TS run against the deployed edge has no honest token count
 * to write down. The dollar figure comes from the provider dashboard; inventing
 * a number here would make the result file look like it had measured one.
 *
 * WHAT IS HONEST is the quota the run puts on the signed-in QA identity, and
 * that is exactly countable: `caseSubmissionsOf` is a pure function of a case's
 * inputs, so the number of `POST /v1/chat` bodies a run calls for is known from
 * the cases alone — history replays included, which is why it is not the case
 * count. It is `turns_planned` rather than `turns_sent` because a case that
 * errored may have got some of its turns away before it did.
 *
 * SO IS `task_seconds`, once it is the turns' OWN seconds (#1476). It cannot be
 * the sum of `ReportCase.task_duration`: the driver takes that difference
 * around the whole task call, and `StagingTurnTask.run` enters `InFlightTurns`
 * inside it, so every case reported its queue wait plus its turn — the 662-case
 * run of 2026-09-07 walled 8,795 s and summed 3,043,667 "seconds", the last case
 * alone reporting 8,793. The task now times itself from inside the slot and
 * writes `TURN_SECONDS_ATTRIBUTE` on the case, and this sums that; the committed
 * 2026-09-07 files keep the `null` they were written with.
 *
 * Only EVALUATED cases carry it, as before. A case that threw is a
 * `ReportCaseFailure`, which the driver builds with no attributes at all, so an
 * errored case contributes turns it planned and no seconds — the same asymmetry,
 * for the same reason, as `turns_planned` counting a case that never got its
 * turns away.
 */
export interface RunSpend {
  /** `POST /v1/chat` submissions the run's cases call for, history included. */
  readonly turns_planned: number;
  /** The turns' own seconds, summed over evaluated cases — no queue wait. */
  readonly task_seconds: number;
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
    task_seconds: millisecondPrecision(report.cases),
  };
}

function turnsOf(entry: AttemptedCase): number {
  return caseSubmissionsOf(entry.inputs).length;
}

/** What this case's own turns took, or nothing when it was run by something
 * that measures no turns — an absent attribute is not a case that took 0 s. */
function turnSecondsOf(entry: ReportCase<ExportedAgentInput>): number {
  const measured = entry.attributes[TURN_SECONDS_ATTRIBUTE];
  return typeof measured === 'number' ? measured : 0;
}

/** Rounded to the millisecond: the runner cannot see finer, and a committed
 * result file should not diff on the sixteenth decimal of a float sum. */
function millisecondPrecision(
  cases: readonly ReportCase<ExportedAgentInput>[],
): number {
  const seconds = cases.reduce((total, entry) => total + turnSecondsOf(entry), 0);
  return Math.round(seconds * 1000) / 1000;
}
