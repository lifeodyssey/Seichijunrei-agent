import { server } from "./node";
import { CHAT_URL } from "./chat-stream-base";

/**
 * A promise over MSW's own life-cycle events: it settles once the chat endpoint
 * has ANSWERED the turns an act fires (issue #1503).
 *
 * Arm it BEFORE the act, then await it before querying the DOM. Without it a
 * test spends a `findBy*` wall clock waiting for a request the starved runner
 * has not even scheduled yet: the query times out, the case fails for a reason
 * that has nothing to do with the behaviour under test, and — worse — the
 * abandoned request is still in flight when the next case installs ITS
 * handlers, so the leaked answer lands in the next case's recorder and
 * re-indexes every positional assertion in it.
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
