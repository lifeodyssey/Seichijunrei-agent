/**
 * The per-claim verdicts, pinned to the verifier they were taken from (E-4
 * #1383 over E-3 #1382).
 *
 * `reply-claim-verifier.ts` folds its verdicts with `Math.min` and keeps the
 * per-claim answers private, so attribution restates the two-line verdict for a
 * name and for a count. That restatement is only safe while it agrees with the
 * original, and this file is the agreement: over every turn below, the minimum
 * of these verdicts is exactly the metric the verifier reports, and "no decided
 * claim" is exactly the verifier's `{}`.
 *
 * test-type: unit (constructed turns, no network).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  REPLY_CLAIM_METRIC,
  replyClaimTraceability,
} from '../src/evaluators/reply-claim-verifier.ts';
import { decidedClaimsOf } from '../src/gate-run/unsourced-claims.ts';
import { makeReplyTurn, type ReplyTurn } from './make-reply-turn.ts';

/** One turn per answer the verifier can give, so the fold is exercised both ways. */
const decidable: readonly ReplyTurn[] = [
  makeReplyTurn({ message: '2件見つかりました。', returns: [{ row_count: 2 }] }),
  makeReplyTurn({ message: '5件見つかりました。', returns: [{ row_count: 2 }] }),
  makeReplyTurn({
    message: '「響け！ユーフォニアム」の2件です。',
    returns: [{ anime_title: '響け！ユーフォニアム', row_count: 2 }],
  }),
  makeReplyTurn({
    message: '「架空の作品」の2件です。',
    returns: [{ row_count: 2 }],
    data: { results: { rows: [{ name: '宇治橋' }] } },
  }),
];

const undecidable: readonly ReplyTurn[] = [
  makeReplyTurn({ message: '承知しました。' }),
  makeReplyTurn({ message: '「架空の作品」について調べます。' }),
];

function foldedVerdict(turn: ReplyTurn): number {
  return Math.min(...decidedClaimsOf(turn.inputs, turn.output).map((claim) => claim.verdict));
}

function verifierScore(turn: ReplyTurn): number | undefined {
  return replyClaimTraceability(turn.inputs, turn.output)[REPLY_CLAIM_METRIC];
}

void test('the minimum of the per-claim verdicts is what the verifier reports', () => {
  assert.deepEqual(decidable.map(foldedVerdict), decidable.map(verifierScore));
  assert.deepEqual(decidable.map(verifierScore), [1, 0, 1, 0]);
});

void test('a turn with no decided claim is the verifier’s own empty record', () => {
  assert.deepEqual(
    undecidable.map((turn) => decidedClaimsOf(turn.inputs, turn.output)),
    [[], []],
  );
  assert.deepEqual(
    undecidable.map((turn) => replyClaimTraceability(turn.inputs, turn.output)),
    [{}, {}],
  );
});

void test('a decided claim keeps its place in the reply, which is what places it', () => {
  const twoClaims = makeReplyTurn({
    message: '「架空の作品」の5件です。',
    returns: [{ row_count: 2 }],
    data: { results: { rows: [{ name: '宇治橋' }] } },
  });

  assert.deepEqual(decidedClaimsOf(twoClaims.inputs, twoClaims.output), [
    { index: 0, of: 'name', text: '架空の作品', verdict: 0 },
    { index: 1, of: 'count', text: '5', verdict: 0 },
  ]);
});
