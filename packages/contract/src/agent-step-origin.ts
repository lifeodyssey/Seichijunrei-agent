/**
 * Who asked for a step — the model, or the runtime itself (#1462).
 *
 * A turn's SD-9 stream publishes one tool part per step, and until this module
 * it published the same shape for two different facts. A model tool call is the
 * model's own request, opened with the arguments it produced. A deterministic
 * bypass — `plan_selected`, `plan_multi`, the radius `search_nearby` a place
 * pick runs (`workers/edge/src/agent/selection/turn-selection.ts`) — is the
 * RUNTIME's step: it skips the model loop entirely, so it is opened with `{}`
 * because there are no model arguments to open it with.
 *
 * WHY THE WIRE HAS TO SAY IT. `argument_correctness` scores a call's two
 * witnesses against each other — the arguments the stream carried and the params
 * the tool executed with (#1381). On a bypass those two can never agree: `{}`
 * against `{"candidate_ids": […]}`, forever. Python never had that problem
 * because its records carry `StepRecord.model_initiated` and its evaluator
 * filters on it (`apps/agent/src/animichi/tests/eval/official_evaluators.py:77-81`);
 * the frames carried no equivalent, so the metric read 0.0 on every successful
 * bypass turn for a reason that says nothing about the agent (#1462, found while
 * settling #1454).
 *
 * WHY `toolMetadata` AND NOT A TOP-LEVEL MEMBER. SD-9 declares `toolMetadata`
 * on exactly the two chunk types a step opens with — a free-form
 * `Record<string, JsonValue>` (`ai@7.0.77`, `dist/index.js:6554-6590`) — which
 * is the protocol's own extension slot. A top-level member would also survive
 * today, because those chunks are `z.looseObject`, but it would survive by
 * accident rather than by contract.
 *
 * ABSENT MEANS `model`, and that is what makes this additive: every frame
 * recorded before this member existed — the captures under
 * `apps/agent/tests/fixtures/chat_stream/`, any deploy older than #1462 — keeps
 * describing exactly the turn it described, and a reader of those frames keeps
 * scoring what it scored.
 *
 * Zod-free on purpose: `workers/edge` writes this member and cannot load zod
 * into its bundle (`bundle-smoke/entry-bundle.test.ts`), while
 * `packages/eval`'s transcript shaper reads it. One declaration, both ends.
 */

/** Who asked for a step. */
export type AgentStepOrigin = "model" | "server";

/** The member a step-opening frame carries its origin under. */
export interface AgentStepOriginMetadata {
  readonly toolMetadata: { readonly origin: AgentStepOrigin };
}

/**
 * The marker a server-opened step's `tool-input-start` frame carries.
 *
 * Spread into the frame rather than assigned member by member, so the two
 * spellings this fact needs — the metadata slot and the member inside it —
 * exist once and are read back by `stepOriginOf` below.
 */
export function serverStepOrigin(): AgentStepOriginMetadata {
  return { toolMetadata: { origin: "server" } };
}

/** The metadata map a frame carries, or an empty one when it carries none. */
function toolMetadataOf(frame: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const metadata = frame.toolMetadata;
  return typeof metadata === "object" && metadata !== null ? (metadata as Record<string, unknown>) : {};
}

/** Who asked for the step this frame opened. Absent says the model did. */
export function stepOriginOf(frame: Readonly<Record<string, unknown>>): AgentStepOrigin {
  return toolMetadataOf(frame).origin === "server" ? "server" : "model";
}
