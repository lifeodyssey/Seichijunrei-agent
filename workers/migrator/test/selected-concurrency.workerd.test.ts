import { afterEach, describe, expect, it } from "vitest";
import type { Miniflare } from "miniflare";
import { revision } from "./preflight-fixtures";
import { selectedWorker } from "./selected-workerd";
import { selectedTransport, type SelectedLedger } from "./selected-neon-transport";

let runtime: Miniflare | undefined;
afterEach(async () => { await runtime?.dispose(); });

describe("concurrent selected migrations", () => {
  it("validates the queued apply after the first request records an incomplete revision", async () => {
    const db: SelectedLedger = { rows: [revision()], statements: [], headers: [], failNextTransaction: true };
    const worker = await selectedWorker(selectedTransport(db));
    runtime = worker.runtime;
    const responses = await Promise.all([worker.request(), worker.request()].map(async (pending) => {
      const response = await pending;
      return { status: response.status, body: await response.json() };
    }));
    expect(responses.map(({ status }) => status).sort()).toEqual([422, 500]);
    const bodies = responses.map(({ body }) => body);
    expect(bodies).toEqual(expect.arrayContaining([expect.objectContaining({ error: "incomplete_revision" })]));
    expect(JSON.stringify(bodies)).not.toContain("password=fixture");
  });
});
