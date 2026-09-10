import { getAgentByName } from "agents";
import type { SessionAgent } from "./session-agent.ts";

/** Best-effort APAC placement applies only to first creation; existing instances do not move. */
export function sessionAgentStub<T extends SessionAgent>(namespace: DurableObjectNamespace<T>, sessionId: string) {
  return getAgentByName(namespace, sessionId, { locationHint: "apac" });
}
