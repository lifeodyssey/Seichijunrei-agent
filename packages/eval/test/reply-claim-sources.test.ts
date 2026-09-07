/**
 * The five traceable sources, one test each (E-3 #1382, spec §十 10.3).
 *
 * Completeness is the whole subject: 「可溯源来源必须完整列举，否则它会把对的判成
 * 错的」. Every case below states a name that is TRUE and lives in exactly one
 * source, in a reply that publishes rows — so dropping that source from the
 * enumeration turns the case from 1 into 0, which is the mutation each test
 * names.
 *
 * test-type: unit (no network, no clock).
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  REPLY_CLAIM_METRIC,
  replyClaimTraceability,
} from "../src/evaluators/reply-claim-verifier.ts";
import { makeReplyTurn, type ReplyTurnParts } from "./make-reply-turn.ts";

/** Rows, so an unsourced name would score 0 rather than going unmeasured. */
const ROWS = { results: { row_count: 1, rows: [{ name: "宇治橋" }] } };

function scoreOf(parts: ReplyTurnParts): Record<string, number> {
  const turn = makeReplyTurn({ data: ROWS, ...parts });
  return replyClaimTraceability(turn.inputs, turn.output);
}

const VERIFIED = { [REPLY_CLAIM_METRIC]: 1 };

void test("source 1: a title this run's tool returned", () => {
  assert.deepEqual(
    scoreOf({
      message: "『涼宮ハルヒの憂鬱』の聖地です。",
      returns: [{ outcome: "resolved", anime_title: "涼宮ハルヒの憂鬱", bangumi_id: "b1" }],
    }),
    VERIFIED,
  );
});

void test("source 2: a place name published in this reply's own rows", () => {
  assert.deepEqual(scoreOf({ message: "まずは「宇治橋」から。", returns: [] }), VERIFIED);
});

void test("source 3: a name the user wrote in this turn's question", () => {
  assert.deepEqual(
    scoreOf({ message: "「西宮北高校」あたりを見てみますね。", query: "西宮北高校の近くの聖地は？" }),
    VERIFIED,
  );
});

void test("source 3: a name the user wrote in an earlier turn of the same case", () => {
  assert.deepEqual(
    scoreOf({ message: "「西宮北高校」の話に戻りますね。", historyPrompts: ["西宮北高校について教えて"] }),
    VERIFIED,
  );
});

/**
 * Source 1's other end, and the status bar's retention line (§九 9.3): the
 * value `retentionLines` quotes back is the CALL's argument
 * (`memory/rescued-entity.ts` — `resolve_anime.title` / `search_nearby.location`
 * out of `run_steps.input`), not anything the tool answered. A model that
 * paraphrased the visitor's words into the argument, saw them on the bar and
 * quoted them back is quoting the context. Mutation: walk `step.output` only
 * and both of these go red.
 */
void test("source 1: a place name a call was made with, off the stream", () => {
  assert.deepEqual(
    scoreOf({
      message: "「伏見稲荷大社」の周辺を探しました。",
      query: "お稲荷さんの近くの聖地",
      callArguments: [{ location: "伏見稲荷大社" }],
    }),
    VERIFIED,
  );
});

void test("source 1: a title a call SETTLED with, which the bar quotes back", () => {
  assert.deepEqual(
    scoreOf({
      message: "『氷菓』を探しています。",
      query: "あの高山が舞台のやつ",
      settledArguments: [{ title: "氷菓" }],
    }),
    VERIFIED,
  );
});

/**
 * §九 9.1 (#1377): the edge replays every run of the session as structured
 * `toolResult` messages, so a title an EARLIER turn's tool returned is in front
 * of the model on this turn. Mutation: drop `priorTrajectory` from the
 * enumeration and this goes red — the reply states a true title and gets 0.
 */
void test("source 4: a title an earlier run's tool returned", () => {
  assert.deepEqual(
    scoreOf({
      message: "『けいおん！』の聖地はまだ残っていますよ。",
      returns: [{ outcome: "ok", row_count: 1 }],
      priorReturns: [{ outcome: "resolved", anime_title: "けいおん！", bangumi_id: "b2" }],
    }),
    VERIFIED,
  );
});

/**
 * §九 9.3 (#1379): the `<agent_status>` bar states the open clarification, and
 * for a seeded case (E-1 #1380) the prefix that raised it was posted through
 * the seeding procedure — no stream exists for source 4 to read it off. The
 * candidate the bar offers is therefore witnessed by `inputs.seeded_pending`.
 */
void test("source 5: a candidate the seeded clarification offered", () => {
  assert.deepEqual(
    scoreOf({
      message: "『Sound Euphonium』と『Haruhi Suzumiya』のどちらでしょうか。",
      seededPending: {
        reason: "anime_ambiguity",
        candidate_ids: ["115908", "11291"],
        ordered_candidates: [
          { id: "115908", title: "Sound Euphonium" },
          { id: "11291", title: "Haruhi Suzumiya" },
        ],
        revision: 7,
      },
    }),
    VERIFIED,
  );
});
