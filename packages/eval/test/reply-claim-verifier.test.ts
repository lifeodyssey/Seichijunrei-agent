/**
 * What the final-reply verifier decides, and what it refuses to decide (E-3
 * #1382, spec §十 10.3).
 *
 * The two failure modes the spec names for this verifier are the ones the
 * suite is built around: a VACUOUS PASS (scoring 1.0 with no evidence) and a
 * FALSE POSITIVE (marking a true statement false). Each has its own test below,
 * and each names the mutation that kills it.
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
import { shapedCapture } from "./recorded-capture.ts";

const ROWS = { results: { row_count: 2, rows: [{ name: "宇治橋" }, { name: "京阪宇治駅" }] } };

function scoreOf(parts: ReplyTurnParts): Record<string, number> {
  const turn = makeReplyTurn(parts);
  return replyClaimTraceability(turn.inputs, turn.output);
}

void test("a reply whose every claim is sourced scores 1", () => {
  const scores = scoreOf({
    message: "『響け！ユーフォニアム』の聖地を2件見つけました。「宇治橋」から回れます。",
    returns: [{ outcome: "resolved", anime_title: "響け！ユーフォニアム" }, { outcome: "ok", row_count: 2 }],
    data: ROWS,
  });

  assert.deepEqual(scores, { [REPLY_CLAIM_METRIC]: 1 });
});

/**
 * The place name is in no tool return and in none of the published rows, and
 * the reply DID publish rows — so there was something to check it against and
 * it failed. Mutation: make the extractor return no claims and this goes red.
 */
void test("a place name in neither the returns nor the rows scores 0", () => {
  const scores = scoreOf({
    message: "「金閣寺」もルートに入れておきました。",
    returns: [{ outcome: "ok", row_count: 2 }],
    data: ROWS,
  });

  assert.deepEqual(scores, { [REPLY_CLAIM_METRIC]: 0 });
});

void test("a count that contradicts the row count scores 0", () => {
  const scores = scoreOf({
    message: "全部で5件見つかりました。",
    returns: [{ outcome: "ok", row_count: 2 }],
    data: ROWS,
  });

  assert.deepEqual(scores, { [REPLY_CLAIM_METRIC]: 0 });
});

/**
 * The count is compared as a NUMBER, not as text: the reply writes its two in
 * full-width digits and the outcome carries `2`. Mutation: compare
 * `String(row_count)` with the matched digits and this goes red.
 */
void test("a full-width count still equals the row count it states", () => {
  const scores = scoreOf({
    message: "２件の聖地をご案内します。",
    returns: [{ outcome: "ok", row_count: 2 }],
    data: ROWS,
  });

  assert.deepEqual(scores, { [REPLY_CLAIM_METRIC]: 1 });
});

/**
 * A sequel is a different work. Mutation: relax the name comparison to
 * containment and this goes red, because the sequel's name contains the
 * original's.
 */
void test("a sequel title is not the original the tool returned", () => {
  const scores = scoreOf({
    message: "『ラブライブ！ 2』の聖地です。",
    returns: [{ outcome: "resolved", anime_title: "ラブライブ！" }],
    data: ROWS,
  });

  assert.deepEqual(scores, { [REPLY_CLAIM_METRIC]: 0 });
});

/**
 * THE VACUOUS PASS. Nothing in this prose is decidable — no quoted name, no
 * counted number — so the verifier must emit no metric at all. Mutation: score
 * an undecidable reply 1.0 and this goes red.
 */
void test("a reply with no decidable claim is unmeasured, not a pass", () => {
  const scores = scoreOf({
    message: "承知しました。ご希望を教えていただけますか。",
    returns: [{ outcome: "ok", row_count: 2 }],
    data: ROWS,
  });

  assert.deepEqual(scores, {});
});

/**
 * THE FALSE POSITIVE, place-name half. A prose-only answer's `data` is `{}`
 * (`turn-answer-part.ts`), so there are no rows to compare a place name with
 * and the spec records it as unmeasured rather than as wrong. Mutation: judge a
 * prose-only reply's names anyway and this goes red.
 */
void test("a prose-only reply's place name is unmeasured, not wrong", () => {
  const scores = scoreOf({
    message: "「金閣寺」のあたりは京都市内です。",
    returns: [{ outcome: "upstream_unavailable" }],
    data: {},
  });

  assert.deepEqual(scores, {});
});

/**
 * The two recorded turns, which are the only real replies this package has
 * (`apps/agent/tests/fixtures/chat_stream/`). The routed one says 「2件」 and
 * published two stops; the clarification asks a question and asserts nothing.
 * Neither capture records the visitor's own words, so the reply is judged
 * against the environment alone.
 */
const NO_RECORDED_QUERY = makeReplyTurn({ message: "", query: "" }).inputs;

void test("the recorded route capture states the count its itinerary published", () => {
  assert.deepEqual(replyClaimTraceability(NO_RECORDED_QUERY, shapedCapture("search")), {
    [REPLY_CLAIM_METRIC]: 1,
  });
});

void test("the recorded clarification asserts nothing, and is unmeasured", () => {
  assert.deepEqual(replyClaimTraceability(NO_RECORDED_QUERY, shapedCapture("clarify")), {});
});
