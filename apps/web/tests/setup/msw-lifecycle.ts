import { afterAll, afterEach, beforeAll } from "vitest";
import { assertCleanBoundary, drainInFlightRequests } from "../msw/in-flight-requests";
import { server } from "../msw/node";

// Node MSW swimlane lifecycle, shared by every unit test file.
beforeAll(() => {
  server.listen({ onUnhandledRequest: "bypass" });
});
// The drain has to run ahead of the DOM cleanup: an unmounted tree aborts its
// own fetches and MSW never finishes answering an aborted request, so a drain
// behind cleanup would wait out its bound on every loading-state case. Vitest
// runs `afterEach` as a stack, so this file being last in `setupFiles` puts the
// drain ahead of `dom-cleanup.ts` — but NOT ahead of a `afterEach(cleanup)` a
// test file registers itself, which lands later still. Files do not need their
// own cleanup; `dom-cleanup.ts` already unmounts after every case.
afterEach(async () => {
  const outcome = await drainInFlightRequests();
  server.resetHandlers();
  assertCleanBoundary(outcome);
});
afterAll(() => {
  server.close();
});
