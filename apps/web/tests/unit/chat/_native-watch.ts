import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { respond } from "../../../../../packages/agent/src/tools";
import { fixture, harnessFor } from "../../../../../packages/agent/test/native-tool-fixture";
import { nativeWatchResponse } from "../../../../../workers/edge/src/agent/views/watch-response";
import { SecretScrub } from "../../../../../workers/edge/src/agent/egress/secret-scrub";

export async function preparedNativeWatch(message = "Native recovered answer", sessionId = "session-native") {
  const resources = await fixture(() => Promise.reject(new Error("No catalog call expected")));
  const answer = fauxAssistantMessage(fauxToolCall("respond", { kind: "greeting", message }), { stopReason: "toolUse" });
  const { harness } = await harnessFor(resources.toolContext, [answer], [respond]);
  const lane = await harness.lane("main", BACKGROUND_CONTEXT);
  await lane.accept({ kind: "prompt", prompt: "Hello", operationId: "op-native" }, BACKGROUND_CONTEXT);
  return { lane, drive: () => lane.drive({ operationId: "op-native" }, BACKGROUND_CONTEXT), response: async () => nativeWatchResponse(await lane.watch(BACKGROUND_CONTEXT), sessionId, "op-native", new SecretScrub()), close: () => harness.close(BACKGROUND_CONTEXT) };
}

export async function completedNativeWatch(message?: string, sessionId?: string) {
  const native = await preparedNativeWatch(message, sessionId);
  await native.drive();
  return native;
}
