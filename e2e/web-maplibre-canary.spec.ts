import { expect, test, type Page } from "@playwright/test";

test.use({
  baseURL: process.env.E2E_WEB_BASE_URL ?? "http://localhost:3000",
});

const openCanary = async (page: Page, mode: "fallback" | "happy"): Promise<string[]> => {
  const errors: string[] = [];
  page.on("pageerror", (error) => { errors.push(error.message); });
  // `_dev` is a pathless TanStack route segment; the public URL is `/map-canary`.
  await page.goto(`/map-canary?mode=${mode}`);
  return errors;
};

// `sourced` (not `ready`) is the assertion that matters: reaching `ready` only
// proves the style parsed, while the canary's geojson source can only finish
// loading if the tile worker asset is actually served. A worker 404 is not a
// page error, so it slips past every other check here.
test("MapLibre happy path loads its source and cleans up on unmount", async ({ page }) => {
  const failures: string[] = [];
  page.on("requestfailed", (request) => { failures.push(request.url()); });
  page.on("response", (response) => {
    if (!response.ok()) failures.push(`${String(response.status())} ${response.url()}`);
  });
  const errors = await openCanary(page, "happy");
  const status = page.getByRole("status");
  await expect(status).toHaveText("Status: sourced");
  expect(errors).toEqual([]);
  expect(failures.filter((entry) => entry.includes("maplibre"))).toEqual([]);

  await page.getByRole("button", { name: "Unmount map" }).click();
  await expect(status).toHaveText("Status: unmounted");
  expect(errors).toEqual([]);
});

test("MapLibre setup failures are observable as fallback without a page error", async ({ page }) => {
  const errors = await openCanary(page, "fallback");
  await expect(page.getByRole("status")).toHaveText("Status: fallback");
  expect(errors).toEqual([]);
});
