import { getAgentByName } from "agents";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { SessionAgent } from "../src/agent/host/session-agent.ts";
import { keepaliveState, composition, observeCleanup, releaseProvider, drainCleanup, observeDrive, alarmSnapshot } from "./native-keepalive-state.ts";

/** Real SDK scheduling and drive, with a public faux-provider response barrier. */
export class KeepaliveProbe extends SessionAgent {
  static override options = { keepAliveIntervalMs: 1_000 };
  readonly #state = keepaliveState();
  override async onStart() {
    observeCleanup(this.ctx, this.#state.cleanup);
    Date.now = () => this.#state.clock.now;
    const session = await this.#state.resources.repo.create({ id: this.name }, BACKGROUND_CONTEXT);
    await session.close(BACKGROUND_CONTEXT);
    this.bindSession(this.#state.resources.repo, session.metadata, (opened) => composition(this.#state, opened));
    await super.onStart();
  }
  async startDrive() {
    const deadline = await this.schedule(new Date(this.#state.clock.now + 10_000), "deadline", { operationId: "held" });
    this.#state.deadline = { id: deadline.id, time: deadline.time * 1000 };
    return this.withSession(async (_session, lane, context) => {
      const accepted = await lane.accept({ kind: "prompt", operationId: "held", prompt: "finish" }, context);
      if (!accepted.ok) throw accepted.error;
      return observeDrive(this.#state, () => this.driveLane(lane, "held", context));
    });
  }
  async deadline() {
    await this.withSession(async (_session, lane, context) => {
      this.#state.calls.duringDrive = this.#state.calls.active;
      this.#state.calls.result = (await lane.getResult("held", context))?.status ?? "missing";
      this.#state.calls.count += 1;
      this.#state.callback.resolve(undefined);
    });
  }
  async inspect() {
    const deadline = await this.getScheduleById(this.#state.deadline.id);
    return alarmSnapshot(this.#state, deadline?.id ?? null, await this.ctx.storage.getAlarm());
  }
  waitForProvider() { return this.#state.resources.entered.promise; }
  releaseProvider() { releaseProvider(this.#state); }
  drainCleanup() { return drainCleanup(this.#state); }
  restoreClock() { Date.now = this.#state.clock.realNow; }
  waitForCallback() { return this.#state.callback.promise; }
  async fireDeadline() { this.#state.clock.now = this.#state.deadline.time + 1; await this.ctx.storage.setAlarm(this.#state.clock.realNow()); }
}

async function probeResponse(host: DurableObjectStub<KeepaliveProbe>, path: string): Promise<Response> {
  if (path === "/drive") return Response.json(await host.startDrive());
  if (path === "/entered") { await host.waitForProvider(); return new Response("entered"); }
  if (path === "/release") { await host.releaseProvider(); return new Response("released"); }
  if (path === "/drain") { await host.drainCleanup(); return new Response("drained"); }
  if (path === "/fire") { await host.fireDeadline(); return new Response("armed"); }
  if (path === "/callback") { await host.waitForCallback(); return Response.json(await host.inspect()); }
  if (path === "/restore") { await host.restoreClock(); return new Response("restored"); }
  return Response.json(await host.inspect());
}

export default {
  async fetch(request: Request, env: { SESSION: DurableObjectNamespace<KeepaliveProbe> }) {
    return probeResponse(await getAgentByName(env.SESSION, "keepalive", { locationHint: "apac" }), new URL(request.url).pathname);
  },
};
