import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import type { Session, SessionMutationCallback } from "@earendil-works/pi-agent-core/harness/session";
import { SELECTION_ENTRY } from "@animichi/agent/selection-entry";

/** Inject only at the real native custom-entry commit, leaving the SDK lane and Neon storage intact. */
export function atSelectionCommit(session: Session, when: "before" | "after", fail: () => Promise<void>) {
  const mutate = session.mutate.bind(session);
  let armed = true;
  session.mutate = <T>(work: SessionMutationCallback<T>, context: Context) => mutate((mutator, current) => {
    const commit = mutator.commit.bind(mutator);
    mutator.commit = async (writes, inside) => {
      const selected = armed && writes.some((write) => write.kind === "entry" && write.entry.type === "custom" && write.entry.customType === SELECTION_ENTRY);
      if (selected) armed = false;
      if (selected && when === "before") await fail();
      const result = await commit(writes, inside);
      if (selected && when === "after") await fail();
      return result;
    };
    return work(mutator, current);
  }, context);
}
