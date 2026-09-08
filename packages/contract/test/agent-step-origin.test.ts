/**
 * #1462: the origin marker a step-opening SD-9 frame carries.
 *
 * The property the whole decision rests on is that it is ADDITIVE. Every frame
 * recorded before this member existed — the captures under
 * `apps/agent/tests/fixtures/chat_stream/`, any deploy older than this card —
 * must keep meaning exactly what it meant, or a reader on the old shape starts
 * calling model calls something else. So absence reads back as `model`, and only
 * the marker the edge writes reads back as `server`.
 *
 * test-type: api.
 */

import { describe, expect, it } from "vitest";
import { serverStepOrigin, stepOriginOf } from "../src/agent-step-origin.js";

/** A step-opening frame as `turn-frames.ts` builds one. */
function openedFrame(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "tool-input-start", toolCallId: "call-1", toolName: "plan_multi", ...extra };
}

describe("who asked for a step", () => {
  it("marks a server-opened step under the protocol's own metadata slot", () => {
    expect(serverStepOrigin()).toEqual({ toolMetadata: { origin: "server" } });
    expect(stepOriginOf(openedFrame(serverStepOrigin()))).toBe("server");
  });

  it("reads a frame with no marker as the model's own call", () => {
    expect(stepOriginOf(openedFrame())).toBe("model");
  });

  it("reads a frame whose metadata carries other members as the model's own call", () => {
    expect(stepOriginOf(openedFrame({ toolMetadata: { title: "検索中" } }))).toBe("model");
  });

  it("refuses to read an origin out of a metadata member that is not a map", () => {
    expect(stepOriginOf(openedFrame({ toolMetadata: null }))).toBe("model");
    expect(stepOriginOf(openedFrame({ toolMetadata: "server" }))).toBe("model");
  });
});
