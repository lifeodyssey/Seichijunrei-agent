import type { PostgresClient } from "@prisma/orm-postgres/runtime";
import type { Contract } from "./contract.d.ts";

export type SessionDatabase = PostgresClient<Contract>;
export type SessionTransaction = Parameters<Parameters<SessionDatabase["transaction"]>[0]>[0];
export type SessionReader = Pick<SessionDatabase, "orm">;
