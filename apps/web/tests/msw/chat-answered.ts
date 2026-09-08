import { server } from "./node";
import { CHAT_URL } from "./chat-stream-base";

/**
 * A promise over MSW's own life-cycle events: it settles once the chat endpoint
 * has ANSWERED the turns an act fires (issue #1503).
 *
 * Arm it BEFORE the act, then await it before querying the DOM. Without it a
 * test spends a `findBy*` wall clock waiting for a request the starved runner
 * has not even scheduled yet: the query times out and the case fails for a
 * reason that has nothing to do with the behaviour under test.
 *
 * The cross-case half of that hazard — an abandoned turn answered into the
 * NEXT case's recorder — is no longer this helper's job: `in-flight-requests`
 * drains it in the shared `afterEach` for every file (issue #1514). This one
 * stays for what it alone can do: state, in the case that needs it, that the
 * turn must be answered before the assertions run.
 */
export function chatTurnsAnswered(count = 1): Promise<void> {
  const pending = { remaining: count };
  return new Promise<void>((resolve) => {
    const settle = (event: { readonly request: Request }): void => {
      if (!isLastTurn(pending, event.request)) return;
      server.events.removeListener("response:mocked", settle);
      resolve();
    };
    server.events.on("response:mocked", settle);
  });
}

/** Count an answered chat turn off the wait; other endpoints never settle it. */
function isLastTurn(pending: { remaining: number }, request: Request): boolean {
  if (request.url !== CHAT_URL) return false;
  pending.remaining -= 1;
  return pending.remaining <= 0;
}
