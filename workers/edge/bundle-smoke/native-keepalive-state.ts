import type { Session, AgentLane } from "@earendil-works/pi-agent-core";
import { MemorySessionRepo } from "@earendil-works/pi-agent-core";
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { createCatalogClient } from "@animichi/agent/tools";

function nativeResources() {
  const entered = Promise.withResolvers<undefined>();
  const released = Promise.withResolvers<undefined>();
  const provider = fauxProvider();
  provider.setResponses([async () => { entered.resolve(undefined); await released.promise; return fauxAssistantMessage("completed"); }]);
  const models = createModels();
  models.setProvider(provider.provider);
  return { entered, released, provider, models, repo: new MemorySessionRepo() };
}

function cleanupObservation() {
  return { collecting: false, promises: new Array<Promise<unknown>>() };
}

export function keepaliveState() {
  return {
    resources: nativeResources(), cleanup: cleanupObservation(),
    clock: { realNow: Date.now, now: Math.ceil(Date.now() / 1000) * 1000 + 60_000 },
    deadline: { id: "", time: 0 }, callback: Promise.withResolvers<undefined>(),
    calls: { count: 0, active: false, duringDrive: false, result: "pending" },
  };
}

export function composition(state: ReturnType<typeof keepaliveState>, session: Session) {
  return { models: state.resources.models, model: state.resources.provider.getModel(), toolContext: {
    session, branch: "main", locale: "en",
    catalog: createCatalogClient(() => Promise.reject(new Error("Unexpected catalog request"))),
    assertAuthorized: () => Promise.resolve(), reserveToolUsage: () => Promise.resolve(),
  } };
}

/** Observe the SDK's actual promises while forwarding every call to the native context unchanged. */
export function observeCleanup(ctx: DurableObjectState, cleanup: ReturnType<typeof cleanupObservation>) {
  const waitUntil = ctx.waitUntil.bind(ctx);
  ctx.waitUntil = (promise: Promise<unknown>) => {
    if (cleanup.collecting) cleanup.promises.push(promise);
    waitUntil(promise);
  };
}

export function releaseProvider(state: ReturnType<typeof keepaliveState>) {
  state.cleanup.collecting = true;
  state.resources.released.resolve(undefined);
}

export async function drainCleanup(state: ReturnType<typeof keepaliveState>) {
  state.cleanup.collecting = false;
  await Promise.all(state.cleanup.promises);
  state.cleanup.promises.length = 0;
}

export async function observeDrive(state: ReturnType<typeof keepaliveState>, drive: () => ReturnType<AgentLane["drive"]>) {
  state.calls.active = true;
  try { const result = await drive(); return { kind: result.ok ? result.value.kind : "error" }; }
  finally { state.calls.active = false; }
}

export function alarmSnapshot(state: ReturnType<typeof keepaliveState>, deadlineId: string | null, alarm: number | null) {
  return { deadlineId, deadlineTime: state.deadline.time, alarm, callbackCount: state.calls.count,
    callbackDuringDrive: state.calls.duringDrive, driveActive: state.calls.active, completedStatus: state.calls.result };
}
