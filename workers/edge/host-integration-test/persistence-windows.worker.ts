import { BusinessHost as NativeBusinessHost } from "./business-host.worker.ts";
import { sessionAgentStub } from "../src/agent/host/session-agent-stub.ts";
import type { AdmissionDatabase, ModelAdmissionRequest } from "../src/agent/admission/types.ts";
import type { SelectionSubmission } from "../src/agent/selection/native-selection.ts";
import { loseCommittedAcknowledgement } from "../admission-test/committed-ack.ts";

interface PersistenceObservation { boundary: string; admissions: number; state: string | null; open: number; intervals: number }

async function observePersistence(db: AdmissionDatabase | undefined, sessionId: string, boundary: string, schedules: Awaited<ReturnType<NativeBusinessHost["listSchedules"]>>): Promise<PersistenceObservation> {
  if (!db) throw new Error("The actual business database was not initialized");
  const rows = await db.orm.public.AgentAdmission.where({ sessionId }).all();
  const open = await db.orm.public.AgentOpenOperation.all();
  return { boundary, admissions: rows.length, state: rows[0]?.state ?? null,
    open: open.length, intervals: schedules.filter((schedule) => schedule.type === "interval").length };
}

/** Faults decorate actual Prisma transactions and native Agent scheduling only. */
export class BusinessHost extends NativeBusinessHost {
  #db?: AdmissionDatabase;
  #failScan = false;
  #failWake = false;
  #wakeCalls = 0;
  #observations: PersistenceObservation[] = [];

  protected override configureDatabase(db: AdmissionDatabase) {
    this.#db = db;
    if (this.env.TEST_SELECTION_INTENT_LOSS === "true") loseCommittedAcknowledgement(db, async () => {
      const row = await db.orm.public.AgentAdmission.where({ sessionId: this.name, kind: "selection" }).first();
      return row?.state === "pending" && row.selectionRequest !== null;
    });
    return db;
  }

  async armScanFailure() {
    const schedules = await this.listSchedules();
    for (const schedule of schedules) await this.cancelSchedule(schedule.id);
    this.#failScan = true;
  }

  armWakeFailure() { this.#failWake = true; return Promise.resolve(); }
  reportPersistence() { return Promise.resolve({ observations: this.#observations, wakeCalls: this.#wakeCalls }); }

  override async scheduleEvery<T = string>(interval: number, callback: keyof this, payload?: T, options?: Parameters<NativeBusinessHost["scheduleEvery"]>[3]) {
    if (this.#failScan) {
      this.#failScan = false;
      await this.#observe("scan-failure");
      throw new Error("Injected recurring scan registration failure");
    }
    return super.scheduleEvery(interval, callback, payload, options);
  }

  override async schedule<T = string>(when: Date | string | number, callback: keyof this, payload?: T, options?: Parameters<NativeBusinessHost["schedule"]>[3]) {
    if (this.#failWake && typeof payload === "object" && payload !== null && "operationId" in payload) {
      this.#failWake = false;
      await this.#observe("first-wake-failure");
      throw new Error("Injected first operation wake registration failure");
    }
    return super.schedule(when, callback, payload, options);
  }

  override async wakeSession() { this.#wakeCalls += 1; await super.wakeSession(); }

  async #observe(boundary: string) {
    this.#observations.push(await observePersistence(this.#db, this.name, boundary, await this.listSchedules()));
  }
}

export default {
  async fetch(request: Request, env: { SESSION: DurableObjectNamespace<BusinessHost> }) {
    const input = await request.json() as ModelAdmissionRequest & SelectionSubmission;
    const host = await sessionAgentStub(env.SESSION, input.sessionId);
    const path = new URL(request.url).pathname;
    if (path === "/arm-scan") { await host.armScanFailure(); return new Response("armed"); }
    if (path === "/arm-wake") { await host.armWakeFailure(); return new Response("armed"); }
    if (path === "/report") return Response.json(await host.reportPersistence());
    if (path === "/selection") return host.submitSelection(input);
    if (path === "/wake") { await host.wakeSession(); return new Response("woken"); }
    return Response.json(await host.submitModel(input, { anonymousAllowance: 2, now: Date.now() }));
  },
};
