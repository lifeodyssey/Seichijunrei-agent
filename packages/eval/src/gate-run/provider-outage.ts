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
 * same name — counts, the party to blame and the ceiling in, one sentence out —
 * so `stats-oracle.json`'s `provider_outage_gates` rows pin the ceilings AND the
 * wording. What each runner may put in those last two slots differs, and
 * `DEPLOYED_AGENT_TIER` and `PROVIDER_OUTAGE_CEILING` below are why. Reading the
 * report is per-runner and cannot be shared: Python looks for the boundary's
 * payload on `AgentResult`, this looks for the intent the wire publishes in its
 * place.
 */
import { pythonPercentText } from '../gate/python-number-text.ts';
import { CRASHED_INTENT } from '../turn-transcript.ts';
import type { AgentEvalReport } from './gate-run-result.ts';

/**
 * The share of starved cases above which a run is an outage, not a result.
 *
 * ONE CEILING, WHERE PYTHON NOW HAS TWO (#1499). Python picks by run mode: the
 * capped PR lane keeps this 0.20 (`provider_outage.CAPPED_LANE_CEILING`, itself
 * `smoke_errors.TRANSPORT_RATE_CEILING`'s) and the uncapped lane drops to 0.02,
 * because that lane MINTS the record every later run is judged against and a
 * fifth-starved run minting the floor is a permanent lie rather than one bad
 * report. This runner has nothing to protect there: `gate-exit-code.ts:10` —
 * "this runner never writes the record it is judged by" — so the lower ceiling
 * would guard a write that does not happen. The oracle rows carry the ceiling
 * each was written with, so both lanes' sentences are replayed here without
 * this side pretending it runs both.
 */
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
  ceiling: number,
): string | null {
  const share = evaluated === 0 ? 0 : starved / evaluated;
  if (share <= ceiling) {
    return null;
  }
  return (
    `${String(starved)}/${String(evaluated)} evaluated cases came back as the agent's ` +
    `error payload (${pythonPercentText(share)} > ${pythonPercentText(ceiling)}): ` +
    `${answeredBy} answered nothing the evaluators could score. This run is a ` +
    `provider outage, not a result — re-run it.`
  );
}

/**
 * The evaluated cases whose turn published no answer at all, by name.
 *
 * `provider_outage.starved_case_ids`. Named rather than counted because the
 * metric gate needs to know WHICH pairs the outage took: a metric left with too
 * few pairs is a warning about the sample unless starvation is what emptied it
 * (`metric-gate.ts`, #1499).
 */
export function starvedCaseIdsOf(report: AgentEvalReport): ReadonlySet<string> {
  const starved = report.cases.filter((entry) => entry.output.intent === CRASHED_INTENT);
  return new Set(starved.map((entry) => entry.name));
}

/** How many of them there are — the outage gate's own numerator. */
export function starvedCasesOf(report: AgentEvalReport): number {
  return starvedCaseIdsOf(report).size;
}

/** The gate as `gateRunResultOf` reads it: no failure, or the one sentence. */
export function providerOutageGate(report: AgentEvalReport): string[] {
  const failure = providerOutageFailure(
    starvedCasesOf(report),
    report.cases.length,
    DEPLOYED_AGENT_TIER,
    PROVIDER_OUTAGE_CEILING,
  );
  return failure === null ? [] : [failure];
}
