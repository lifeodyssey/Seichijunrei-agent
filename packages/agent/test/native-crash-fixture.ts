import { mock } from "node:test";
import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import type { Session, SessionMutationCallback, Write } from "@earendil-works/pi-agent-core/harness/session";

export function failCommitsAfterEffect(session: Session, effectOccurred: () => boolean) {
  const mutate = session.mutate.bind(session);
  return mock.method(session, "mutate", <T>(callback: SessionMutationCallback<T>, context: Context) =>
    mutate((mutator, inside) => {
      const commit = mutator.commit.bind(mutator);
      mock.method(mutator, "commit", (writes: Write[], current: Context) => effectOccurred() ? Promise.reject(new Error("simulated storage loss")) : commit(writes, current));
      return callback(mutator, inside);
    }, context));
}
