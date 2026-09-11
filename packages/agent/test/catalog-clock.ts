import assert from "node:assert/strict";
import type { TestContext } from "node:test";

export function catalogClock(context: TestContext) {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  context.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
    const controller = new AbortController();
    setTimeout(() => { controller.abort(new DOMException("Request deadline expired", "TimeoutError")); }, milliseconds);
    return controller.signal;
  });
}

export function pendingCatalog(attempts: number) {
  const received = Array.from({ length: attempts }, () => Promise.withResolvers<{ request: Request; respond: (response: Response) => void }>());
  let index = 0;
  const fetch = (request: Request) => new Promise<Response>((resolve, reject) => {
    const next = received[index++];
    assert.ok(next, "The catalog must not make an extra attempt");
    request.signal.addEventListener("abort", () => {
      const reason: unknown = request.signal.reason;
      assert.ok(reason instanceof Error);
      reject(reason);
    }, { once: true });
    next.resolve({ request, respond: resolve });
  });
  return { fetch, received: (attempt: number) => {
    const next = received[attempt];
    assert.ok(next);
    return next.promise;
  } };
}
