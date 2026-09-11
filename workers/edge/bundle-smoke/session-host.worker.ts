import { getAgentByName } from "agents";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/pi-agent-core/harness/context";
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { createCatalogClient } from "@animichi/agent/tools";
import { SessionAgent } from "../src/agent/host/session-agent.ts";
import { HostFaultRepo } from "./session-host-faults.ts";

/** Test-only domain seam. Native repository, lane, scheduler and Agent execute all runtime behavior. */
export class HostProbe extends SessionAgent {
  readonly repo = new HostFaultRepo({ now: () => 0 });
  writers = 0;
  maxWriters = 0;
  operations: string[] = [];
  completed: string[] = [];
  #resolveEntered?: () => void;
  #resolveReleased?: () => void;
  readonly #entered = new Promise<void>((resolve) => { this.#resolveEntered = resolve; });
  readonly #released = new Promise<void>((resolve) => { this.#resolveReleased = resolve; });

  override async onStart() {
    const session = await this.repo.create({ id: this.name }, BACKGROUND_CONTEXT);
    await session.close(BACKGROUND_CONTEXT);
    const provider = fauxProvider();
    provider.setResponses(this.name === "/retry" ? [fauxAssistantMessage("", { stopReason: "error", errorMessage: "429 rate limit" }), fauxAssistantMessage("retried")] : [fauxAssistantMessage("first"), fauxAssistantMessage("second")]);
    const models = createModels();
    models.setProvider(provider.provider);
    this.bindSession(this.repo, session.metadata, (opened) => ({ models, model: provider.getModel(), retry: { enabled: true, maxRetries: 1, baseDelayMs: 1000 },
      toolContext: { session: opened, branch: "main", locale: "en", catalog: createCatalogClient(() => Promise.reject(new Error("Unexpected catalog request"))),
        assertAuthorized: () => Promise.resolve(), reserveToolUsage: () => Promise.resolve() } }));
    await super.onStart();
  }

  async acknowledgeAcceptedOperation() {
    return this.withSession(async (_session, lane, context) => {
      const accepted = await lane.accept({ kind: "prompt", operationId: "ack", prompt: "Recover after acknowledgment" }, context);
      if (!accepted.ok) throw accepted.error;
      await this.scheduleOperationWake("ack", 2_000_000_000_000);
      await this.scheduleOperationWake("ack", 2_000_000_000_000);
      return { accepted: accepted.value.operationId, schedules: (await this.listSchedules()).map((schedule) => ({ type: schedule.type, payload: schedule.payload as { operationId?: string; notBefore?: number } })) };
    });
  }

  async submit(operationId: string) {
    return this.withSession(async (_session, lane, context) => {
      this.writers += 1;
      this.maxWriters = Math.max(this.maxWriters, this.writers);
      if (operationId === "first") { this.#resolveEntered?.(); await this.#released; }
      const admission = await lane.accept({ kind: "prompt", operationId, prompt: operationId }, context);
      if (!admission.ok) throw admission.error;
      this.operations.push(admission.value.operationId);
      const outcome = await this.driveLane(lane, operationId, context);
      if (outcome.ok && outcome.value.kind === "settled") this.completed.push(outcome.value.outcome.operationId);
      this.writers -= 1;
    });
  }

  waitForEntry() { return this.#entered; }
  releaseEntry() { this.#resolveReleased?.(); }
  queueMarker() { return "entered"; }

  async report() {
    const schedules = await this.listSchedules();
    return { writers: this.maxWriters, operations: this.operations, completed: this.completed,
      scanCount: schedules.filter((schedule) => schedule.callback === "wakeSession" && schedule.type === "interval").length };
  }

  async loseResponse(stage: "accept" | "terminal") {
    await this.withSession(async (_session, lane, context) => {
      this.repo.loseCommit = stage === "accept" ? stage : undefined;
      const admission = await lane.accept({ kind: "prompt", operationId: "lost", prompt: "Complete legitimate work" }, context);
      if (!admission.ok) throw admission.error;
      this.repo.loseCommit = "terminal";
      await this.driveLane(lane, "lost", context);
    });
  }

  failReopen() { this.repo.failNextOpen = true; }

  async recovered() {
    return this.withSession(async (_session, lane, context) => ({
      current: (await lane.inspectExecution(context)).current,
      result: (await lane.getResult("lost", context))?.status,
      opens: this.repo.opens,
    }));
  }

  async retryPass() {
    const realNow = Date.now;
    let clock = Math.ceil(realNow() / 1000) * 1000 + 250;
    Date.now = () => clock;
    try {
      return await this.withSession(async (_session, lane, context, harness) => {
        harness.events.on("retry_scheduled", (event) => { setTimeout(() => { clock = event.notBefore + 1; }, 0); });
        const accepted = await lane.accept({ kind: "prompt", operationId: "retry", prompt: "Retry safely" }, context);
        if (!accepted.ok) throw accepted.error;
        const result = await this.driveLane(lane, "retry", context);
        const schedules = await this.listSchedules();
        const wake = schedules.find((schedule) => schedule.type === "scheduled");
        const payload = wake?.payload;
        const notBefore = typeof payload === "object" && payload !== null && "notBefore" in payload ? payload.notBefore : undefined;
        if (typeof notBefore !== "number") throw new Error("Native retry schedule has no numeric deadline");
        return { kind: result.ok ? result.value.kind : "error", wakeAt: wake?.time,
          notBefore, scanCount: schedules.filter((schedule) => schedule.type === "interval").length };
      });
    } finally { Date.now = realNow; }
  }

  async disconnectedTurn() {
    return this.withSession(async (_session, lane, context) => {
      const accepted = await lane.accept({ kind: "prompt", operationId: "private", prompt: "host-payload-sentinel-943" }, context);
      if (!accepted.ok) throw accepted.error;
      const result = await this.driveLane(lane, "private", context);
      return result.ok && result.value.kind === "settled" ? result.value.outcome.status : "not-settled";
    }, withAbortSignal(AbortSignal.abort(), BACKGROUND_CONTEXT));
  }

  async persistedData() {
    // Runtime tables are inaccessible through SQL; public APIs expose KV, alarm and attachments.
    const tables = this.ctx.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'").toArray();
    const rows = tables.map(({ name }) => ({ name, rows: this.ctx.storage.sql.exec(`SELECT * FROM "${name.replaceAll('"', '""')}"`).toArray() }));
    return JSON.stringify({ rows, kv: [...await this.ctx.storage.list()], alarm: await this.ctx.storage.getAlarm(), sockets: this.ctx.getWebSockets().map((socket) => socket.deserializeAttachment() as unknown) });
  }
}

export default {
  async fetch(request: Request, env: { SESSION: DurableObjectNamespace<HostProbe> }) {
    const path = new URL(request.url).pathname;
    const host = await getAgentByName(env.SESSION, path, { locationHint: "apac" });
    if (path === "/ack-wake") return Response.json(await host.acknowledgeAcceptedOperation());
    if (path === "/retry") return Response.json(await host.retryPass());
    if (path === "/persistence") return Response.json({ status: await host.disconnectedTurn(), persisted: await host.persistedData() });
    if (path === "/lost-accept" || path === "/lost-terminal") {
      const failed = await host.loseResponse(path === "/lost-accept" ? "accept" : "terminal").then(() => false, () => true);
      await host.failReopen();
      const reopenFailed = await host.wakeSession().then(() => false, () => true);
      await host.wakeSession();
      return Response.json({ failed, reopenFailed, ...await host.recovered() });
    }
    const first = host.submit("first");
    await host.waitForEntry();
    const second = host.submit("second");
    const wake = host.wakeSession();
    await host.queueMarker();
    await host.releaseEntry();
    await Promise.all([first, second, wake]);
    return Response.json(await host.report());
  },
};
