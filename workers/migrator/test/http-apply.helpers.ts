import { mapSource, type ChainSource } from "../src/chain";
import { QueueLock } from "../src/lock";
import type { ContainerOutcome } from "../src/migration";
import { applyHttp, type HttpApplyInput } from "../src/http-apply";
import type { FakeSql } from "./fake-sql";

// #1124 — fixture chain for the Option 2 apply tests. Tests inject this
// ChainSource; they never load the wrangler SQL glob. The fake neon-http client
// it runs against lives in `./fake-sql`.

export const DSN = "postgresql://migrator:x@ep-direct.neon.tech/neondb";
export const POOLER_DSN = "postgresql://migrator:x@ep-broad-frost-pooler.neon.tech/neondb";
export const FIXED_NOW = new Date("2026-08-21T00:00:00.000Z");

export const FILE_A = "20260811000001_turn_outcome.sql";
export const FILE_B = "20260814191301_turn_idempotency_outbox.sql";
export const HASH_A = "h1:hash-turn-outcome-aaaaaaaaaaaaaaaaaaaaaaa=";
export const HASH_B = "h1:hash-turn-outbox-bbbbbbbbbbbbbbbbbbbbbbbb=";
export const BODY_A = "CREATE TABLE public.turn_outcome (id int);";
export const BODY_B = "CREATE TABLE public.turn_outbox_events (id int);";
export const HEAD_A = "20260811000001_turn_outcome";
export const HEAD_B = "20260814191301_turn_idempotency_outbox";
export const STMT_1 = "CREATE TABLE public.t1 (id int);";
export const STMT_2 = "CREATE TABLE public.t2 (id int);";
export const TWO_BODY = `${STMT_1} ${STMT_2}`;
export const TWO_FILE = "20260821000000_two_stmt.sql";
export const CONCURRENT_BODY = "CREATE INDEX CONCURRENTLY idx_t ON public.t (id);";
export const CONCURRENT_FILE = "20260821000001_concurrent.sql";
export const CONCURRENT_VERSION = "20260821000001";
export const CHAIN_HASH = "h1:hash-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx=";

const BODIES: Record<string, string> = { [FILE_A]: BODY_A, [FILE_B]: BODY_B };
const FIXTURE_SUM = ["h1:fixture-directory-sum", `${FILE_A} ${HASH_A}`, `${FILE_B} ${HASH_B}`, ""].join("\n");

export const fixtureChain: ChainSource = {
  atlasSum: (): string => FIXTURE_SUM,
  file: (name: string): string => bodyOf(BODIES, name),
};

export const twoStmtChain: ChainSource = chainOf(TWO_FILE, TWO_BODY);
export const concurrentChain: ChainSource = chainOf(CONCURRENT_FILE, CONCURRENT_BODY);

function bodyOf(files: Record<string, string>, name: string): string {
  const body = files[name];
  if (body === undefined) throw new Error("missing fixture file");
  return body;
}

export function chainOf(filename: string, body: string): ChainSource {
  return mapSource(`h1:sum\n${filename} ${CHAIN_HASH}\n`, { [filename]: body });
}

export function applyFixture(db: FakeSql, extra: Partial<HttpApplyInput> = {}): Promise<ContainerOutcome> {
  return applyHttp({
    dsn: DSN,
    source: fixtureChain,
    connect: db.connect,
    lock: extra.lock ?? new QueueLock(),
    now: (): Date => FIXED_NOW,
    ...extra,
  });
}

// The Worker's own seam: the head the caller asked for reaches the apply, which
// is what bounds it (src/requested-chain.ts). Dropping `expectedHead` here would
// leave the apply unbounded exactly as it was before #1471.
export function workerHttpDeps(db: FakeSql) {
  return {
    runContainer: (dsn: string, expectedHead?: string) => applyFixture(db, { dsn, expectedHead }),
    readAppliedHead: (): Promise<string | null> => Promise.resolve(db.head()),
  };
}
