import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import { MemorySessionRepo, operationResult, type Session, type SessionMetadata, type SessionMutationCallback, type Write } from "@earendil-works/pi-agent-core/harness/session";

/** Fault injection calls the native commit first, then loses only its response. */
export class HostFaultRepo extends MemorySessionRepo {
  loseCommit: "accept" | "terminal" | undefined;
  failNextOpen = false;
  opens = 0;

  override async open(metadata: SessionMetadata, context: Context) {
    if (this.failNextOpen) { this.failNextOpen = false; throw new Error("Injected reopen outage"); }
    const session = await super.open(metadata, context);
    this.opens += 1;
    interceptCommit(session, (writes) => this.shouldLose(writes));
    return session;
  }

  private shouldLose(writes: Write[]) {
    const terminal = operationResult("lost");
    const lose = this.loseCommit === "accept" || this.loseCommit === "terminal" && writes.some((write) =>
      write.kind === "value" && write.op === "set" && write.namespace === terminal.namespace && write.key === terminal.key);
    if (lose) this.loseCommit = undefined;
    return lose;
  }
}

function interceptCommit(session: Session, lose: (writes: Write[]) => boolean) {
  const mutate = session.mutate.bind(session);
  session.mutate = <T>(work: SessionMutationCallback<T>, context: Context) => mutate((mutator, current) => {
    const commit = mutator.commit.bind(mutator);
    mutator.commit = async (writes, inside) => {
      const result = await commit(writes, inside);
      if (lose(writes)) throw new Error("Injected lost commit response");
      return result;
    };
    return work(mutator, current);
  }, context);
}
