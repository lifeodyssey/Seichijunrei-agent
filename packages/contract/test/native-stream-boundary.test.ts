import { describe, expect, it } from "vitest";
import { renderInventory } from "../scripts/emit-agent-python.ts";
import { SessionHistoryMessage } from "../src/session-history-contract.ts";
import openapi from "../agent-openapi.json";

describe("native stream ownership", () => {
  it("publishes the edge stream without claiming a Python route implements it", () => {
    expect(openapi.paths["/v1/conversations/{session_id}/stream"].get["x-runtime"]).toBe("edge");
    expect(renderInventory().join("\n")).not.toContain("/v1/conversations/{session_id}/stream");
    expect(renderInventory().join("\n")).toContain("/v1/conversations/{session_id}/messages");
  });

  it("retains native operation identity independently of text and creation time", () => {
    const message = { role: "assistant", content: "Same answer", created_at: "1970-01-01T00:00:00.000Z", operation_id: "native-operation" };
    expect(SessionHistoryMessage.parse(message)).toEqual(message);
  });
});
