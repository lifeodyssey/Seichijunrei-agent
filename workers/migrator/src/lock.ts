import type { ContainerOutcome } from "./migration";

/** Fixed-name Durable Object mutex (not per-run `migrator-job-*`). */
export const APPLY_LOCK_NAME = "migrator-apply-lock";

export interface ApplyLock {
  runExclusive<T>(work: () => Promise<T>): Promise<T>;
}

/** In-process mutex for tests. No wall clock; waiters chain on promises. */
export class QueueLock implements ApplyLock {
  private tail: Promise<unknown> = Promise.resolve();

  runExclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.tail.then(work, work);
    this.tail = run.then(swallow, swallow);
    return run;
  }
}

function swallow(): undefined {
  return undefined;
}

interface ApplyStub {
  run(dsn: string, expectedHead: string | null): Promise<ContainerOutcome>;
}

/**
 * The head the caller asked for crosses the Durable Object boundary as an
 * explicit `null` rather than a trailing `undefined`, so the RPC always carries
 * the same arity and the lock cannot read "no bound" as "apply everything" by
 * accident.
 */
export function productionApply(
  namespace: DurableObjectNamespace,
): (dsn: string, expectedHead?: string) => Promise<ContainerOutcome> {
  const stub = namespace.get(namespace.idFromName(APPLY_LOCK_NAME)) as unknown as ApplyStub;
  return (dsn, expectedHead) => stub.run(dsn, expectedHead ?? null);
}
