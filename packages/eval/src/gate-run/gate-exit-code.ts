import type { GateRunResult } from './gate-run-result.ts';

/**
 * `run_agent_eval.gate_exit_code`: only a failure blocks.
 *
 * The three-way verdict collapses to two here, and the collapse is the point —
 * `indeterminate` and a metric that had too few paired cases are reported as
 * warnings and exit zero, because a gate that blocked on "not enough evidence"
 * would block on noise. Python's third answer (`None`, "baseline created")
 * has no counterpart: this runner never writes the record it is judged by.
 * Since #1515 one CAN be minted from a finished run, but by a separate command
 * over the committed result file (`baseline-capture.ts`), so this function
 * still has two answers and not three.
 */
export function gateExitCode(result: GateRunResult): number {
  return result.failures.length > 0 ? 1 : 0;
}
