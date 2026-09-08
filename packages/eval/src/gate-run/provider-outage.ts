/**
 * Refuse a staging run the deployed agent starved (#1496).
 *
 * PYTHON'S BLIND SPOT IS THIS RUNNER'S TOO, and for a nearer reason. In process
 * the error boundary answers an unclassified agent-loop exception with a clean
 * `ErrorResponseModel` result, so the case is EVALUATED rather than failed and
 * `errorRateGate` — whose numerator is `report.failures` — never sees it. Over
 * the wire, `StagingTurnTask` retries only a request that never reached the app
 * and shapes everything the app ANSWERS into a transcript
 * (`staging-turn-task.ts`); a turn that came back as the edge's error envelope
 * therefore publishes no `data-response` part, `transcriptResultOf` reads its
 * `intent` as `CRASHED_INTENT` (`turn-transcript.ts`), and the case is
 * evaluated too. Both runners then score the seven columns a stepless turn
 * still emits and call an outage a result.
 *
 * `providerOutageFailure` is the port of `provider_outage.py`'s function of the
 * same name — counts and the party to blame in, one sentence out — so
 * `stats-oracle.json`'s `provider_outage_gates` rows pin the ceiling AND the
 * wording. What each runner may put in that last slot differs, and
 * `DEPLOYED_AGENT_TIER` below is why. Reading the
 * report is per-runner and cannot be shared: Python looks for the boundary's
 * payload on `AgentResult`, this looks for the intent the wire publishes in its
 * place.
 */
import { pythonPercentText } from '../gate/python-number-text.ts';
import { CRASHED_INTENT } from '../turn-transcript.ts';
import type { AgentEvalReport } from './gate-run-result.ts';

/** The share of starved cases above which a run is an outage, not a result.
 * `provider_outage.PROVIDER_OUTAGE_CEILING`, itself `smoke_errors`'. */
export const PROVIDER_OUTAGE_CEILING = 0.2;

/**
 * What this runner can honestly blame, and it is not a model.
 *
 * The deploy answers with whatever model it is configured with and publishes
 * none of it on the wire — `python-baseline.ts` says so of the one model name
 * this package holds, which is the BASELINE's identity. `gateRunResultOf` is a
 * pure function over a finished report and the door's origin lives in
 * `scripts/eval-gate.ts`, so the surface is named rather than resolved. Python
 * passes its own `model_id`, which its runner does know.
 */
export const DEPLOYED_AGENT_TIER = 'the deployed agent tier';

export function providerOutageFailure(
  starved: number,
  evaluated: number,
  answeredBy: string,
): string | null {
  const share = evaluated === 0 ? 0 : starved / evaluated;
  if (share <= PROVIDER_OUTAGE_CEILING) {
    return null;
  }
  return (
    `${String(starved)}/${String(evaluated)} evaluated cases came back as the agent's ` +
    `error payload (${pythonPercentText(share)} > ${pythonPercentText(PROVIDER_OUTAGE_CEILING)}): ` +
    `${answeredBy} answered nothing the evaluators could score. This run is a ` +
    `provider outage, not a result — re-run it.`
  );
}

/** The evaluated cases whose turn published no answer at all. */
export function starvedCasesOf(report: AgentEvalReport): number {
  return report.cases.filter((entry) => entry.output.intent === CRASHED_INTENT).length;
}

/** The gate as `gateRunResultOf` reads it: no failure, or the one sentence. */
export function providerOutageGate(report: AgentEvalReport): string[] {
  const failure = providerOutageFailure(
    starvedCasesOf(report),
    report.cases.length,
    DEPLOYED_AGENT_TIER,
  );
  return failure === null ? [] : [failure];
}
