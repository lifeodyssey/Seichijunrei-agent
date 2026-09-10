/**
 * Complete Agent HTTP path inventory (CONTRACT-1 #938; extracted #1285).
 *
 * The inventory mirrors `fastapi_service.py`'s router registrations, and it is
 * read at RUNTIME by the edge gateway's routing and rate tables
 * (`workers/edge/src/gateway/routing-policy.ts`, `rate-policy.ts`), which
 * derive their allowlists from it rather than hand-maintaining a second
 * vocabulary.
 *
 * It lives here, apart from `agent-contract.ts`, precisely because of that
 * runtime read: this table is plain data with no schema in it, while its old
 * home imports zod, and a value import from a zod module pulls the whole of
 * zod into the Worker bundle for fourteen strings (`workers/edge/bundle-smoke/
 * entry-bundle.test.ts` is the gate). Nothing is generated and nothing is
 * mirrored: this is the ONE declaration, and the OpenAPI emitter, the Python
 * model emitter, the edge and the contract's own drift tests
 * (`test/composition.test.ts` against the committed `agent-openapi.json`) all
 * read it here — `agent-contract.ts` does not re-export it, because a runtime
 * re-export out of the zod module would put zod back in the bundle.
 * **Keep this module import-free** (a type-only import is fine;
 * `test/import-free-modules.test.ts` enforces it).
 *
 * `summary` is the inventory entry only — it is not emitted into generated
 * models (spec rule 7: future paths appear in the inventory, not as unused
 * models).
 */

/** One published Agent path in the complete inventory. */
export interface AgentPath {
  method: "GET" | "POST" | "PATCH";
  path: string;
  summary: string;
  /** Edge-owned additions are not mounted or generated as Python runtime routes. */
  runtime?: "edge";
}

export const AGENT_PATHS: AgentPath[] = [
  { method: "GET", path: "/", summary: "service banner" },
  { method: "GET", path: "/healthz", summary: "health and service metadata" },
  { method: "POST", path: "/v1/chat", summary: "chat turn" },
  { method: "POST", path: "/v1/byok/probe", summary: "probe a bring-your-own-key credential" },
  { method: "POST", path: "/v1/feedback", summary: "submit feedback" },
  { method: "GET", path: "/v1/conversations", summary: "list conversations" },
  { method: "PATCH", path: "/v1/conversations/{session_id}", summary: "rename conversation" },
  { method: "GET", path: "/v1/conversations/{session_id}/messages", summary: "conversation messages" },
  { method: "GET", path: "/v1/conversations/{session_id}/stream", summary: "resume the native conversation stream", runtime: "edge" },
  { method: "GET", path: "/v1/bangumi/{bangumi_id}/guide", summary: "work guide points" },
  { method: "GET", path: "/v1/bangumi/nearby", summary: "nearby points" },
  { method: "GET", path: "/v1/search/preview", summary: "search preview" },
  { method: "POST", path: "/v1/photo-search", summary: "photo search" },
  { method: "POST", path: "/v1/photo-search/confirm", summary: "confirm photo offer" },
  { method: "POST", path: "/v1/sessions/adopt", summary: "adopt anonymous sessions" },
];
