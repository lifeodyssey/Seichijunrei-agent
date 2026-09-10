import type { SelectionRequest, SelectionResult } from "@animichi/agent/selection";
import type { ModelAdmissionRequest } from "../admission/types.ts";

export type SelectionSubmission = Omit<ModelAdmissionRequest, "text" | "locale" | "origin"> & { selection: SelectionRequest };
export type SelectionOutcome =
  | { kind: "settled"; entryId: string; result: SelectionResult }
  | { kind: "pending" | "blocked" | "conflict" | "forbidden" }
  | { kind: "rejected"; reason: string };
