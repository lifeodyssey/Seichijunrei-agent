import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { MemorySessionRepo, type JsonValue } from "@earendil-works/pi-agent-core/harness/session";
import type { Point } from "@animichi/contract/models";
import { createCatalogClient } from "@animichi/agent/tools";
import { z } from "zod";

export const POINT_A = { id: "a", name: "Station", bangumi_id: "123", screenshot_url: "", latitude: 35, longitude: 139 };
export const POINT_B = { ...POINT_A, id: "b", name: "Bridge", latitude: 35.1 };
export const itinerary = (points: Point[]) => ({ ordered_points: points, point_count: points.length,
  timed_itinerary: { stops: [], legs: [], total_minutes: 10, total_distance_m: 0, pacing: "normal" } });

export async function selectionFixture(toolName: string, details: JsonValue) {
  const repo = new MemorySessionRepo({ now: () => 0 });
  const session = await repo.create({}, BACKGROUND_CONTEXT);
  const branch = await session.createBranch("main", null, BACKGROUND_CONTEXT);
  const id = await branch.appendMessage({ role: "toolResult", toolCallId: "offer", toolName, timestamp: 0,
    isError: false, content: [], details }, BACKGROUND_CONTEXT);
  const entries = await branch.findEntries(undefined, BACKGROUND_CONTEXT);
  const revision = entries.find((entry) => entry.id === id)?.seq ?? -1;
  return { repo, session, branch, entries, revision };
}

export function multiCatalog() {
  const first = Promise.withResolvers<undefined>(), second = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>();
  const starts = new Map([["123", first], ["456", second]]);
  const data = new Map([["123", [POINT_A, POINT_B]], ["456", [POINT_A]]]);
  const planned: unknown[] = [];
  const fetchPoints = async (request: Request) => {
    const { bangumi_id } = z.object({ bangumi_id: z.string() }).parse(await request.json());
    starts.get(bangumi_id)?.resolve(undefined);
    await release.promise;
    return Response.json({ rows: data.get(bangumi_id), synced_at: "2026-09-10" });
  };
  const routes = new Map<string, (request: Request) => Promise<Response>>([
    ["/catalog/points-by-bangumi-id", fetchPoints],
    ["/catalog/itinerary", async (request) => { planned.push(await request.json()); return Response.json(itinerary([POINT_A, POINT_B])); }],
  ]);
  const catalog = createCatalogClient((request) => routes.get(new URL(request.url).pathname)?.(request) ?? Promise.reject(new Error("Unexpected catalog call")));
  return { catalog, planned, first, second, release };
}
