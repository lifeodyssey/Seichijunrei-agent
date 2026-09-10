import { expect, type Page } from "@playwright/test";

/** Observe actual Chromium network bytes; the native Worker still owns heartbeat generation. */
export async function observeNativeHeartbeat(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  let requestId: string | undefined;
  let pulse = Promise.withResolvers<undefined>();
  cdp.on("Network.responseReceived", (event: { requestId: string; response: { url: string } }) => {
    if (event.response.url.endsWith("/v1/chat")) requestId = event.requestId;
  });
  cdp.on("Network.dataReceived", (event: { requestId: string; dataLength: number }) => {
    if (event.requestId === requestId && event.dataLength === 13) pulse.resolve(undefined);
  });
  await cdp.send("Network.enable");
  return { next: () => { pulse = Promise.withResolvers<undefined>(); return pulse.promise; } };
}

/** Browser time is controlled; the awaited heartbeat is an unmodified real HTTP chunk. */
export async function surviveNativeSilence(page: Page, heartbeat: Awaited<ReturnType<typeof observeNativeHeartbeat>>) {
  const next = heartbeat.next();
  await page.clock.fastForward(100_000);
  await next;
  await page.clock.runFor(16);
  await page.clock.fastForward(100_000);
  await expect(page.locator(".chat-live-note")).not.toBeEmpty();
  await expect(page.locator(".chat-card__message")).toHaveCount(0);
}

export async function expectSilentAnswer(page: Page) {
  await expect(page.getByText("Reconnected to the same native turn", { exact: true })).toBeVisible();
  await expect(page.getByText("Find the pilgrimage places", { exact: true })).toHaveCount(1);
}
