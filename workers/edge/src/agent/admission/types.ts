import type { LatLng } from "@animichi/contract";
import type { PostgresClient } from "@prisma/orm-postgres/runtime";
import type { Contract } from "@animichi/pi-session-neon/types";

export type AdmissionDatabase = PostgresClient<Contract>;
export type AdmissionTransaction = Parameters<Parameters<AdmissionDatabase["transaction"]>[0]>[0];
export type AdmissionRecord = NonNullable<Awaited<ReturnType<AdmissionDatabase["orm"]["public"]["AgentAdmission"]["first"]>>>;

export interface ModelAdmissionRequest {
  readonly sessionId: string;
  readonly identityId: string;
  readonly payer: "anon" | "user" | "byok";
  readonly clientMessageId: string;
  readonly text: string;
  readonly locale: "ja" | "zh" | "en";
  readonly origin?: LatLng;
  readonly modelIdentity?: { readonly provider: string; readonly modelId: string; readonly baseUrl: string };
}

export interface AdmissionOptions {
  readonly anonymousAllowance: number;
  readonly now: number;
  readonly anonymousDailyBudget?: number;
}

export type ModelAdmissionOutcome =
  | { kind: "accepted" | "replayed" | "pending"; operationId: string }
  | { kind: "rejected"; operationId: string; reason: string }
  | { kind: "blocked" | "conflict" | "forbidden"; operationId: null };
