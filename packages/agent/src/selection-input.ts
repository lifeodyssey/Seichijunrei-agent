import { z } from "zod";

const ids = z.array(z.string()).transform((values) => [...new Set(values.map((value) => value.trim()).filter(Boolean))]);
export const SelectionRequest = z.discriminatedUnion("of", [
  z.object({ of: z.literal("points"), pointIds: ids, origin: z.string().nullable(), locale: z.string() }).strict(),
  z.object({ of: z.literal("candidates"), candidateIds: ids, clarificationId: z.number().int(), locale: z.string() }).strict(),
]);
export type SelectionRequest = z.infer<typeof SelectionRequest>;

export class SelectionRefused extends Error {
  readonly status = 409;
}
