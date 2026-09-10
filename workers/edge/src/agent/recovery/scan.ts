import type { PostgresClient } from "@prisma/orm-postgres/runtime";
import type { Contract } from "@animichi/pi-session-neon/types";

const PAGE_SIZE = 50;

export function scanSelectionIntents(db: PostgresClient<Contract>, sessionId: string, afterId?: string) {
  return db.orm.public.AgentAdmission.where({ sessionId, kind: "selection" })
    .where((row) => row.state.in(["pending", "accepted"]))
    .orderBy((row) => row.id.asc()).cursor(afterId === undefined ? {} : { id: afterId })
    .limit(PAGE_SIZE).all();
}

export function scanAdmissionIntents(db: PostgresClient<Contract>, sessionId: string, afterId?: string) {
  return db.orm.public.AgentAdmission.where({ sessionId, kind: "model" })
    .where((row) => row.state.in(["pending", "accepted"]))
    .orderBy((row) => row.id.asc()).cursor(afterId === undefined ? {} : { id: afterId })
    .limit(PAGE_SIZE).all();
}

export function scanUnsettledOperations(db: PostgresClient<Contract>, sessionId: string, afterOperationId?: string) {
  return db.orm.public.AgentSettlement.where((row) => row.settledAt.isNull())
    .where((row) => row.admission.some((admission) => admission.sessionId.eq(sessionId)))
    .orderBy((row) => row.operationId.asc()).cursor(afterOperationId === undefined ? {} : { operationId: afterOperationId })
    .limit(PAGE_SIZE).all();
}
