import { chromium, expect, type Page } from "@playwright/test";
import type { TestContext } from "node:test";

/** Browser controls only: all chat submissions and snapshots reach the actual native Worker. */
export async function nativeRecoveryPage(context: TestContext, baseURL: string) {
  const browser = await chromium.launch({ headless: true });
  context.after(() => browser.close());
  const page = await browser.newPage({ baseURL, locale: "en-US", viewport: { width: 1280, height: 900 } });
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await page.route("**/v1/turnstile/verify", (route) => route.fulfill({ status: 204 }));
  await page.route("**/healthz", (route) => route.fulfill({ status: 200, body: "healthy" }));
  await page.goto("/chat");
  await solveTurnstileEntry(page);
  await expect(page.getByRole("textbox")).toBeEnabled();
  return page;
}

export async function submitNativeChat(page: Page) {
  const response = page.waitForResponse((res) => res.url().endsWith("/v1/chat") && res.request().method() === "POST");
  await page.getByRole("textbox").fill("Find the pilgrimage places");
  await page.getByRole("textbox").press("Enter");
  const headers = await (await response).allHeaders();
  const sessionId = headers["x-session-id"]; const operationId = headers["x-operation-id"];
  if (!sessionId || !operationId) throw new Error("Native acceptance must return both identities before its body");
  await expect(page).toHaveURL(new RegExp(`session=${sessionId}`));
  return { sessionId, operationId };
}

export async function leaveAndReturn(page: Page) {
  await page.locator('a[href^="/settings"]').filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/\/settings\?session=/);
  const resumed = page.waitForResponse((response) => /\/v1\/conversations\/[^/]+\/stream/.test(response.url()));
  await page.locator('a[href^="/chat?session="]').click();
  await solveTurnstileEntry(page);
  expect((await resumed).status()).toBe(200);
  await expect(page.locator('[data-tool="search_bangumi"][data-status="running"]')).toBeVisible();
}

export async function expectNativeAnswer(page: Page) {
  await expect(page.getByText("Finished", { exact: true })).toBeVisible();
  await expect(page.getByText("Find the pilgrimage places", { exact: true })).toHaveCount(1);
  const step = page.locator('[data-tool="search_bangumi"][data-status="done"]');
  const details = page.locator("details").filter({ has: step });
  await expect(step).toHaveCount(1);
  await expect(details).not.toHaveAttribute("open");
  await details.locator("summary").click();
  await expect(step).toBeVisible();
}

async function solveTurnstileEntry(page: Page) {
  await page.waitForFunction("typeof window.onAnimichiTurnstile === 'function'");
  await page.evaluate("window.onAnimichiTurnstile('e2e-entry-token')");
}
