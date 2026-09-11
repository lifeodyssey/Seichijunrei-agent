/** Validate the request's transient BYOK fields before the native Models store can receive its key.
 * Missing BYOK means server-owned access; malformed/orphaned headers are a refusal. Exact
 * provider origins are enforced by the existing egress policy; redirects are refused by the
 * native provider fetch. Never log these fields, the request, or the credential store. */
import { BYOK_EGRESS_POLICY, type EgressPolicy } from "../egress/egress-policy.ts";
import { ByokRejection, type ByokCredentialParts } from "./byok-credential.ts";
import { BYOK_DIALECTS, byokFamilyOf, type ByokDialect, type ByokFamily } from "./byok-family.ts";

const PROVIDER_HEADER = "x-byok-provider";
const KEY_HEADER = "x-byok-key";
const MODEL_HEADER = "x-byok-model";
const BASE_URL_HEADER = "x-byok-base-url";

/** Every header this module reads, for the callers that must strip them. */
export const BYOK_HEADER_NAMES: readonly string[] = [
  PROVIDER_HEADER,
  KEY_HEADER,
  MODEL_HEADER,
  BASE_URL_HEADER,
];

/**
 * Whether the request carries any BYOK signal at all — presence only, no shape
 * validation. The login gate has to answer this BEFORE parsing, or a malformed
 * header from an anonymous caller would surface as `invalid_request` instead of
 * `byok_requires_login` (Python's P3 ordering).
 */
export function byokSignalIn(headers: Headers): boolean {
  return headers.get(PROVIDER_HEADER) !== null || headers.get(KEY_HEADER) !== null;
}

function trimmedHeader(headers: Headers, name: string): string {
  return headers.get(name)?.trim() ?? "";
}

/** No provider and no key: either a plain request, or an orphaned pair. */
function noSignalOutcome(headers: Headers): null {
  const orphaned = headers.get(MODEL_HEADER) !== null || headers.get(BASE_URL_HEADER) !== null;
  if (!orphaned) return null;
  throw new ByokRejection(
    "invalid_request",
    "X-BYOK-Model/X-BYOK-Base-Url require X-BYOK-Provider and X-BYOK-Key.",
  );
}

function requiredFamily(headers: Headers): ByokFamily {
  const family = byokFamilyOf(trimmedHeader(headers, PROVIDER_HEADER));
  if (family === null) {
    throw new ByokRejection("invalid_request", "Unknown or missing X-BYOK-Provider.");
  }
  return family;
}

/** A blank key is refused here, before any provider client could be built —
 * several SDKs read an ambient credential when handed a falsy one. */
function requiredSecret(headers: Headers): string {
  const secret = trimmedHeader(headers, KEY_HEADER);
  if (secret === "") throw new ByokRejection("invalid_request", "X-BYOK-Key is required.");
  return secret;
}

/** A family with a fixed endpoint may not be pointed anywhere by the caller. */
function fixedBaseUrl(supplied: string, fixed: string): string {
  if (supplied === "") return fixed;
  throw new ByokRejection(
    "invalid_request",
    "X-BYOK-Base-Url is only valid for the openai-compatible family.",
  );
}

function baseUrlOf(headers: Headers, dialect: ByokDialect): string {
  const supplied = trimmedHeader(headers, BASE_URL_HEADER);
  if (dialect.baseUrl !== null) return fixedBaseUrl(supplied, dialect.baseUrl);
  if (supplied !== "") return supplied;
  throw new ByokRejection(
    "invalid_request",
    "X-BYOK-Base-Url is required for the openai-compatible family.",
  );
}

function modelIdOf(headers: Headers, dialect: ByokDialect): string {
  const supplied = trimmedHeader(headers, MODEL_HEADER);
  if (supplied !== "") return supplied;
  if (dialect.defaultModel !== null) return dialect.defaultModel;
  throw new ByokRejection(
    "invalid_request",
    "X-BYOK-Model is required for the openai-compatible family.",
  );
}

/** The one egress verdict this module makes; the guarded fetch re-runs it. */
function allowedBy(policy: EgressPolicy, parts: ByokCredentialParts): ByokCredentialParts {
  const decision = policy.decide({
    provider: parts.provider,
    baseUrl: parts.baseUrl,
    key: parts.secret,
  });
  if (decision.allowed) return parts;
  throw new ByokRejection("egress_blocked", "base_url failed egress validation.", decision.reason);
}

function credentialParts(headers: Headers, family: ByokFamily): ByokCredentialParts {
  const dialect = BYOK_DIALECTS[family];
  return {
    family,
    provider: dialect.provider,
    baseUrl: baseUrlOf(headers, dialect),
    modelId: modelIdOf(headers, dialect),
    secret: requiredSecret(headers),
  };
}

/** The credential this request carries, or `null` when it carries none. */
export function byokCredentialIn(
  headers: Headers,
  policy: EgressPolicy = BYOK_EGRESS_POLICY,
): ByokCredentialParts | null {
  if (!byokSignalIn(headers)) return noSignalOutcome(headers);
  const parts = credentialParts(headers, requiredFamily(headers));
  return allowedBy(policy, parts);
}
