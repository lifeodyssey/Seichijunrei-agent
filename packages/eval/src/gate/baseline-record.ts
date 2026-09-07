import { pythonFloatText } from './python-number-text.ts';

/**
 * `gate.py`'s schema-v2 baseline record and its text form.
 *
 * The field names stay snake_case: this is the wire shape, shared with a
 * pydantic model, and a camelCase mirror would only add a mapping layer to get
 * wrong. `baselineRecordText` reproduces `model_dump_json(indent=2)` byte for
 * byte — including `1.0` for an integral float — so a baseline written by
 * either language is a no-op diff for the other.
 *
 * Parsing is deliberately total: a malformed file is `null`, never a throw, so
 * that the one caller who reads a committed record — `baseline-store.ts` — is
 * the one place that decides what a malformed file MEANS. It means a failure
 * there, not a written replacement: this runner never writes the record it is
 * judged by.
 */

export interface BaselineRecord {
  readonly schema_version: 2;
  readonly model: string;
  readonly dataset: string;
  readonly tier: string;
  /** The evaluator vocabulary that produced these numbers, or `null` for a
   * record that predates the field (#1303). `baseline-store.ts` decides what a
   * disagreement means; this type only carries the answer. */
  readonly evaluator_version: string | null;
  readonly repeat: number;
  readonly case_count: number;
  readonly evaluated_count: number;
  readonly errored_count: number;
  readonly scores: Readonly<Record<string, number>>;
  readonly cases: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly note: string | null;
}

/** `record.model_dump_json(indent=2)`, field order and float spelling included. */
export function baselineRecordText(record: BaselineRecord): string {
  const fields = [
    `  "schema_version": ${String(record.schema_version)}`,
    `  "model": ${JSON.stringify(record.model)}`,
    `  "dataset": ${JSON.stringify(record.dataset)}`,
    `  "tier": ${JSON.stringify(record.tier)}`,
    `  "evaluator_version": ${JSON.stringify(record.evaluator_version)}`,
    `  "repeat": ${String(record.repeat)}`,
    `  "case_count": ${String(record.case_count)}`,
    `  "evaluated_count": ${String(record.evaluated_count)}`,
    `  "errored_count": ${String(record.errored_count)}`,
    `  "scores": ${metricsText(record.scores, 1)}`,
    `  "cases": ${casesText(record.cases)}`,
    `  "note": ${JSON.stringify(record.note)}`,
  ];
  return `{\n${fields.join(',\n')}\n}`;
}

/** Every metric name any case carries — the record's real vocabulary. */
export function caseMetrics(record: BaselineRecord): string[] {
  const metrics = new Set<string>();
  for (const scores of Object.values(record.cases)) {
    for (const metric of Object.keys(scores)) {
      metrics.add(metric);
    }
  }
  return [...metrics];
}

/** `BaselineRecord.model_validate_json` — `null` where pydantic would raise. */
export function parseBaselineRecord(text: string): BaselineRecord | null {
  const parsed: unknown = tryParse(text);
  if (parsed === null || typeof parsed !== 'object') {
    return null;
  }
  return validated(parsed as Record<string, unknown>);
}

function metricsText(scores: Readonly<Record<string, number>>, depth: number): string {
  const pad = '  '.repeat(depth + 1);
  const entries = Object.entries(scores).map(
    ([metric, score]) => `${pad}${JSON.stringify(metric)}: ${pythonFloatText(score)}`,
  );
  return blockText(entries, depth);
}

function casesText(cases: BaselineRecord['cases']): string {
  const entries = Object.entries(cases).map(
    ([caseId, scores]) => `    ${JSON.stringify(caseId)}: ${metricsText(scores, 2)}`,
  );
  return blockText(entries, 1);
}

function blockText(entries: readonly string[], depth: number): string {
  if (entries.length === 0) {
    return '{}';
  }
  return `{\n${entries.join(',\n')}\n${'  '.repeat(depth)}}`;
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function validated(raw: Record<string, unknown>): BaselineRecord | null {
  const scores = metricMap(raw.scores);
  const cases = caseMap(raw.cases);
  if ((raw.schema_version ?? 2) !== 2 || scores === null || cases === null) {
    return null;
  }
  const identity = identityFields(raw);
  const counts = countFields(raw);
  const texts = optionalTexts(raw);
  if (identity === null || counts === null || texts === null) {
    return null;
  }
  return { schema_version: 2, ...identity, ...texts, ...counts, scores, cases };
}

/** The record's two free-text fields, which Python both defaults to `None`. */
function optionalTexts(
  raw: Record<string, unknown>,
): Pick<BaselineRecord, 'evaluator_version' | 'note'> | null {
  const { evaluator_version: version, note } = raw;
  if (!isOptionalText(version) || !isOptionalText(note)) {
    return null;
  }
  return { evaluator_version: version ?? null, note: note ?? null };
}

function identityFields(
  raw: Record<string, unknown>,
): Pick<BaselineRecord, 'model' | 'dataset' | 'tier'> | null {
  const { model, dataset, tier } = raw;
  if (typeof model !== 'string' || typeof dataset !== 'string' || typeof tier !== 'string') {
    return null;
  }
  return { model, dataset, tier };
}

function countFields(
  raw: Record<string, unknown>,
): Pick<BaselineRecord, 'repeat' | 'case_count' | 'evaluated_count' | 'errored_count'> | null {
  const repeat = integerOr(raw.repeat, 1);
  const caseCount = integerOr(raw.case_count, null);
  const evaluated = integerOr(raw.evaluated_count, null);
  const errored = integerOr(raw.errored_count, 0);
  if (repeat === null || caseCount === null || evaluated === null || errored === null) {
    return null;
  }
  return { repeat, case_count: caseCount, evaluated_count: evaluated, errored_count: errored };
}

function integerOr(value: unknown, fallback: number | null): number | null {
  if (value === undefined) {
    return fallback;
  }
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/** Both optional string fields read the same way: absent, null, or a string. */
function isOptionalText(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string';
}

function metricMap(value: unknown): Record<string, number> | null {
  if (value === null || typeof value !== 'object') {
    return null;
  }
  const entries = Object.entries(value);
  const numeric = entries.every(([, score]) => typeof score === 'number');
  return numeric ? Object.fromEntries(entries) : null;
}

function caseMap(value: unknown): Record<string, Record<string, number>> | null {
  if (value === null || typeof value !== 'object') {
    return null;
  }
  const parsed = Object.entries(value).map(([caseId, scores]) => [caseId, metricMap(scores)]);
  const complete = parsed.every(([, scores]) => scores !== null);
  return complete ? (Object.fromEntries(parsed) as Record<string, Record<string, number>>) : null;
}
