// ---------------------------------------------------------------------------
// Barrel — re-exports everything so `import { … } from "…/lib/mock-data"`
// keeps working without any consumer changes.
// ---------------------------------------------------------------------------

export { ANIME_COVERS } from "./covers";
export { EUPHONIUM_POINTS, NEARBY_POINTS } from "./points";
export { MOCK_ROUTE_RESPONSE } from "./routes";
export {
  MOCK_SEARCH_RESPONSE,
  MOCK_CLARIFY_RESPONSE,
  MOCK_NEARBY_RESPONSE,
  MOCK_GREET_RESPONSE,
} from "./responses";
