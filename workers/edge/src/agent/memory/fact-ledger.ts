/**
 * The two facts a session records about itself (card #1290) — port of
 * `apps/agent`'s `domain/fact_ledger.py::FactLedger`.
 *
 * Deliberately TWO fields and no more, because that is what OQ-3(c) ruled and
 * what `SessionEnvelope` does not already carry: a hard constraint the user
 * stated (today: route pacing) and the episode/scene references behind the
 * points they explicitly selected. Both are derived from the turn's own settled
 * steps by `turn-fact-recorder.ts` — there is no model extraction round, so a
 * fact is a thing a tool was actually called with, never a thing a model said.
 *
 * THE TWO FIELDS HAVE DIFFERENT SHAPES ON PURPOSE:
 * - a hard constraint is an APPEND/SUPERSEDE chain, because "the user changed
 *   their mind from chill to packed" is a correction with a history, and the
 *   live value is the last unsuperseded one;
 * - scene references are a turn-scoped REPLACE-SET, because unchecking a point
 *   has to retire it rather than leave it accumulated. That is also what keeps
 *   the field bounded across a long session.
 *
 * BOTH CAPS ARE ENFORCED IN THE WRITE PATH, not merely asserted by a test: an
 * anonymous identity can keep a route-bearing session alive for a long time,
 * and the per-field record cap plus the encoded byte budget are the only things
 * that make its ledger's size independent of its age. `restored` re-applies
 * them to anything read back from storage, since a value written by another
 * deployment never went through these methods at all.
 *
 * A VALUE OBJECT, like the envelope that carries it: every write answers a new
 * ledger rather than mutating the one the turn opened with.
 */
import { encodedBytes, trustedText } from "@animichi/agent";

export const MAX_RECORDS_PER_FIELD = 8;
export const MAX_LEDGER_BYTES = 8 * 1024;
export const MAX_FACT_VALUE_BYTES = 96;
export const MAX_FACT_ID_BYTES = 96;

/** Every pacing `plan_route` accepts, which is every pacing worth recording. */
export const PACINGS = ["chill", "normal", "packed"] as const;
export type Pacing = (typeof PACINGS)[number];

/** What both record kinds share: identity, value, and the supersede link. */
export interface FactRecord {
  readonly id: string;
  readonly value: string;
  readonly recordedAt: string;
  readonly supersededBy: string | null;
}

/** One recorded user hard constraint. */
export interface HardConstraintRecord extends FactRecord {
  readonly kind: "pacing";
  readonly value: Pacing;
}

/** One episode/scene reference tied to a point the user selected. */
export interface SceneReferenceRecord extends FactRecord {
  readonly kind: "episode_scene";
  readonly pointId: string;
}

/** One scene reference as the recorder proposes it, before it becomes a record. */
export interface SceneEntry {
  readonly pointId: string;
  readonly value: string;
}

/**
 * A whole-set replace has no single successor for each record it retires — N
 * old points can be replaced by M new ones with no correspondence between any
 * pair — so retired scene references carry this permanent tombstone instead of
 * a record id. It is never rewritten; the id-linked chain is what
 * `appendHardConstraint` still provides.
 */
export const TURN_SUPERSEDED = "__turn_superseded__";

function newFactId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

function lastActive<Held extends FactRecord>(records: readonly Held[]): Held | null {
  const live = records.filter((record) => record.supersededBy === null);
  return live[live.length - 1] ?? null;
}

/** Drop the oldest superseded record, or say there is none left to drop. */
function dropFirstSuperseded(kept: FactRecord[]): boolean {
  const index = kept.findIndex((record) => record.supersededBy !== null);
  if (index === -1) return false;
  kept.splice(index, 1);
  return true;
}

/**
 * The per-field count cap: superseded records go first, and the unconditional
 * trailing trim is the backstop that makes unbounded growth impossible even if
 * a later change breaks the superseded-first invariant.
 */
function evictByCount<Held extends FactRecord>(records: readonly Held[]): readonly Held[] {
  const kept = [...records];
  while (kept.length > MAX_RECORDS_PER_FIELD) {
    if (!dropFirstSuperseded(kept)) break;
  }
  return kept.length > MAX_RECORDS_PER_FIELD ? kept.slice(-MAX_RECORDS_PER_FIELD) : kept;
}

/** The oldest superseded record of a field, or its oldest record outright. */
function withoutOldest<Held extends FactRecord>(records: readonly Held[]): readonly Held[] | null {
  if (records.length === 0) return null;
  const index = records.findIndex((record) => record.supersededBy !== null);
  const dropped = [...records];
  dropped.splice(index === -1 ? 0 : index, 1);
  return dropped;
}

export class FactLedger {
  /** A session no turn has recorded a fact for yet. */
  static readonly empty = new FactLedger([], []);

  readonly hardConstraints: readonly HardConstraintRecord[];
  readonly sceneReferences: readonly SceneReferenceRecord[];

  constructor(
    hardConstraints: readonly HardConstraintRecord[],
    sceneReferences: readonly SceneReferenceRecord[],
  ) {
    this.hardConstraints = hardConstraints;
    this.sceneReferences = sceneReferences;
  }

  /** A ledger read back from storage, with both caps re-applied. */
  static restored(
    hardConstraints: readonly HardConstraintRecord[],
    sceneReferences: readonly SceneReferenceRecord[],
  ): FactLedger {
    return bounded(hardConstraints, sceneReferences);
  }

  get isEmpty(): boolean {
    return this.hardConstraints.length === 0 && this.sceneReferences.length === 0;
  }

  /** The live hard constraint — the last one nothing superseded. */
  activeHardConstraint(): HardConstraintRecord | null {
    return lastActive(this.hardConstraints);
  }

  /** The live scene references, oldest first. */
  activeSceneReferences(): readonly SceneReferenceRecord[] {
    return this.sceneReferences.filter((record) => record.supersededBy === null);
  }

  /** The encoded byte length the budget is enforced against. */
  encodedSizeBytes(): number {
    return encodedBytes(JSON.stringify([this.hardConstraints, this.sceneReferences]));
  }

  /** Correct the hard constraint. Restating the live value is a no-op. */
  appendHardConstraint(value: Pacing, now: Date): FactLedger {
    const current = this.activeHardConstraint();
    if (current?.value === value) return this;
    const record = pacingRecord(value, now);
    const chained = this.hardConstraints.map((held) => supersededBy(held, current, record.id));
    return bounded([...chained, record], this.sceneReferences);
  }

  /** Retire the whole live set and record this turn's selection in its place.
   * An unchanged selection is a no-op, so a repeated turn adds no churn. */
  replaceSceneReferences(entries: readonly SceneEntry[], now: Date): FactLedger {
    const capped = entries.slice(0, MAX_RECORDS_PER_FIELD).map(cappedEntry);
    if (isSameSelection(this.activeSceneReferences(), capped)) return this;
    const retired = this.sceneReferences.map(turnSuperseded);
    const added = capped.map((entry) => sceneRecord(entry, now));
    return bounded(this.hardConstraints, [...retired, ...added]);
  }
}

/** Both caps, in Python's order: per-field count first, then total bytes. */
function bounded(
  hardConstraints: readonly HardConstraintRecord[],
  sceneReferences: readonly SceneReferenceRecord[],
): FactLedger {
  return withinBudget(new FactLedger(evictByCount(hardConstraints), evictByCount(sceneReferences)));
}

/** Drop oldest records — hard constraints first — until the ledger fits. */
function withinBudget(ledger: FactLedger): FactLedger {
  let current = ledger;
  while (current.encodedSizeBytes() > MAX_LEDGER_BYTES) {
    const smaller = withoutOldestRecord(current);
    if (smaller === null) return current;
    current = smaller;
  }
  return current;
}

function withoutOldestRecord(ledger: FactLedger): FactLedger | null {
  const constraints = withoutOldest(ledger.hardConstraints);
  if (constraints !== null) return new FactLedger(constraints, ledger.sceneReferences);
  const scenes = withoutOldest(ledger.sceneReferences);
  return scenes === null ? null : new FactLedger(ledger.hardConstraints, scenes);
}

function pacingRecord(value: Pacing, now: Date): HardConstraintRecord {
  return { id: newFactId(), kind: "pacing", value, recordedAt: now.toISOString(), supersededBy: null };
}

function sceneRecord(entry: SceneEntry, now: Date): SceneReferenceRecord {
  return {
    id: newFactId(),
    kind: "episode_scene",
    pointId: entry.pointId,
    value: entry.value,
    recordedAt: now.toISOString(),
    supersededBy: null,
  };
}

function cappedEntry(entry: SceneEntry): SceneEntry {
  return {
    pointId: trustedText(entry.pointId, MAX_FACT_ID_BYTES),
    value: trustedText(entry.value, MAX_FACT_VALUE_BYTES),
  };
}

function supersededBy(
  held: HardConstraintRecord, current: HardConstraintRecord | null, id: string,
): HardConstraintRecord {
  return held === current ? { ...held, supersededBy: id } : held;
}

/** Only the LIVE records are stamped; an already-retired one keeps its own. */
function turnSuperseded(record: SceneReferenceRecord): SceneReferenceRecord {
  return record.supersededBy === null ? { ...record, supersededBy: TURN_SUPERSEDED } : record;
}

function isSameSelection(
  live: readonly SceneReferenceRecord[], proposed: readonly SceneEntry[],
): boolean {
  if (live.length !== proposed.length) return false;
  return live.every((record, index) => isSameEntry(record, proposed[index]));
}

function isSameEntry(record: SceneReferenceRecord, entry: SceneEntry | undefined): boolean {
  return record.pointId === entry?.pointId && record.value === entry.value;
}
