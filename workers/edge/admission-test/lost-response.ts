import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import { operationResult, type Session, type SessionMutationCallback, type Write } from "@earendil-works/pi-agent-core/harness/session";

/** Fault injection stays on the public native commit boundary; the lane remains real. */
function commitFault(session: Session, matches: (writes: Write[]) => boolean, before: boolean) {
  const mutate = session.mutate.bind(session);
  let armed = true;
  session.mutate = <T>(work: SessionMutationCallback<T>, context: Context) => mutate((mutator, current) => {
    const commit = mutator.commit.bind(mutator);
    mutator.commit = async (writes, inside) => {
      const fail = armed && matches(writes);
      if (fail) armed = false;
      if (fail && before) throw new Error("Injected commit uncertainty");
      const result = await commit(writes, inside);
      if (fail) throw new Error("Injected commit uncertainty");
      return result;
    };
    return work(mutator, current);
  }, context);
}

export function loseNextCommit(session: Session) { commitFault(session, () => true, false); }
export function rejectNextCommit(session: Session) { commitFault(session, () => true, true); }
export function loseTerminalCommit(session: Session, operationId: string) {
  const terminal = operationResult(operationId);
  commitFault(session, (writes) => writes.some((write) => write.kind === "value" && write.op === "set"
    && write.namespace === terminal.namespace && write.key === terminal.key), false);
}
