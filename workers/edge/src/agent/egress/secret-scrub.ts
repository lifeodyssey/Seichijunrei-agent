// BYOK egress red lines (#1248, W0-S5): keys must not survive into a log line,
// a span attribute or an error body.
//
// The Workers side has no equivalent of the Python request layer's header
// redaction (`SENSITIVE_HEADERS` in
// `apps/agent/src/animichi/interfaces/routes/_middleware.py`), because there is
// no middleware between an SDK error and `console.error`. So the scrub is an
// explicit object a caller runs its text and payloads through *before* they
// reach `console.*` or Logfire.
//
// Two layers, and both are needed. The literal secret catches the exact value
// this request carried — the case that actually matters. The shape patterns
// catch a key this request never saw: a provider echoing a *different*
// credential back in an error body, an `Authorization` header captured into a
// diagnostic, a key pasted into a prompt. Neither layer subsumes the other.

/**
 * An interface rather than `Readonly<Record<…>>`: a mapped type cannot appear
 * inside its own definition (TS2456), and this structure is recursive.
 */
export interface ScrubbableRecord {
  readonly [key: string]: ScrubbableValue;
}

export type ScrubbableValue =
  | string
  | number
  | boolean
  | null
  | readonly ScrubbableValue[]
  | ScrubbableRecord;

export const REDACTED = "[redacted]";

const KEY_SHAPES: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}/g, // OpenAI, and Anthropic's sk-ant-… prefix
  /\bAIza[A-Za-z0-9_-]{10,}/g, // Google API keys
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, // any Authorization value that got copied
];

/**
 * The text of an arbitrary thrown value. One home for it, because three
 * callers want the same sentence and only differ on whether they scrub it:
 * `SecretScrub.errorText` does, the spike's two probes report the runtime's
 * own words verbatim so a platform refusal is recognisable.
 */
export function thrownMessageOf(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return typeof error === "string" ? error : "unknown error";
}

function escapeForRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every non-blank literal is redacted, however short. A length floor here
 * would be an exception to "redact the raw key value" that nothing authorises:
 * a short key is a bad key, not a key that may leak. Blank is the one
 * exclusion, because an empty pattern matches between every character — and
 * `EgressPolicy` already refuses a blank key before a scrub is ever needed.
 */
function literalPatternsOf(secrets: readonly string[]): RegExp[] {
  return secrets
    .map((secret) => secret.trim())
    .filter((secret) => secret.length > 0)
    .map((secret) => new RegExp(escapeForRegex(secret), "g"));
}

function isScrubbableArray(value: ScrubbableValue): value is readonly ScrubbableValue[] {
  return Array.isArray(value);
}

function isRecord(value: ScrubbableValue): value is ScrubbableRecord {
  return typeof value === "object" && value !== null && !isScrubbableArray(value);
}

export class SecretScrub {
  private readonly patterns: readonly RegExp[];
  readonly redactionTailLength: number;

  constructor(secrets: readonly string[] = []) {
    this.patterns = [...literalPatternsOf(secrets), ...KEY_SHAPES];
    this.redactionTailLength = Math.max(256, ...secrets.map((secret) => secret.length));
  }

  text(value: string): string {
    return this.patterns.reduce((carried, pattern) => carried.replace(pattern, REDACTED), value);
  }

  /** Deep-scrubs every string in a structure bound for a log or a span. */
  payload(value: ScrubbableValue): ScrubbableValue {
    if (typeof value === "string") return this.text(value);
    if (isScrubbableArray(value)) return value.map((item) => this.payload(item));
    return isRecord(value) ? this.scrubEntries(value) : value;
  }

  /** The message of an arbitrary thrown value, scrubbed. */
  errorText(error: unknown): string {
    return this.text(thrownMessageOf(error));
  }

  private scrubEntries(value: ScrubbableRecord): ScrubbableValue {
    const scrubbed: Record<string, ScrubbableValue> = {};
    for (const [key, item] of Object.entries(value)) scrubbed[key] = this.payload(item);
    return scrubbed;
  }
}
