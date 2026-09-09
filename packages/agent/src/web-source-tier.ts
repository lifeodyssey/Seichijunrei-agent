/**
 * Which web sources are reputable, as a label on an untrusted block.
 *
 * Port of `apps/agent/src/animichi/agents/source_tiering.py` (SD-19 P1). The
 * tier is a REPUTATION label and nothing more: a `verified` result is delimited
 * exactly like an unverified one and stays external data. Tiering never
 * upgrades trust — it only tells the model which source to prefer when two
 * results disagree.
 *
 * One deliberate difference from the Python. `urlsplit` reports
 * `evil.example\@wikipedia.org` as the host `wikipedia.org` while a browser
 * navigates to `evil.example`, so `source_tiering._extract_host` had to fail
 * closed on a backslash in the authority. The WHATWG parser this runtime uses
 * has no such split: it resolves that authority to `evil.example` (verified
 * against Node 24), which is the host actually contacted, so the rule would be
 * guarding a confusion that cannot arise here.
 */

/** How much reputation a result's domain carries. Never how much trust. */
export type SourceTier = "verified" | "unverified";

/** The reputable domains, matched at a dot boundary — never as a substring. */
const VERIFIED_SOURCE_DOMAINS: readonly string[] = [
  "wikipedia.org",
  "moegirl.org.cn",
  "bgm.tv",
  "bangumi.tv",
  "anitabi.cn",
];

/** A syntactically valid HTTP source URL, with the WHATWG authority rules. */
function httpSourceUrl(href: string): URL | null {
  try {
    const url = new URL(href.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** The lowercased http(s) host of a link, or null when it has none. */
function hostOf(href: string): string | null {
  const url = httpSourceUrl(href);
  if (url === null) return null;
  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
  return host === "" ? null : host;
}

/** The domain itself or a subdomain of it — the anchor keeps `notbgm.tv` out. */
function isSameOrSubdomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Classify a result's link. Fails closed: anything that is not an http(s) URL
 * with an allowlisted host is `unverified`.
 */
export function classifySource(href: string): SourceTier {
  const host = hostOf(href);
  if (host === null) return "unverified";
  return VERIFIED_SOURCE_DOMAINS.some((domain) => isSameOrSubdomain(host, domain))
    ? "verified"
    : "unverified";
}
