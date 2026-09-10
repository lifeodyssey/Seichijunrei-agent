import { AGENT_PATHS } from "@animichi/contract/agent-paths";

// Route classification tables (EDGE-1 #963). Every entry is a path the
// AGENT_PATHS inventory (CONTRACT-1 #938) must contain: the tables are
// references INTO the inventory, not a parallel hand-maintained vocabulary.
// A table entry the inventory no longer carries — a route retired by a later
// capability card — fails module load, so a retired path can never silently
// re-enter an allowlist.
//
// The RATE-limit classification (which route is cost-bearing/mutation and how
// it is metered) lives in ONE place: `rate-policy.ts` `classifyRatePolicy`.
// Those cells drive the guard seam; this module is only the identity-class
// routing tables (public vs anonymous) the request surface needs to decide
// whether it must authenticate before forwarding.

/** Identity-class tables: subsets of the AGENT_PATHS inventory. */
export const PUBLIC_V1_PATHS = [
  "/v1/search/preview",
  "/v1/bangumi/{bangumi_id}/guide",
] as const;

/** Cost-free read surfaces the edge serves without a credential. */
export const ANON_V1_PATHS = [
  "/v1/chat",
  "/v1/photo-search",
  "/v1/photo-search/confirm",
] as const;

/** Require each table entry to exist in the inventory before it can match. */
function inventoryPath(path: string): string {
  if (AGENT_PATHS.some((entry) => entry.path === path)) return path;
  throw new Error(`route table entry "${path}" is not in the AGENT_PATHS inventory`);
}

/** Translate an inventory path template into an anchored matcher: every
 * `{param}` segment matches any non-slash run, mirroring the container's
 * router so the edge classifies exactly the routes the container serves. */
function pathPattern(path: string): RegExp {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parametric = escaped.replace(/\\\{[^}]*\\\}/g, "[^/]+");
  return new RegExp(`^` + parametric + `$`);
}

const PUBLIC_V1 = PUBLIC_V1_PATHS.map(inventoryPath).map(pathPattern);
const ANON_V1 = ANON_V1_PATHS.map(inventoryPath).map(pathPattern);

export function isPublicV1(pathname: string): boolean {
  return PUBLIC_V1.some((pattern) => pattern.test(pathname));
}

export function isAnonymousV1(pathname: string): boolean {
  return ANON_V1.some((pattern) => pattern.test(pathname));
}

/** Native agent routes are always served by this Worker. */
export type EdgeTierRoute =
  | { readonly kind: "turn" }
  | { readonly kind: "probe" }
  | { readonly kind: "transcript" | "stream"; readonly sessionId: string };

/** Classify the native agent surface; other APIs have their own gateway routes. */
export interface TurnRoutePolicy {
  select(method: string, pathname: string): EdgeTierRoute | null;
}

const TURN_PATH = inventoryPath("/v1/chat");
const PROBE_PATH = inventoryPath("/v1/byok/probe");
const TRANSCRIPT_PATH = inventoryPath("/v1/conversations/{session_id}/messages");
const TRANSCRIPT = pathPattern(TRANSCRIPT_PATH);
const CONVERSATION_SESSION = /^\/v1\/conversations\/([^/]+)\/(?:messages|stream)$/;
const STREAM = pathPattern(inventoryPath("/v1/conversations/{session_id}/stream"));

/** The session id the transcript path names, decoded, or none. */
function conversationSessionId(pathname: string): string | null {
  const matched = CONVERSATION_SESSION.exec(pathname);
  if (matched?.[1] === undefined) return null;
  try {
    return decodeURIComponent(matched[1]);
  } catch {
    return null;
  }
}

function edgeTierRoute(method: string, pathname: string): EdgeTierRoute | null {
  if (method === "POST" && pathname === TURN_PATH) return { kind: "turn" };
  if (method === "POST" && pathname === PROBE_PATH) return { kind: "probe" };
  return method === "GET" ? conversationReadRoute(pathname) : null;
}

function conversationReadRoute(pathname: string): EdgeTierRoute | null {
  if (!STREAM.test(pathname) && !TRANSCRIPT.test(pathname)) return null;
  const sessionId = conversationSessionId(pathname);
  return sessionId === null ? null : { kind: STREAM.test(pathname) ? "stream" : "transcript", sessionId };
}

/** The native production route policy has no runtime-switch setting. */
export function turnRoutePolicy(): TurnRoutePolicy {
  return { select: edgeTierRoute };
}
