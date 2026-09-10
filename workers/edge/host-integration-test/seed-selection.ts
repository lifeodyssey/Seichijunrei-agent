import postgres from "@prisma/orm-postgres/runtime";
import contractJson from "@animichi/pi-session-neon/contract" with { type: "json" };
import type { Contract } from "@animichi/pi-session-neon/types";
import { NeonSessionRepo } from "@animichi/pi-session-neon";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/pi-agent-core/harness/context";
import { dsn, pool, SESSION, IDENTITY } from "./postgres.ts";

export const selectedPoint = { id: "point-native", name: "Station", bangumi_id: "123", screenshot_url: "", latitude: 35, longitude: 139 };
export const selectedItinerary = { ordered_points: [selectedPoint], point_count: 1,
  timed_itinerary: { stops: [], legs: [], total_minutes: 10, total_distance_m: 0, pacing: "normal" } };

/** A catalog offer committed by the public SDK is the precondition for a later product selection. */
export async function seedSelectionOffer() {
  const db = postgres<Contract>({ contractJson, url: dsn });
  const repo = new NeonSessionRepo(db);
  const session = await repo.create({ id: SESSION }, context);
  const branch = await session.createBranch("main", null, context);
  await branch.appendMessage({ role: "toolResult", toolCallId: "catalog-offer", toolName: "search_bangumi", timestamp: 0, isError: false,
    content: [], details: { kind: "bangumi", anime_id: "123", rows: [selectedPoint], partial: false } }, context);
  await session.close(context); await db.close();
  await pool.query("INSERT INTO sessions (id,user_id) VALUES ($1,$2)", [SESSION, IDENTITY]);
}
