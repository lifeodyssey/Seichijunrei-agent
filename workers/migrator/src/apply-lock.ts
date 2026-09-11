import { DurableObject } from "cloudflare:workers";
import { productionChain } from "./bundled-chain";
import { applySelectedChain } from "./selected-apply";
import type { ContainerOutcome } from "./migration";
import type { PreflightMetadata } from "./preflight-metadata";
import { neonClient } from "./sql";
import { migrateSelected, preflightSelected, type SelectedMetadata, type SelectedMigration, type SelectedPreflight } from "./selected-migration";

/**
 * Fixed-name Durable Object mutex for Option 2 HTTP apply. Incoming `run`
 * RPCs are serialized with `blockConcurrencyWhile` (input gate plus an
 * explicit hold). One-shot container instance names cannot serialize applies.
 * The class must `extends DurableObject` or workerd rejects stub.run as
 * non-RPC (staging migrate 2026-08-21, HTTP 500 after #1125).
 */
export class MigratorApplyLock extends DurableObject {
  async run(dsn: string, metadata: PreflightMetadata): Promise<ContainerOutcome> {
    return this.ctx.blockConcurrencyWhile(() => applyWithBundle(dsn, metadata));
  }

  preflight(dsn: string, metadata: SelectedMetadata): Promise<SelectedPreflight> {
    return this.ctx.blockConcurrencyWhile(() => preflightSelected(dsn, metadata));
  }

  migrate(dsn: string, metadata: SelectedMetadata): Promise<SelectedMigration> {
    return this.ctx.blockConcurrencyWhile(() => migrateSelected(dsn, metadata));
  }
}

function applyWithBundle(dsn: string, metadata: PreflightMetadata): Promise<ContainerOutcome> {
  return applySelectedChain({
    dsn,
    source: productionChain,
    connect: neonClient,
    now: () => new Date(),
  }, metadata);
}
