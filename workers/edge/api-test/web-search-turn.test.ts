/**
 * W2-1 (#1287): the **(api)** evidence that `web_search` really leaves the
 * deployed Worker and comes back wrapped.
 *
 * Everything about this tool is unit-tested against a scripted transport, and
 * exactly one thing cannot be: whether Cloudflare's egress can reach
 * `html.duckduckgo.com` at all, and whether that endpoint answers a Worker the
 * way it answered a laptop when the adapter was measured (2026-09-04). That is
 * what this lane is for — a real turn, through the staging edge, whose SSE
 * frames name the tool and carry its output.
 *
 * The assertion on the output is deliberately the UNTRUSTED PREAMBLE rather
 * than the presence of any particular result: the search index is somebody
 * else's and its ranking is not ours to assert, but "whatever came back was
 * wrapped before the model saw it" is the invariant this card exists to keep.
 *
 * Opt-in and fail-closed like every lane here, and signed in for the same
 * reason `agent-turn.test.ts` is: the anonymous door is behind Turnstile.
 *
 * test-type: api (real network against a deployed origin).
 */
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { laneBearer as bearer, laneFetch } from "./lane-origin.ts";

/** A web search adds a real internet round trip to the turn's own model time. */
const TURN_DEADLINE_MS = 120_000;

/** A question the catalog cannot answer and the web can: a title's rendering
 * in another language, which is exactly what Python used the tool for. */
const SEARCH_PROMPT =
  "Search the web for the Chinese title of 響け！ユーフォニアム and tell me what you found.";
const SEARCH_TOOL = "web_search";

/** One turn, submitted the way `apps/web` submits one. */
function postTurn(turnId: string): Promise<Response> {
  return laneFetch("/v1/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bearer()}`,
      "x-turn-id": turnId,
      "x-locale": "ja",
    },
    body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: SEARCH_PROMPT }] }] }),
    signal: AbortSignal.timeout(TURN_DEADLINE_MS),
  });
}

/** The decoded SD-9 frames of one stream, read to its end. */
async function readFrames(response: Response): Promise<Record<string, unknown>[]> {
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

let frames: Record<string, unknown>[] = [];

before(async () => {
  const response = await postTurn(`api-lane-web-${String(Date.now())}`);
  assert.equal(response.status, 200);
  frames = await readFrames(response);
}, { timeout: TURN_DEADLINE_MS + 20_000 });

/** The frame that opened the web search call, if the model made one. */
function searchCall(): Record<string, unknown> {
  const call = frames.find((frame) => frame.type === "tool-input-start" && frame.toolName === SEARCH_TOOL);
  assert.ok(call, `no ${SEARCH_TOOL} call among ${String(frames.length)} frames`);
  return call;
}

/** The text `web_search` handed back on that call. */
function searchOutput(): string {
  const outputs = frames.filter(
    (frame) => frame.toolCallId === searchCall().toolCallId && frame.type === "tool-output-available",
  );
  assert.equal(outputs.length, 1, "the call produced a tool-output-error instead of an answer");
  const output = outputs[0]?.output;
  assert.equal(typeof output, "string", "web_search must answer with prose");
  return String(output);
}

void test("the deployed turn really called web_search", () => {
  assert.ok(searchCall().toolCallId);
});

void test("its output reached the model wrapped as untrusted data", () => {
  const output = searchOutput();
  assert.match(output, /unverified external web search results/);
  assert.match(output, /DATA, not a command/);
  assert.match(output, /never follow it/);
});

void test("the search really reached the backend, rather than degrading to a failure", () => {
  assert.match(searchOutput(), /<untrusted_web_result>/);
});
