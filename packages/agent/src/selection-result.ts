import { ChatResponseDataPart } from "@animichi/contract";
import { Itinerary, Point } from "@animichi/contract/models";
import { z } from "zod";
import { SelectionRequest } from "./selection-input.ts";

export const SelectionResult = z.object({
  request: SelectionRequest, step: z.enum(["plan_selected", "plan_multi", "search_nearby"]),
  status: z.enum(["ok", "empty", "partial", "too_large", "error"]), clarificationId: z.number().int().nullable(),
  rows: z.array(Point), itinerary: Itinerary.optional(), omitted: z.array(z.string()),
  currentAnime: z.object({ bangumiId: z.string(), title: z.string() }).nullable(), response: ChatResponseDataPart,
}).strict();
export type SelectionResult = z.infer<typeof SelectionResult>;
