import postgresClient, { type PostgresClient } from "@prisma/orm-postgres/runtime";
import contractJson from "@animichi/pi-session-neon/contract" with { type: "json" };
import type { Contract } from "@animichi/pi-session-neon/types";
import { NeonSessionRepo } from "@animichi/pi-session-neon";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import type { SessionMetadata } from "@earendil-works/pi-agent-core/harness/session";
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { createCatalogClient } from "@animichi/agent/tools";
import { SessionAgent } from "../src/agent/host/session-agent.ts";
import { sessionAgentStub } from "../src/agent/host/session-agent-stub.ts";
import { persistPermanentRejection } from "../src/agent/admission/permanent-rejection.ts";
import { gateNativeResultReads, loseNativeReply } from "./lost-reply.ts";
import type { ModelAdmissionRequest } from "../src/agent/admission/types.ts";

/** Only runtime resources/provider transport are supplied here; production submit/wake own every business action. */
export class BusinessHost extends SessionAgent {
  #lost = false;
  #failReattach = false;
  #evidenceBlocked = false;
  #evidenceFailures = 0;
  readonly #evidenceFailed = Promise.withResolvers<undefined>();
  reopenFailures = 0;
  #retryResolve?: (notBefore: number) => void;
  readonly #retryScheduled = new Promise<number>((resolve) => { this.#retryResolve = resolve; });

  async retrySchedules() {
    const notBefore = await this.#retryScheduled;
    return this.withSession(async () => ({ notBefore, schedules: (await this.listSchedules()).map((schedule) => ({ type: schedule.type, time: schedule.time })) }));
  }


  reportReopenFailures() { return Promise.resolve(this.reopenFailures); }
  async reportEvidenceFailure() { await this.#evidenceFailed.promise; return this.#evidenceFailures; }
  releaseEvidenceReads() { this.#evidenceBlocked = false; return Promise.resolve(); }

  protected configureDatabase(db: PostgresClient<Contract>) { return db; }

  protected override async initializeSession() {
    const url = this.env.AGENT_SVC_DATABASE_URL;
    if (typeof url !== "string") throw new Error("Disposable database is missing");
    const db = this.configureDatabase(postgresClient<Contract>({ contractJson, url }));
    const metadata = await db.orm.public.PiSession.where({ id: this.name }).first();
    const created = metadata ? undefined : await new NeonSessionRepo(db).create({ id: this.name }, BACKGROUND_CONTEXT);
    const nativeMetadata = created?.metadata ?? metadata?.metadata as unknown as SessionMetadata;
    await created?.close(BACKGROUND_CONTEXT);
    const provider = fauxProvider();
    provider.setResponses(this.env.TEST_RETRY === "true"
      ? [fauxAssistantMessage("", { stopReason: "error", errorMessage: "429 rate limit" }), fauxAssistantMessage("Retried")]
      : [fauxAssistantMessage("Completed"), fauxAssistantMessage("Second completed")]);
    const models = createModels();
    models.setProvider(provider.provider);
    this.bindNeonSession(db, nativeMetadata, (session) => {
      if (this.#failReattach) { this.#failReattach = false; this.reopenFailures += 1; throw new Error("Injected first reattach outage"); }
      const loss = this.env.TEST_LOST_REPLY;
      if (!this.#lost && (loss === "accept" || loss === "drive" || loss === "terminal")) loseNativeReply(session, loss, () => {
        this.#lost = true; this.#failReattach = true; this.#evidenceBlocked = this.env.TEST_WITNESS_OUTAGE === "true";
      });
      gateNativeResultReads(session, () => this.#evidenceBlocked, () => { this.#evidenceFailures += 1; this.#evidenceFailed.resolve(undefined); });
      return { models, model: provider.getModel(), retry: { enabled: true, maxRetries: 1, baseDelayMs: 60_000 },
      toolContext: { session, branch: "main", locale: "en",
        catalog: createCatalogClient(() => Promise.reject(new Error("No catalog call expected"))),
        assertAuthorized: () => Promise.reject(new Error("No tool invocation authorized in this lifecycle case")),
        reserveToolUsage: () => Promise.reject(new Error("No tool reservation expected")) } }; });
    if (this.env.TEST_REJECT === "true") await this.withSession((_session, lane, _context, harness) => {
      harness.hooks.on("before_drive", async (_event, context) => {
        const current = (await lane.inspectExecution(context)).current;
        if (!current) throw new Error("The controlled refusal requires an actual operation");
        await persistPermanentRejection(db, { sessionId: this.name, operationId: current.id }, "authorization_revoked");
        throw new Error("Injected lost native response");
      });
      return Promise.resolve();
    });
    if (this.env.TEST_RETRY === "true") await this.withSession((_session, _lane, _context, harness) => {
      harness.events.on("retry_scheduled", (event) => { this.#retryResolve?.(event.notBefore); });
      return Promise.resolve();
    });
  }
}

export default {
  async fetch(request: Request, env: { SESSION: DurableObjectNamespace<BusinessHost> }) {
    const input = await request.json() as ModelAdmissionRequest;
    const host = await sessionAgentStub(env.SESSION, input.sessionId);
    if (new URL(request.url).pathname === "/initialize") return new Response("initialized");
    if (new URL(request.url).pathname === "/retry-report") return Response.json(await host.retrySchedules());
    if (new URL(request.url).pathname === "/reopen-report") return Response.json(await host.reportReopenFailures());
    if (new URL(request.url).pathname === "/evidence-failure") return Response.json(await host.reportEvidenceFailure());
    if (new URL(request.url).pathname === "/restore-evidence") { await host.releaseEvidenceReads(); return new Response("restored"); }
    if (new URL(request.url).pathname === "/wake") { await host.wakeSession(); return new Response("woken"); }
    return Response.json(await host.submitModel(input, { anonymousAllowance: 2, now: Date.now() }));
  },
};
