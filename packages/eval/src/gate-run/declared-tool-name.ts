/**
 * A tool name the COMMITTED result file is allowed to carry (E-4 #1383).
 *
 * `turn-transcript.ts` takes `toolName` verbatim off a `tool-input-start` frame,
 * and that frame names whatever the model asked for. So a hallucinated name — or
 * one an `injection_g1_v1` payload talked the model into — is model text, and
 * model text must not reach `results/`, for exactly the reason the query and the
 * reply must not (`attribution-evidence.ts`). An index and a category are facts
 * about a position; a name is a string somebody else chose.
 *
 * THE LIST CANNOT DRIFT FROM THE CONTRACT, and the type system is what stops it
 * rather than a comment. `CatalogToolName | WebToolName` is where the six model
 * tools are declared (`@animichi/contract/agent-tool-parameters`), and
 * `workers/edge/src/agent/tools/tool-schema-bridge.ts` builds the deployed
 * toolbox out of their schema twins — so keying an exhaustive `Record` on that
 * union makes `typecheck` red the day a seventh tool is declared and not listed
 * here, and red again if one is removed.
 *
 * WHY A TYPED MAP AND NOT A RUNTIME `Object.keys`. The next person will try the
 * runtime read; it does not work. `agent-tool-parameters.ts` imports
 * `./contract.js` and `./models.js`, extension specifiers meant for tsc and a
 * bundler, and Node's native type stripping — which is how this package runs its
 * tests and its scripts (`AGENTS.md`: "no bundler") — resolves them literally and
 * throws `ERR_MODULE_NOT_FOUND`. A type-only import is erased, so the compile-time
 * check costs no runtime module at all.
 *
 * TWO NAMES THAT ARE NOT ON IT, ON PURPOSE. `respond` is filtered out of the
 * stream before a frame exists (`session/turn-frames.ts`, the `ANSWER_TOOL_NAME`
 * branches), and `geocode` is a catalog RPC that `search_nearby` makes
 * internally — a Python `StepKind`, never a model tool. Neither can appear in a
 * wire trajectory today; if a deploy ever published one, it would read as
 * `<unknown-tool>` here and by name in the artifact, which is a loud signal
 * rather than a lost one.
 *
 * `expected_tool` is NOT passed through this. It comes from `accepted-chains.ts`'
 * own constant tables — this repo's words, not the model's — and masking it
 * would hide the one half of a `wrong_tool` record that says what should have
 * happened.
 */
import type { CatalogToolName, WebToolName } from '@animichi/contract/agent-tool-parameters';

/** What an undeclared name projects to. Fixed text, so it carries no payload. */
export const UNKNOWN_TOOL_NAME = '<unknown-tool>';

/** Every tool the model may call, exhaustively — the compiler enforces it. */
const DECLARED_TOOL_NAMES: Readonly<Record<CatalogToolName | WebToolName, true>> = {
  resolve_anime: true,
  search_bangumi: true,
  search_nearby: true,
  plan_route: true,
  web_search: true,
  translate_anime_title: true,
};

/** The name as the committed record may state it; `null` stays `null`. */
export function declaredToolName(name: string | null): string | null {
  if (name === null) return null;
  return name in DECLARED_TOOL_NAMES ? name : UNKNOWN_TOOL_NAME;
}
