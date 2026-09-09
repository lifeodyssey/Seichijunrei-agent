// BYOK egress red lines (#1248, W0-S5): what a URL host actually *is*.
//
// A semantic port of `_is_address_accepted` in
// `apps/agent/src/animichi/infrastructure/egress_guard.py`, with one deliberate
// difference forced by the runtime: workerd exposes no resolver, so nothing
// here resolves DNS. A hostname is classified as a name, and the exact-host
// provider allowlist — not a resolved address — is what keeps a caller from
// steering egress at a private target. This classification is the second,
// independent condition: it names *why* a literal is refused and it stands on
// its own if a future caller widens the allowlist.
//
// Every host string handed here comes from `new URL(...).hostname`, i.e. the
// WHATWG parser, which normalises before we ever look: `2852039166` and
// `0xA9FEA9FE` arrive as `169.254.169.254`, `API.OpenAI.COM` as lowercase,
// and `[::ffff:169.254.169.254]` as `[::ffff:a9fe:a9fe]` — verified against
// Node 24's parser. The one thing it does NOT normalise is a trailing root
// label: `api.openai.com.` stays, and `api.openai.com。` (ideographic full
// stop) becomes `api.openai.com.` too, so the dot is stripped here.

export type HostAddressClass =
  | "dns-name"
  | "routable-ip"
  | "loopback"
  | "private"
  | "link-local"
  | "cgnat"
  | "metadata"
  | "unroutable";

export interface HostAddress {
  /** The host with its trailing root label removed; IPv6 keeps its brackets. */
  host: string;
  kind: HostAddressClass;
}

type Octets = readonly [number, number, number, number];

/** Cloud metadata reachable by name rather than by address. */
const METADATA_HOSTNAMES: ReadonlySet<string> = new Set([
  "metadata.google.internal",
  "metadata.goog",
  "metadata",
]);

/** Metadata addresses that no range rule below would otherwise name. */
const METADATA_IPV4: ReadonlySet<string> = new Set([
  "169.254.169.254", // AWS / Azure / GCP IMDS
  "100.100.100.200", // Alibaba / Tencent
  "192.0.0.192", // Oracle Cloud Infrastructure
]);

const METADATA_IPV6: ReadonlySet<string> = new Set(["[fd00:ec2::254]"]);

interface Ipv4Range {
  kind: HostAddressClass;
  holds: (octets: Octets) => boolean;
}

// First match wins, so the order is the reading order of the red-line table.
const IPV4_RANGES: readonly Ipv4Range[] = [
  { kind: "loopback", holds: ([a]) => a === 127 },
  { kind: "private", holds: ([a]) => a === 10 },
  { kind: "private", holds: ([a, b]) => a === 172 && b >= 16 && b <= 31 },
  { kind: "private", holds: ([a, b]) => a === 192 && b === 168 },
  { kind: "link-local", holds: ([a, b]) => a === 169 && b === 254 },
  { kind: "cgnat", holds: ([a, b]) => a === 100 && b >= 64 && b <= 127 },
  // 0.0.0.0/8 "this network", 224.0.0.0/4 multicast, 240.0.0.0/4 reserved and
  // 255.255.255.255 broadcast — none is a legitimate provider endpoint.
  { kind: "unroutable", holds: ([a]) => a === 0 || a >= 224 },
  { kind: "unroutable", holds: ([a, b]) => a === 192 && b === 0 }, // protocol assignments + TEST-NET-1
  { kind: "unroutable", holds: ([a, b]) => a === 198 && (b === 18 || b === 19) }, // benchmarking
  { kind: "unroutable", holds: ([a, b, c]) => a === 198 && b === 51 && c === 100 }, // TEST-NET-2
  { kind: "unroutable", holds: ([a, b, c]) => a === 203 && b === 0 && c === 113 }, // TEST-NET-3
];

function isOctet(part: string): boolean {
  return /^\d{1,3}$/.test(part) && Number(part) <= 255;
}

function ipv4OctetsOf(host: string): Octets | null {
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every(isOctet)) return null;
  const [a = 0, b = 0, c = 0, d = 0] = parts.map(Number);
  return [a, b, c, d];
}

function classifyIpv4(octets: Octets): HostAddressClass {
  if (METADATA_IPV4.has(octets.join("."))) return "metadata";
  return IPV4_RANGES.find((range) => range.holds(octets))?.kind ?? "routable-ip";
}

function hexGroupsOf(section: string): number[] | null {
  if (section === "") return [];
  const parts = section.split(":");
  if (parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return parts.map((part) => Number.parseInt(part, 16));
}

/**
 * Eight 16-bit groups, or `null` when the text is not an IPv6 literal.
 * A dotted-quad tail (`::ffff:1.2.3.4`) is deliberately unsupported: the
 * WHATWG parser has already rewritten that form to hex groups by the time a
 * host reaches this module, and accepting a second spelling would be a second
 * thing to keep correct.
 */
function ipv6GroupsOf(text: string): number[] | null {
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = hexGroupsOf(halves[0] ?? "");
  const tail = halves.length === 2 ? hexGroupsOf(halves[1] ?? "") : [];
  if (head === null || tail === null) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const gap = 8 - head.length - tail.length;
  return gap >= 1 ? [...head, ...Array<number>(gap).fill(0), ...tail] : null;
}

/** `::ffff:0:0/96` and `64:ff9b::/96` both carry an IPv4 address in the tail. */
const IPV4_BEARING_PREFIXES: readonly (readonly number[])[] = [
  [0, 0, 0, 0, 0, 0xffff], // IPv4-mapped
  [0x0064, 0xff9b, 0, 0, 0, 0], // NAT64 well-known prefix
];

function startsWith(groups: readonly number[], prefix: readonly number[]): boolean {
  return prefix.every((value, index) => groups[index] === value);
}

function embeddedIpv4Of(groups: readonly number[]): Octets | null {
  if (!IPV4_BEARING_PREFIXES.some((prefix) => startsWith(groups, prefix))) return null;
  const [high = 0, low = 0] = groups.slice(6);
  return [high >>> 8, high & 0xff, low >>> 8, low & 0xff];
}

function classifyIpv6Groups(groups: readonly number[]): HostAddressClass {
  const embedded = embeddedIpv4Of(groups);
  if (embedded !== null) return classifyIpv4(embedded);
  const [first = 0] = groups;
  if (groups.every((group) => group === 0)) return "unroutable";
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return "loopback";
  if (first >>> 8 === 0xff) return "unroutable"; // ff00::/8 multicast
  if (((first >>> 8) & 0xfe) === 0xfc) return "private"; // fc00::/7 unique-local
  return (first & 0xffc0) === 0xfe80 ? "link-local" : "routable-ip"; // fe80::/10
}

function classifyBracketed(host: string): HostAddressClass {
  if (METADATA_IPV6.has(host)) return "metadata";
  const groups = ipv6GroupsOf(host.slice(1, -1));
  return groups === null ? "unroutable" : classifyIpv6Groups(groups);
}

function classify(host: string): HostAddressClass {
  if (host === "") return "unroutable";
  if (host.startsWith("[")) return classifyBracketed(host);
  if (METADATA_HOSTNAMES.has(host)) return "metadata";
  const octets = ipv4OctetsOf(host);
  return octets === null ? "dns-name" : classifyIpv4(octets);
}

export function hostAddressOf(hostname: string): HostAddress {
  const host = hostname.replace(/\.+$/, "");
  return { host, kind: classify(host) };
}
