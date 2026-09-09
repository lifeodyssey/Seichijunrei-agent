// BYOK egress red lines (#1248, W0-S5): the whole allow/deny decision, pure.
//
// No I/O, no clock, no bindings — hand it a provider id, a base URL and a key
// and it answers. That is what makes every red line assertable under
// `node --test` without a network, and what lets the guarded fetch re-run the
// exact same decision on a redirect target (`guarded-fetch.ts`).
//
// Two independent conditions must both hold, mirroring the dual-condition test
// in `apps/agent/src/animichi/infrastructure/egress_guard.py`:
//   1. the host is one of the provider family's enumerated hosts, and
//   2. the host is a name, not an address in a loopback / private / link-local
//      / CGNAT / metadata / otherwise-unroutable range.
// Neither is redundant. (1) alone would still be a policy about names only;
// (2) alone would let any globally routable third party receive the caller's
// key. Every red-line test below asserts one of them by its reason.
//
// The key is checked FIRST and before anything is constructed: an empty key
// must never reach a provider SDK, because several of them silently fall back
// to an ambient server-side credential when handed a falsy key (the same
// `GoogleProvider` trap `byok_models.py` guards). Refusing here means there is
// no code path on which a server key could be substituted for a missing
// caller key.

import {
  allowEgress,
  refuseEgress,
  type EgressDecision,
  type EgressDenyReason,
  type EgressRefused,
} from "./egress-decision.ts";
import { hostAddressOf, type HostAddressClass } from "@animichi/agent";
import {
  BYOK_PROVIDER_ALLOWLIST,
  ProviderAllowlist,
  type ByokProvider,
} from "./provider-allowlist.ts";

export interface EgressRequest {
  /** Unvalidated: an unknown id is refused, never defaulted to a family. */
  provider: unknown;
  baseUrl: string;
  key: string;
}

const CLASS_REASONS: Readonly<Record<HostAddressClass, EgressDenyReason | null>> = {
  "dns-name": null,
  "routable-ip": "ip_literal_host",
  loopback: "loopback_address",
  private: "private_address",
  "link-local": "link_local_address",
  cgnat: "cgnat_address",
  metadata: "metadata_address",
  unroutable: "unroutable_address",
};

function urlOf(baseUrl: string): URL | null {
  try {
    return new URL(baseUrl);
  } catch {
    return null;
  }
}

/** Scheme, userinfo and port — everything decidable from the URL's shape. */
function shapeRefusalOf(url: URL): EgressRefused | null {
  if (url.protocol !== "https:") return refuseEgress("scheme_not_https");
  if (url.username !== "" || url.password !== "") return refuseEgress("userinfo_present");
  // The WHATWG parser drops the default port, so `""` *is* 443.
  if (url.port !== "" && url.port !== "443") return refuseEgress("port_not_443");
  return null;
}

export class EgressPolicy {
  private readonly allowlist: ProviderAllowlist;

  constructor(allowlist: ProviderAllowlist = BYOK_PROVIDER_ALLOWLIST) {
    this.allowlist = allowlist;
  }

  decide(request: EgressRequest): EgressDecision {
    if (request.key.trim() === "") return refuseEgress("empty_key");
    const provider = this.allowlist.providerOf(request.provider);
    if (provider === null) return refuseEgress("unknown_provider");
    const url = urlOf(request.baseUrl);
    if (url === null) return refuseEgress("invalid_url");
    return shapeRefusalOf(url) ?? this.hostDecisionOf(provider, url);
  }

  private hostDecisionOf(provider: ByokProvider, url: URL): EgressDecision {
    const address = hostAddressOf(url.hostname);
    const classReason = CLASS_REASONS[address.kind];
    if (classReason !== null) return refuseEgress(classReason);
    if (this.allowlist.isOwnInfrastructure(address.host)) return refuseEgress("own_infrastructure");
    if (!this.allowlist.allows(provider, address.host)) return refuseEgress("host_not_allowlisted");
    return allowEgress(provider, url.toString(), address.host);
  }
}

export const BYOK_EGRESS_POLICY = new EgressPolicy();
