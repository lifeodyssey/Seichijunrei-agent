/**
 * Run one exported dataset against the DEPLOYED edge and print the report
 * (W3-2 #1300).
 *
 * The composition root, and the only file in this package that reads a
 * credential or touches the network. `src/` stays injectable so it can be
 * tested with a fake fetch; the real door, the real clock and the real QA
 * identity are wired here.
 *
 * THE DOOR IS `api-test/lane-origin.ts`, imported rather than reimplemented.
 * That module resolves `CATALOG_API_ORIGIN`, refuses a non-loopback origin that
 * is not HTTPS, attaches `x-staging-key` and the Cloudflare Access service token
 * headers to every request, and forbids following
 * a redirect (#1291, #1294). A second implementation of those four rules is
 * three places for one of them to be forgotten — and the request that forgot is
 * the one that carries a Neon Auth bearer to wherever a `Location` header
 * pointed. `test/staging-door.test.ts` holds this file to it.
 *
 * WHAT THE REPORT WILL SAY TODAY: every evaluator is still `UnimplementedEvaluator`
 * (W3-1), so each case reports `not implemented: <name>` beside a fully shaped
 * output. That is the expected state until W3-3 lands the eight real ones — the
 * shaped `output` column is what this card is asking you to read.
 *
 * Usage (from the repo root):
 *
 *   CATALOG_API_ORIGIN=https://staging.animichi.com \
 *   STAGING_GATE_TOKEN=… CF_ACCESS_CLIENT_ID=… CF_ACCESS_CLIENT_SECRET=… \
 *   NEON_AUTH_BASE_URL=… \
 *   QA_NEON_USER_EMAIL=… QA_NEON_USER_PASSWORD=… \
 *   pnpm --filter @animichi/eval run eval:staging -- --dataset agent_eval_heldout_v1 --limit 3
 */
import { parseArgs } from "node:util";

import { renderReport } from "logfire/evals";
import { laneFetch } from "edge-worker/api-test/lane-origin.ts";

import { checkedDatasetName } from "../src/dataset-sets.ts";
import { seededPrefixLifecycle } from "../src/prefix-seeding-lifecycle.ts";
import { SeededSessions } from "../src/seeded-sessions.ts";
import { loadExportedDataset } from "../src/dataset-roundtrip.ts";
import { neonAuthBearer, qaSignInFrom } from "../src/neon-auth-bearer.ts";
import { StagingBearer } from "../src/staging-bearer.ts";
import { DEFAULT_MAX_CONCURRENCY, StagingTurnTask } from "../src/staging-turn-task.ts";
import type { TranscriptResult } from "../src/turn-transcript.ts";

/** The default set: 33 held-out cases, the smallest honest end-to-end run. */
const DEFAULT_DATASET = "agent_eval_heldout_v1";

interface StagingRunArgs {
  readonly dataset: string;
  readonly limit: number | null;
  readonly concurrency: number;
}

function positiveInteger(raw: string | undefined, flag: string): number | null {
  if (raw === undefined) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${flag} must be a positive integer`);
  return value;
}

function runArgs(argv: readonly string[]): StagingRunArgs {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      dataset: { type: "string", default: DEFAULT_DATASET },
      limit: { type: "string" },
      concurrency: { type: "string" },
    },
  });
  return {
    dataset: checkedDatasetName(values.dataset),
    limit: positiveInteger(values.limit, "--limit"),
    concurrency: positiveInteger(values.concurrency, "--concurrency") ?? DEFAULT_MAX_CONCURRENCY,
  };
}

/** One QA sign-in, re-minted on age rather than read from a file. */
function stagingBearer(): StagingBearer {
  return new StagingBearer(neonAuthBearer(qaSignInFrom(process.env), fetch), () => Date.now());
}

async function main(): Promise<void> {
  const args = runArgs(process.argv.slice(2));
  const dataset = await loadExportedDataset<TranscriptResult>(args.dataset);
  // Python caps the same way (`exec_tiers.cap_cases` under `EVAL_MAX_CASES`).
  if (args.limit !== null) dataset.cases = dataset.cases.slice(0, args.limit);
  const bearer = stagingBearer();
  // E-1 #1380: the register that ties a case's seeded prefix to the session its
  // measured turn runs on. One instance for both halves of the run — the
  // lifecycle writes it, the task reads it.
  const sessions = new SeededSessions();
  const task = new StagingTurnTask({
    door: laneFetch,
    bearer,
    turnId: () => `eval-${crypto.randomUUID()}`,
    maxConcurrency: args.concurrency,
    sessions,
  });
  const lifecycle = seededPrefixLifecycle<TranscriptResult>({
    door: laneFetch, bearer, sessions, sessionId: () => `eval-prefix-${crypto.randomUUID()}`,
  });
  const report = await dataset.evaluate(task.asTask(), {
    name: `staging_${args.dataset}`, progress: true, lifecycle,
  });
  process.stdout.write(`${renderReport(report)}\n`);
}

await main();
