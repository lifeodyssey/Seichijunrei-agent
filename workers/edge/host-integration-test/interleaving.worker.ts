import type { AgentLane } from "@earendil-works/pi-agent-core";
import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import type { Session } from "@earendil-works/pi-agent-core/harness/session";
import type { createPilgrimageHarness } from "@animichi/agent/harness";
import type { ModelAdmissionRequest, AdmissionOptions } from "../src/agent/admission/types.ts";
import type { ByokCredentialParts } from "../src/agent/byok/byok-credential.ts";
import { sessionAgentStub } from "../src/agent/host/session-agent-stub.ts";
import { BusinessHost as NativeBusinessHost } from "./business-host.worker.ts";

type Harness = Awaited<ReturnType<typeof createPilgrimageHarness>>["harness"];
export interface InterleavingReport {
  initialized: number; requests: number; callbacks: number; active: number; maxActive: number;
  driveCalls: number; activeDrives: number; maxDrives: number; sessions: number; harnesses: number;
}

/** Transparent observations around the real host; the native superclass performs every operation. */
export class BusinessHost extends NativeBusinessHost {
  #report: InterleavingReport = { initialized: 0, requests: 0, callbacks: 0, active: 0, maxActive: 0,
    driveCalls: 0, activeDrives: 0, maxDrives: 0, sessions: 0, harnesses: 0 };
  #sessions = new Set<Session>();
  #harnesses = new Set<Harness>();
  #contenders = Promise.withResolvers<undefined>();

  protected override async initializeSession() {
    this.#report.initialized += 1;
    await super.initializeSession();
  }

  protected override withSession<T>(work: (session: Session, lane: AgentLane, context: Context, harness: Harness) => Promise<T>, context?: Context): Promise<T> {
    return super.withSession(async (session, lane, current, harness) => {
      this.#sessions.add(session); this.#harnesses.add(harness);
      this.#report.sessions = this.#sessions.size; this.#report.harnesses = this.#harnesses.size;
      this.#report.active += 1; this.#report.maxActive = Math.max(this.#report.maxActive, this.#report.active);
      try { return await work(session, lane, current, harness); }
      finally { this.#report.active -= 1; }
    }, context);
  }

  override async submitModel(request: ModelAdmissionRequest, options: AdmissionOptions, credential?: ByokCredentialParts) {
    this.#report.requests += 1;
    this.#observeContenders();
    return super.submitModel(request, options, credential);
  }

  override async wakeSession() {
    this.#report.callbacks += 1;
    this.#observeContenders();
    await super.wakeSession();
  }

  protected override async driveLane(lane: AgentLane, operationId: string, context: Context) {
    this.#report.driveCalls += 1; this.#report.activeDrives += 1;
    this.#report.maxDrives = Math.max(this.#report.maxDrives, this.#report.activeDrives);
    try { return await super.driveLane(lane, operationId, context); }
    finally { this.#report.activeDrives -= 1; }
  }

  #observeContenders() {
    if (this.#report.requests >= 2 && this.#report.callbacks > 0) this.#contenders.resolve(undefined);
  }

  async queueRecovery() {
    await this.schedule(0, "wakeSession", { source: "interleaving-proof" }, { idempotent: true });
  }

  async contenders() { await this.#contenders.promise; return this.observations(); }
  observations() { return Promise.resolve({ ...this.#report }); }
}

export default {
  async fetch(request: Request, env: { SESSION: DurableObjectNamespace<BusinessHost> }) {
    const input = await request.json() as ModelAdmissionRequest;
    const host = await sessionAgentStub(env.SESSION, input.sessionId);
    const path = new URL(request.url).pathname;
    if (path === "/schedule") { await host.queueRecovery(); return new Response("scheduled"); }
    if (path === "/contenders") return Response.json(await host.contenders());
    if (path === "/report") return Response.json(await host.observations());
    return Response.json(await host.submitModel(input, { anonymousAllowance: 2, now: Date.now() }));
  },
};
