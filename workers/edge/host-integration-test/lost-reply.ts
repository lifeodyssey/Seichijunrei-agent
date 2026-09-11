import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import { operationMeta, operationResult, type Session, type SessionMutationCallback, type Value, type Write } from "@earendil-works/pi-agent-core/harness/session";

export type LostReplyStage = "accept" | "drive" | "terminal";

function targetsCommit(writes: readonly Write[], stage: LostReplyStage) {
  if (stage === "drive") return writes.some((write) => write.kind === "entry" && write.entry.type === "message" && write.entry.message.role === "assistant")
    && !writes.some((write) => write.kind === "value" && write.namespace === operationResult("unused").namespace);
  const namespace = (stage === "accept" ? operationMeta("unused") : operationResult("unused")).namespace;
  return writes.some((write) => write.kind === "value" && write.op === "set" && write.namespace === namespace);
}

/** The real Neon commit succeeds; only its response is lost. No Session or lane behavior is replaced. */
export function loseNativeReply(session: Session, stage: LostReplyStage, onLoss: () => void) {
  const mutate = session.mutate.bind(session);
  let armed = true;
  session.mutate = <T>(work: SessionMutationCallback<T>, context: Context) => mutate((mutator, current) => {
    const commit = mutator.commit.bind(mutator);
    mutator.commit = async (writes, inside) => {
      const lost = armed && targetsCommit(writes, stage);
      const result = await commit(writes, inside);
      if (lost) { armed = false; onLoss(); throw new Error("Injected lost native response"); }
      return result;
    };
    return work(mutator, current);
  }, context);
}

/** Fail the public terminal-evidence read while retaining the real native Session and its committed data. */
export function gateNativeResultReads(session: Session, blocked: () => boolean, onFailure: () => void) {
  const read = session.getValue.bind(session);
  session.getValue = <T>(address: Value<T>, context: Context) => {
    if (blocked() && address.namespace === operationResult("unused").namespace) {
      onFailure(); return Promise.reject(new Error("Injected native evidence query outage"));
    }
    return read(address, context);
  };
}
