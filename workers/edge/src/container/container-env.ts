/**
 * The env-var forwarding allowlist between the worker and the container.
 *
 * Split out of `entry.ts` (issue #282 review) so this pure function can be
 * unit-tested under plain `node --test`: `entry.ts` imports `Container` from
 * `@cloudflare/containers`, whose ESM build uses an extensionless relative
 * import that only resolves under workerd's module loader, not Node's. A test
 * that imported `buildContainerEnvVars` straight from `entry.ts` would pull
 * that broken import chain in and fail with `ERR_MODULE_NOT_FOUND` outside
 * `wrangler dev`/deploy — this module has no such dependency.
 */

export const CONTAINER_ENV_KEYS = [
  "DEEPSEEK_API_KEY", "MIMO_API_KEY", "ZEN_GO_API_KEY", "CATALOG_API_URL",
  // #912 follow-up: the DSN is a Secrets Store binding in both deployed
  // environments (staging #912, production W4-1 #1314). `buildContainerEnvVars`
  // only copies strings; `resolveContainerEnvVars` unwraps `.get()` first (#1157).
  // Not in CONTAINER_REQUIRED_KEYS: local `wrangler dev` binds no store secret,
  // so the container must still start without one.
  // validate_required_env requires this sole runtime DSN; retired database
  // credentials are neither fetched nor forwarded.
  "AGENT_SVC_DATABASE_URL",
  // APP_ENV also joined CONTAINER_REQUIRED_KEYS below (issue #498): it is kept
  // listed here too so the standard forwarding allowlist stays a complete
  // picture of what reaches the container, but CONTAINER_REQUIRED_KEYS is what
  // makes it fail-closed — this loop alone would silently omit it if unset.
  "APP_ENV", "CACHE_TTL_SECONDS", "CORS_ALLOWED_ORIGIN", "DEBUG",
  "DEFAULT_AGENT_MODEL", "FALLBACK_AGENT_MODEL", "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_CLOUD_PROJECT", "LOG_LEVEL", "MAX_RETRIES", "OBSERVABILITY_SERVICE_NAME",
  "OBSERVABILITY_SERVICE_VERSION", "OPENAI_COMPAT_BASE_URL", "RATE_LIMIT_CALLS",
  "RATE_LIMIT_PERIOD_SECONDS", "TIMEOUT_SECONDS", "USE_CACHE",
  "GOOGLE_MAPS_API_KEY", "LOGFIRE_TOKEN", "OPENAI_COMPAT_API_KEY",
  // Anonymous daily-budget circuit breaker (X4): the container ingress owns the
  // authoritative decision because it is the only tier that reads daily_usage.
  "ANON_DAILY_COST_BUDGET_USD", "MODEL_INPUT_COST_PER_MTOK_USD", "MODEL_OUTPUT_COST_PER_MTOK_USD",
  // Per-identity anonymous daily message quota (issue #282, S1.10): same
  // container-ingress-authoritative reasoning as the budget breaker above.
  "ANON_DAILY_MESSAGE_QUOTA", "PHOTO_SEARCH_QUOTA_ANON", "PHOTO_SEARCH_QUOTA_MEMBER",
];

// APP_ENV joined this list in issue #498: it used to be seeded with a
// hardcoded "production" default in buildContainerEnvVars below, which meant
// every container reported APP_ENV=production regardless of which Cloudflare
// environment actually deployed it — staging traces were indistinguishable
// from production traces in Logfire, and any future `is_production` gate
// would silently take the production branch on staging. Fail-closed (throw if
// missing) rather than a "safer" non-production seed value, because a missing
// wrangler.toml `[vars]`/`[env.*.vars]` entry is a deploy-config bug that
// should break the deploy loudly, not fall back to a silently-wrong value —
// this repo was already reviewed back for the opposite ("can't parse it, so
// treat it as false") fail-open pattern once (#441/#443).
export const CONTAINER_REQUIRED_KEYS = ["DEEPSEEK_API_KEY", "MIMO_API_KEY", "APP_ENV"];

// Container-level egress URL-hostname denylist (#284 Task 7). Split out for the
// same reason as the env-var allowlist above: a plain `node --test` importer
// must not pull in `entry.ts`'s `@cloudflare/containers` import chain.
//
// CORRECTION (PR #478 review, second round): `RuntimeContainer.deniedHosts` is
// typed `string[]` but is **not** CIDR-aware. The vendored
// `@cloudflare/containers@0.3.7` implementation
// (`node_modules/@cloudflare/containers/dist/lib/container.js`,
// `simpleGlobMatch`/`matchesHostList`) is a plain string-prefix/suffix glob
// matcher on the **request URL's hostname string** (`*` = any sequence of
// characters) — it does not parse `/`-suffixed CIDR notation at all, and it
// never resolves DNS, so it cannot match against a hostname's *resolved* IP
// either. An earlier revision of this file shipped literal CIDR strings like
// `"10.0.0.0/8"`, which never matched anything (`matchesHostList` would only
// match a hostname that is the literal string `"10.0.0.0/8"`) — a complete
// no-op, caught only because a reviewer read the vendored matcher source
// directly rather than trusting the type (`string[]`) or the docs prose.
//
// What is shipped instead: dotted-decimal glob prefixes that are the correct
// equivalent of the target ranges *when the request URL already contains a
// bare IPv4 literal* (e.g. `http://169.254.169.254/` — the common shape for
// cloud-metadata SSRF, and the literal shape of the spec's Task 7 AC). This is
// a **URL-hostname-layer denylist, not a network/CIDR policy**:
//   - it does NOT catch DNS rebinding (a hostname that *resolves* to a denied
//     IP but isn't itself a denied literal/glob) — that remains the
//     application-layer guard's job (`egress_guard`/`GuardedAsyncTransport`,
//     Task 1);
//   - it DOES catch the literal well-known metadata hostname
//     `metadata.google.internal` and the two well-known non-IMDS metadata IPs
//     below, in addition to the three glob-representable ranges.
//   - decimal/octal/hex-encoded IPv4 (`http://2852039166/`, `0xA9FEA9FE`, etc.)
//     and uppercase hostnames do NOT need separate entries: `ContainerProxy.fetch`
//     runs `new URL(request.url)` before matching, and the WHATWG URL host
//     parser normalizes all of those to the canonical dotted-decimal / lowercase
//     form first — verified directly (`new URL("http://2852039166/").hostname
//     === "169.254.169.254"`). Do not add redundant encoded-form entries here.
//   - a prefix glob like `"10.*"` also matches a hostname such as
//     `10.0.0.1.evil.com` (it is a string prefix match, not an IP anchor) — this
//     over-match is deliberate and fail-closed (it can only cause an unlikely
//     legitimate hostname starting with one of these prefixes to be blocked,
//     never the reverse).
// See `docs/ops/cloudflare-hardening.md` §6 for the full corrected spike
// writeup, limit 4 (IPv6 is NOT comprehensively covered), and the AC
// disposition against this reality.
const RFC1918_172_BLOCK = Array.from({ length: 16 }, (_, i) => `172.${String(16 + i)}.*`); // 172.16.0.0/12
const CGNAT_100_BLOCK = Array.from({ length: 64 }, (_, i) => `100.${String(64 + i)}.*`); // 100.64.0.0/10

// IPv6 literals (PR #478 review, third round): `new URL(...).hostname` renders
// IPv6 in bracketed, colon-compressed form (`[::1]`, `[fd00:ec2::254]`,
// `[::ffff:a9fe:a9fe]` for the IPv4-mapped form of `169.254.169.254`) — no
// dotted-quad glob above can match any of these. IPv6 has too many equivalent
// textual representations (zero-compression, leading-zero suppression, mixed
// case) for a hand-built glob list to be exhaustive the way the IPv4 ranges
// above are, so this is best-effort spot coverage for the concretely-named
// cases only, NOT general IPv6 RFC1918/ULA/link-local coverage — see limit 4
// in `docs/ops/cloudflare-hardening.md` §6. Each exact entry below was
// verified against Node's `new URL()` (the same WHATWG parser
// `ContainerProxy.fetch` uses) to confirm the precise rendered form; the two
// glob prefixes (`[fe80:` link-local, `[fd00:` ULA convention) are plain
// string prefixes with no numeric-range math, so they carry none of the
// off-by-one risk that the IPv4 CIDR-string mistake did.
const IPV6_METADATA_AND_LOCAL = [
  "[::1]", // loopback
  "[fd00:ec2::254]", // AWS IMDSv2 ULA (matches egress_guard.py's _METADATA_DENY_IPS entry)
  "[::ffff:a9fe:a9fe]", // IPv4-mapped 169.254.169.254 (AWS/Azure/GCP IMDS)
  "[::ffff:6464:64c8]", // IPv4-mapped 100.100.100.200 (Alibaba/Tencent metadata)
  "[::ffff:c000:c0]", // IPv4-mapped 192.0.0.192 (Oracle Cloud metadata)
  "[fe80:*", // IPv6 link-local (fe80::/10 convention prefix) — glob prefix, not numeric-range math
  "[fd00:*", // IPv6 ULA (fd00::/8 convention prefix) — glob prefix, not numeric-range math
];

export const DENIED_EGRESS_HOSTS = [
  "10.*", // RFC1918 10.0.0.0/8 — glob-exact equivalent
  ...RFC1918_172_BLOCK, // RFC1918 172.16.0.0/12
  "192.168.*", // RFC1918 192.168.0.0/16 — glob-exact equivalent
  "169.254.*", // link-local 169.254.0.0/16 — glob-exact equivalent; covers AWS/Azure/GCP IMDS IP literal
  ...CGNAT_100_BLOCK, // CGNAT 100.64.0.0/10
  "100.100.100.200", // Alibaba/Tencent metadata (exact; already covered by the CGNAT block above, kept explicit)
  "192.0.0.192", // Oracle Cloud Infrastructure metadata
  "metadata.google.internal", // GCP metadata hostname literal (not an IP; glob ranges above cannot match this)
  ...IPV6_METADATA_AND_LOCAL,
];

function requiredEnvVars(env: Record<string, unknown>, envVars: Record<string, string>): void {
  for (const key of CONTAINER_REQUIRED_KEYS) {
    const value = env[key];
    if (typeof value !== "string" || value.length === 0) throw new Error(`Missing required container env: ${key}`);
    envVars[key] = value;
  }
}

function optionalEnvVars(env: Record<string, unknown>, envVars: Record<string, string>): void {
  for (const key of CONTAINER_ENV_KEYS) {
    const value = env[key];
    if (typeof value === "string" && value.length > 0) envVars[key] = value;
  }
}

export function buildContainerEnvVars(env: Record<string, unknown>): Record<string, string> {
  const envVars: Record<string, string> = { SERVICE_HOST: "0.0.0.0", SERVICE_PORT: "8080" };
  requiredEnvVars(env, envVars);
  optionalEnvVars(env, envVars);
  return envVars;
}

function isStoreSecret(value: unknown): value is SecretsStoreSecret {
  if (typeof value !== "object" || value === null) return false;
  return "get" in value && typeof value.get === "function";
}

/** Native Secrets Store binding, or a plain string from local .dev.vars. */
export async function readStoreOrString(value: unknown): Promise<string | undefined> {
  if (typeof value === "string") return value.length > 0 ? value : undefined;
  if (!isStoreSecret(value)) return undefined;
  const text = await value.get();
  return typeof text === "string" && text.length > 0 ? text : undefined;
}

/** Resolve only the container allowlist before validating required values. */
export async function resolveContainerEnvVars(
  env: Record<string, unknown>,
): Promise<Record<string, string>> {
  const entries = await Promise.all(CONTAINER_ENV_KEYS.map(async (key) =>
    [key, await readStoreOrString(env[key])] as const));
  return buildContainerEnvVars(Object.fromEntries(entries));
}
