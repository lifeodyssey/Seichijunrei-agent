import type { AdmissionDatabase, AdmissionTransaction } from "../src/agent/admission/types.ts";

type TransactionWork<T> = (tx: AdmissionTransaction) => PromiseLike<T>;

async function acknowledge<T>(transaction: AdmissionDatabase["transaction"], work: TransactionWork<T>, matches: () => Promise<boolean>, state: { lost: boolean }) {
  const result = await transaction(work);
  if (state.lost || !await matches()) return result;
  state.lost = true;
  throw new Error("Injected committed transaction acknowledgement loss");
}

/** Lose only the response to a real, successfully committed Prisma transaction. */
export function loseCommittedAcknowledgement(db: AdmissionDatabase, matches: () => Promise<boolean>) {
  const transaction = db.transaction.bind(db);
  const state = { lost: false };
  db.transaction = <T>(work: TransactionWork<T>) => acknowledge(transaction, work, matches, state);
  return { didLose: () => state.lost, restore: () => { db.transaction = transaction; } };
}
