/** Validated ephemeral RPC input and safe business refusals. Native Models own credential storage. */
import type { EgressDenyReason } from "../egress/egress-decision.ts";
import type { ByokProvider } from "../egress/provider-allowlist.ts";
import type { ByokFamily } from "./byok-family.ts";

/**
 * The taxonomy a rejected credential is answered with. Ported from
 * `byok_models.py::ByokErrorCode` plus the probe route's `egress_blocked`
 * (`interfaces/services/byok_probe.py`), which is a distinct code precisely so
 * "you sent no base_url" and "your base_url is not somewhere we will talk to"
 * are not the same answer.
 */
export type ByokRejectionCode = "invalid_request" | "egress_blocked";

/**
 * A typed, no-fallback BYOK refusal. `message` is safe to surface — it never
 * embeds the submitted key or base URL — and `reason` carries the egress
 * verdict for a LOG, deliberately not for the wire: telling a caller which
 * red line their URL tripped refines an SSRF oracle, and Python collapses
 * every egress refusal to one sentence for that reason.
 */
export class ByokRejection extends Error {
  readonly code: ByokRejectionCode;
  readonly reason: EgressDenyReason | null;

  constructor(code: ByokRejectionCode, message: string, reason: EgressDenyReason | null = null) {
    super(message);
    this.name = "ByokRejection";
    this.code = code;
    this.reason = reason;
  }
}

export interface ByokCredentialParts {
  readonly family: ByokFamily;
  readonly provider: ByokProvider;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly secret: string;
}
