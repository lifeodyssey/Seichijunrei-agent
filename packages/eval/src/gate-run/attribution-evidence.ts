/**
 * The raw evidence behind each attribution, and the reason it is NOT in git
 * (E-4 #1383, spec §十 10.4 「证据的存放位置是硬约束」).
 *
 * WHY THE SPLIT EXISTS. `results/` is committed, and it is committable precisely
 * because 「Nothing here is a secret: scores, intervals and case counts」
 * (`result-file.ts`). Attribution evidence is the opposite kind of thing: the
 * visitor's own query, the model's reply, and the tool returns those were built
 * from. Neon does not even grant `run_steps` to the `readonly` role, because
 * 「a tool's input and result carry the visitor's own query text」
 * (`migrations/neon/20260902000000_agent_runs.sql:10-12`); and a failed
 * `injection_g1_v1` case carries the injection payload itself, which is text
 * written to make whoever reads it next do something. Committing that would put
 * an attack string in every clone of the repository, permanently.
 *
 * SO THE COMMITTED FILE CARRIES A REFERENCE and this file carries the text. Same
 * analysis, two projections (`failure-attribution.ts`): the committed one drops
 * every raw member, and `test/gate-run-attribution-evidence.test.ts` proves the
 * drop with an `injection_g1_v1`-shaped case whose query is a marker string —
 * present in this artifact, absent from the committed bytes.
 *
 * LAYOUT. One directory the whole run writes into, one file per gate run, one
 * JSON object per line:
 *
 *     packages/eval/artifacts/attribution/<generated_at date>-<dataset>.jsonl
 *
 * Named off the SAME two facts as the result file it belongs to
 * (`resultFileName`), so a reader holding a committed result knows which
 * artifact to fetch without a second index; JSON Lines because a failed run of
 * 662 cases is a few hundred records that want grepping one at a time, and
 * because a truncated upload loses the tail rather than the whole file.
 * `artifacts/` is gitignored — the directory, not the file, so a new artifact
 * kind cannot land in a commit by being new.
 *
 * NO CI LANE RUNS `eval:gate` TODAY, and this file must not pretend otherwise.
 * `agent-eval-nightly.yml` runs the PYTHON suite with steps of its own;
 * `eval:gate` appears in no workflow or script. The TS gate is run by hand from
 * a worktree against staging, and giving it a lane is part of W3-5's plan
 * (#1303).
 *
 * WHAT THAT LANE MUST DO WHEN IT EXISTS (this card wires no workflow): one step
 * after the run, `actions/upload-artifact` with `path: packages/eval/artifacts/`,
 * `name: eval-attribution-evidence`, and `if: always()` so the evidence for a run
 * that exited 1 — the only run anybody wants the evidence for — is uploaded too.
 * Access control and retention are then GitHub's: readable by whoever can read
 * the repository's actions, expiring with the workflow's retention period, which
 * is the access-controlled, expiring home the spec asks for. The step must never
 * `git add` the directory. Until then the file is written beside a hand-run gate
 * and stays on the runner's disk, which is still not git.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { TranscriptStep } from '../turn-transcript.ts';
import type { FailedCase, FailureAnalysis } from './failure-attribution.ts';

/** Where a run's evidence lands, relative to `packages/eval`. */
export const EVIDENCE_DIR = 'artifacts/attribution';

export const EVIDENCE_ROOT = fileURLToPath(new URL('../../artifacts/attribution/', import.meta.url));

/** The reference the committed result carries — the same date and set the
 * result file itself is named for, so the pair is findable from either side. */
export function attributionEvidenceRef(generatedAt: string, dataset: string): string {
  return `${EVIDENCE_DIR}/${generatedAt.slice(0, 10)}-${dataset}.jsonl`;
}

/** One step, with the index the attribution points at. */
function evidenceStep(step: TranscriptStep, index: number): Record<string, unknown> {
  return {
    index,
    tool: step.toolName,
    status: step.status,
    args: step.args,
    params: step.params,
    output: step.output,
  };
}

function evidenceLine(one: FailedCase): string {
  return JSON.stringify({
    case_id: one.caseId,
    cause: one.cause,
    consequences: one.consequences,
    failed_metrics: one.failedMetrics,
    query: one.inputs.query,
    reply: one.output.message,
    trajectory: one.output.trajectory.map(evidenceStep),
    prior_trajectory: one.output.priorTrajectory.map(evidenceStep),
    claims: one.claims,
  });
}

/** The artifact's whole body. Empty when nothing was attributed — an empty file
 * still says "this run wrote its evidence and there was none". */
export function attributionEvidenceText(analysis: FailureAnalysis): string {
  return analysis.failedCases.map((one) => `${evidenceLine(one)}\n`).join('');
}

export function writeAttributionEvidence(
  analysis: FailureAnalysis,
  reference: string,
  evidenceRoot: string = EVIDENCE_ROOT,
): string {
  mkdirSync(evidenceRoot, { recursive: true });
  const path = `${evidenceRoot.replace(/\/$/u, '')}/${reference.split('/').pop() ?? ''}`;
  writeFileSync(path, attributionEvidenceText(analysis), 'utf8');
  return path;
}
