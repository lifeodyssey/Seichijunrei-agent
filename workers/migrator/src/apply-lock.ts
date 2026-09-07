import { DurableObject } from "cloudflare:workers";
import { productionChain } from "./bundled-chain";
import { applyChain } from "./http-apply";
import type { ContainerOutcome } from "./migration";
import { neonClient } from "./sql";

/**
 * Fixed-name Durable Object mutex for Option 2 HTTP apply. Incoming `run`
 * RPCs are serialized with `blockConcurrencyWhile` (input gate plus an
 * explicit hold). One-shot container instance names cannot serialize applies.
 * The class must `extends DurableObject` or workerd rejects stub.run as
 * non-RPC (staging migrate 2026-08-21, HTTP 500 after #1125).
 */
export class MigratorApplyLock extends DurableObject {
  async run(dsn: string, expectedHead: string | null): Promise<ContainerOutcome> {
    return this.ctx.blockConcurrencyWhile(() => applyWithBundle(dsn, expectedHead));
  }
}

function applyWithBundle(dsn: string, expectedHead: string | null): Promise<ContainerOutcome> {
  return applyChain({
    dsn,
    source: productionChain,
    connect: neonClient,
    now: () => new Date(),
    ...(expectedHead === null ? {} : { expectedHead }),
  });
}
