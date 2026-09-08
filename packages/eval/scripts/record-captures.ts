/**
 * Record real staging turns into `fixtures/captures/` (W3-2 #1300).
 *
 * The shaper is built and tested against the Python-recorded SD-9 captures in
 * `apps/agent/tests/fixtures/chat_stream/`, because at the time this card was
 * implemented no staging credential was available to make a live one. Those
 * captures are the same wire (#1283 verified the edge frame for frame), so they
 * are a sound subject — but they are not evidence that a LIVE turn shapes the
 * same way. This script is how that evidence gets made once the credential
 * exists, and it writes the same two files per case the tests already read: the
 * stream, and the transcript read that follows it.
 *
 * It records through `StagingTurnTask` rather than beside it. A recorder with
 * its own submission loop would be a second place for the session threading and
 * the retry rule to drift from the thing being measured — and a capture taken
 * differently from the run it is supposed to pin proves nothing.
 *
 * Run it through `record-captures.sh`, which normalises the working directory.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { laneFetch } from "edge-worker/api-test/lane-origin.ts";

import { checkedDatasetName } from "../src/dataset-sets.ts";
import { loadExportedDataset, type ExportedAgentInput } from "../src/dataset-roundtrip.ts";
import { neonAuthBearer, qaSignInFrom } from "../src/neon-auth-bearer.ts";
import { StagingBearer } from "../src/staging-bearer.ts";
import { StagingTurnTask } from "../src/staging-turn-task.ts";

const CAPTURES_DIR = fileURLToPath(new URL("../fixtures/captures/", import.meta.url));

/** One turn at a time: a recording is a handful of named cases, not a run. */
const RECORDING_CONCURRENCY = 1;

function recorder(): StagingTurnTask {
  return new StagingTurnTask({
    door: laneFetch,
    bearer: new StagingBearer(neonAuthBearer(qaSignInFrom(process.env), fetch), () => Date.now()),
    turnId: () => `record-${crypto.randomUUID()}`,
    maxConcurrency: RECORDING_CONCURRENCY,
  });
}

async function transcriptText(task: StagingTurnTask, sessionId: string | null): Promise<string> {
  if (sessionId === null) return "null";
  return JSON.stringify(await task.readTranscript(sessionId), null, 2);
}

async function record(task: StagingTurnTask, name: string, inputs: ExportedAgentInput): Promise<void> {
  const submitted = await task.submitCase(inputs);
  writeFileSync(`${CAPTURES_DIR}${name}.sse`, submitted.turn === null ? "" : await submitted.turn.text(), "utf8");
  writeFileSync(`${CAPTURES_DIR}${name}.messages.json`, `${await transcriptText(task, submitted.sessionId)}\n`, "utf8");
  process.stdout.write(`recorded ${name}\n`);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: { dataset: { type: "string", default: "agent_eval_heldout_v1" } },
    allowPositionals: true,
  });
  const dataset = await loadExportedDataset(checkedDatasetName(values.dataset));
  const task = recorder();
  mkdirSync(CAPTURES_DIR, { recursive: true });
  for (const wanted of positionals) {
    const found = dataset.cases.find((item) => item.name === wanted);
    if (found === undefined) throw new RangeError(`no case named "${wanted}" in ${values.dataset}`);
    await record(task, wanted, found.inputs);
  }
}

await main();
