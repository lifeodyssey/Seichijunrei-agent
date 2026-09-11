import { z } from "zod";
import { encodedBytes } from "./trusted-text.ts";

/** Native tool-result details keep these optional annotations beside the complete domain payload. */
export const FrozenSummary = z.string();
export const ExecutedFacts = z.object({
  pacing: z.enum(["chill", "normal", "packed"]).optional(),
  retainedEntity: z.string().refine((value) => encodedBytes(value) <= 96, "Retained entity exceeds 96 bytes").optional(),
}).strict();
