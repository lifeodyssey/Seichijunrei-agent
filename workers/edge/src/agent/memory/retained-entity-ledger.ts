/**
 * The entities rescued before the tool return that carried them was shrunk
 * (card #1290, rewritten by #1378) — port of `apps/agent`'s
 * `domain/compaction_retention.py::RetainedEntityLedger`.
 *
 * A long tool return is replayed as a short deterministic summary
 * (`session/frozen-tool-return.ts`), and a summary is where a user's own words
 * go missing: the anime title they typed and the place name they asked about
 * are literal strings no summary shape promises to keep. This ledger keeps them
 * verbatim, so an ordinal follow-up ("the first one", "第一个") still has
 * something to resolve against after the raw text is gone.
 *
 * EVICTION IS OLDEST-WINS, not FIFO, and that is the whole point of the module:
 * the entities worth rescuing are the DEEPEST ones. The turn that just ran
 * still has its call's arguments in the context verbatim, so an entity dropped
 * from the tail is repeated a few messages away; a first-turn entity evicted
 * here is gone for good. So once the ledger is full a newer distinct entity is
 * DROPPED rather than allowed to push an older one out.
 *
 * DEDUP IS NOT AN OPTIMISATION, it is what makes an ALARM RETRY idempotent.
 * Since #1378 an entity is rescued once, on the write path, as its return's
 * summary is frozen — not once per turn and not once per model request. But a
 * turn can be attempted more than once, and this envelope is promoted only at a
 * terminal path — so an attempt that settled a step and crashed left the row
 * behind and the ledger nowhere, and the retry reads the entities back off
 * those rows (`session/turn-attempt.ts`). A repeat moves to the tail instead of
 * duplicating, so however many attempts a turn takes, the ledger reads as if it
 * took one.
 *
 * A VALUE OBJECT, like `SessionEnvelope` that carries it: every transition
 * answers a new ledger, so "write the whole thing back once, with the run" is
 * expressible at all.
 */
import { encodedBytes, trustedText } from "@animichi/agent";

export const MAX_RETAINED_ENTITIES = 8;
export const MAX_RETAINED_BYTES = 8 * 1024;
export const MAX_ENTITY_VALUE_BYTES = 96;

/** One verbatim string rescued from a tool interaction the freeze shrank. */
export interface RetainedEntity {
  readonly toolName: string;
  readonly value: string;
}

function encodedSize(entities: readonly RetainedEntity[]): number {
  return encodedBytes(JSON.stringify(entities));
}

/** Full on either cap. Both are `>=` because this is asked BEFORE an append. */
function atCapacity(entities: readonly RetainedEntity[]): boolean {
  return entities.length >= MAX_RETAINED_ENTITIES || encodedSize(entities) >= MAX_RETAINED_BYTES;
}

/** Both caps re-applied to a list nothing in this process built: the count trim
 * keeps the OLDEST entries and the byte trim drops from the tail, so a stored
 * ledger from another deployment cannot arrive over the cap or lose its
 * deepest entity to a repair. */
function bounded(entities: readonly RetainedEntity[]): RetainedEntity[] {
  const kept = entities.slice(0, MAX_RETAINED_ENTITIES);
  while (kept.length > 0 && encodedSize(kept) > MAX_RETAINED_BYTES) kept.pop();
  return kept;
}

function isSame(held: RetainedEntity, entity: RetainedEntity): boolean {
  return held.toolName === entity.toolName && held.value === entity.value;
}

export class RetainedEntityLedger {
  /** A session no frozen return has rescued anything from yet. */
  static readonly empty = new RetainedEntityLedger([]);

  /** Oldest first — the order the prompt lines are rendered in. */
  readonly entities: readonly RetainedEntity[];

  constructor(entities: readonly RetainedEntity[]) {
    this.entities = entities;
  }

  /** A ledger read back from storage, with both caps re-applied. */
  static restored(entities: readonly RetainedEntity[]): RetainedEntityLedger {
    return new RetainedEntityLedger(bounded(entities));
  }

  get isEmpty(): boolean {
    return this.entities.length === 0;
  }

  /** The encoded byte length the budget is enforced against. */
  encodedSizeBytes(): number {
    return encodedSize(this.entities);
  }

  /** Rescue one entity. A blank value after sanitization is the "nothing
   * extractable" path and records nothing, not an error. */
  record(toolName: string, value: string): RetainedEntityLedger {
    const clean = trustedText(value, MAX_ENTITY_VALUE_BYTES);
    if (clean === "") return this;
    return this.#appended({ toolName: trustedText(toolName, MAX_ENTITY_VALUE_BYTES), value: clean });
  }

  /** A repeat moves to the tail; a genuinely new entity is dropped once full. */
  #appended(entity: RetainedEntity): RetainedEntityLedger {
    const kept = this.entities.filter((held) => !isSame(held, entity));
    const isNew = kept.length === this.entities.length;
    if (isNew && atCapacity(kept)) return this;
    return new RetainedEntityLedger([...kept, entity]);
  }
}
