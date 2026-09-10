import { operationToolsContext } from "./operation-tool-settings.ts";
import { submitSelection, reconcileSelectionIntent, type SelectionSubmission } from "../selection/native-selection.ts";
import { createCatalogClient } from "@animichi/agent/tools";
import { selectionResponse } from "../views/selection-response.ts";
import { nativeWatchResponse, watchNativeOperation } from "../views/watch-response.ts";
import { modelAdmissionResponse } from "../../gateway/native-admission-response.ts";
import { SecretScrub } from "../egress/secret-scrub.ts";
import { Agent } from "agents";
import type { AgentHarnessOptions, AgentLane } from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT, withoutAbortSignal, type Context } from "@earendil-works/pi-agent-core/harness/context";
import type { Session, SessionMetadata, SessionRepo } from "@earendil-works/pi-agent-core/harness/session";
import { createPilgrimageHarness } from "@animichi/agent/harness";
import type { PilgrimageToolContext } from "@animichi/agent/tools";
import { NeonSessionRepo } from "@animichi/pi-session-neon";
import type { Contract } from "@animichi/pi-session-neon/types";
import type { PostgresClient } from "@prisma/orm-postgres/runtime";
import { admitModelRequest } from "../admission/admit-model-request.ts";
import type { AdmissionDatabase, AdmissionOptions, ModelAdmissionOutcome, ModelAdmissionRequest } from "../admission/types.ts";
import { reconcileModelAdmission } from "../admission/reconcile-model-admission.ts";
import { scanAdmissionIntents, scanSelectionIntents, scanUnsettledOperations } from "../recovery/scan.ts";
import { prepareModelOperation } from "../recovery/prepare-model-operation.ts";
import { settleModelOperation } from "../settlement/native-settlement.ts";
import { bootstrapNativeSession, type NativeSessionResources } from "./native-bootstrap.ts";
import { watchableReplay } from "./watchable-replay.ts";
import { admitConfiguredModel, configuredReplayRequest } from "./configured-admission.ts";
import { prepareAuthorizedDrive } from "./prepare-authorized-drive.ts";
import { nativeByokModels } from "./native-models.ts";
import type { ByokCredentialParts } from "../byok/byok-credential.ts";
import type { Env } from "../../env.ts";
import { ownsConversation } from "../admission/session-owner.ts";
import { conversationNotFound } from "../../gateway/agent-turn-responses.ts";

type Composition = (session: Session) => Omit<AgentHarnessOptions<PilgrimageToolContext>, "session" | "tools">;
type Harness = Awaited<ReturnType<typeof createPilgrimageHarness>>["harness"];

/** Pi owns execution; the native Agent owns lifetime and exclusion across database awaits. */
export class SessionAgent extends Agent<Env> {
  #tail: Promise<void> = Promise.resolve();
  #source?: { repo: SessionRepo; metadata: SessionMetadata; compose: Composition };
  #attached?: { session: Session; harness: Harness; lane: AgentLane };
  #faulted = false;
  #driving = false;
  #business?: AdmissionDatabase;
  #resources?: NativeSessionResources;
  #credentials = new Map<string, Awaited<ReturnType<typeof nativeByokModels>>>();

  override async onStart() {
    await this.scheduleEvery(30, "wakeSession");
    if (!this.#source) await this.initializeSession();
  }

  /** Tests may supply a real native memory repository; deployed instances always initialize from Env. */
  protected async initializeSession() {
    const resources = await bootstrapNativeSession(this.env, this.name, BACKGROUND_CONTEXT);
    this.bindSession(resources.repo, resources.metadata, resources.compose);
    this.#resources = resources;
    this.#business = resources.db;
  }

  /** Domain startup binds the direct NeonSessionRepo; Node/workerd tests use the native memory repo. */
  protected bindSession(repo: SessionRepo, metadata: SessionMetadata, compose: Composition) {
    if (this.#source) throw new Error("The session repository is already bound");
    this.#source = { repo, metadata, compose };
  }

  /** The production binding keeps the database caller-owned and uses the SDK SessionRepo directly. */
  protected bindNeonSession(db: PostgresClient<Contract>, metadata: SessionMetadata, compose: Composition) {
    this.bindSession(new NeonSessionRepo(db), metadata, compose);
    this.#business = db;
  }

  /** All future admission/selection/settlement writes enter here, before touching business state. */
  protected withSession<T>(work: (session: Session, lane: AgentLane, context: Context, harness: Harness) => Promise<T>, context: Context = BACKGROUND_CONTEXT): Promise<T> {
    const exclusive = this.#tail.then(async () => {
      await this.scheduleEvery(30, "wakeSession");
      const durableContext = withoutAbortSignal(context);
      const attached = await this.#attach(durableContext);
      return work(attached.session, attached.lane, durableContext, attached.harness);
    });
    this.#tail = exclusive.then(() => undefined, () => undefined);
    return exclusive;
  }

  /** The gateway supplies its validated identity; the DO name is the session authority. */
  async submitModel(request: ModelAdmissionRequest, options: AdmissionOptions, credential?: ByokCredentialParts): Promise<ModelAdmissionOutcome> {
    if (request.sessionId !== this.name) return { kind: "forbidden", operationId: null };
    return this.withSession((session, lane, context) => this.#submit(request, options, credential, session, lane, context));
  }

  /** The native watch is paired while the same admission exclusion is held, before any alarm can drive. */
  async submitChat(request: ModelAdmissionRequest, options: AdmissionOptions, credential?: ByokCredentialParts): Promise<Response> {
    if (request.sessionId !== this.name) return modelAdmissionResponse({ kind: "forbidden", operationId: null }, this.name);
    const replay = await this.#replayWhileDriving(request, credential);
    if (replay) return replay;
    return this.withSession(async (session, lane, context) => {
      const outcome = await this.#submit(request, options, credential, session, lane, context);
      if (outcome.kind !== "accepted" && outcome.kind !== "replayed") return modelAdmissionResponse(outcome, this.name);
      return this.#watchOperation(lane, outcome.operationId, context);
    });
  }

  async #replayWhileDriving(request: ModelAdmissionRequest, credential?: ByokCredentialParts): Promise<Response | undefined> {
    const attached = this.#attached;
    if (!this.#driving || this.#faulted || !attached) return undefined;
    const configured = this.#resources ? await configuredReplayRequest(this.#resources, request, credential) : request;
    const outcome = await watchableReplay(this.#requireBusiness(), configured);
    if (!outcome || !this.#canReadAttached(attached.lane)) return undefined;
    if (outcome.kind !== "replayed") return modelAdmissionResponse(outcome, this.name);
    return this.#watchOperation(attached.lane, outcome.operationId, BACKGROUND_CONTEXT);
  }

  /** A resumed UI reads the same native watch without model input, credentials or another admission. */
  async watchChat(identityId: string, operationId: string): Promise<Response> {
    if (!await ownsConversation(this.#requireBusiness(), this.name, identityId)) return conversationNotFound();
    const attached = this.#attached;
    if (attached && this.#canReadAttached(attached.lane)) return this.#watchOperation(attached.lane, operationId, BACKGROUND_CONTEXT);
    return this.withSession((_session, lane, context) => this.#watchOperation(lane, operationId, context));
  }

  #canReadAttached(lane: AgentLane) {
    return !this.#faulted && this.#attached?.lane === lane;
  }

  async #watchOperation(lane: AgentLane, operationId: string, context: Context) {
    const watch = await watchNativeOperation(lane, operationId, context);
    if (!watch) return conversationNotFound();
    const scrub = this.#credentials.get(operationId)?.scrub ?? this.#resources?.server.scrub ?? new SecretScrub();
    return nativeWatchResponse(watch, this.name, operationId, scrub);
  }

  async #submit(request: ModelAdmissionRequest, options: AdmissionOptions, credential: ByokCredentialParts | undefined, session: Session, lane: AgentLane, context: Context) {
    const db = this.#requireBusiness();
    if (await this.#reconcileSelections(lane, context)) return { kind: "blocked", operationId: null } as const;
    await this.#reconcileBeforeAdmission(session, lane, context);
    const outcome = this.#resources
      ? await admitConfiguredModel(this.#resources, this.#credentials, session, lane, context, request, options, credential)
      : await admitModelRequest(db, lane, context, request, options);
    if (outcome.operationId && outcome.kind !== "rejected") await this.scheduleOperationWake(outcome.operationId);
    return outcome;
  }

  /** Re-read all discovery sources on each wake; SDK open snapshots are never a business index. */
  async wakeSession(): Promise<void> {
    await this.withSession(async (session, lane, context) => {
      if (!this.#business) {
        const current = (await lane.inspectExecution(context)).current;
        if (current && !await lane.getResult(current.id, context)) await this.driveLane(lane, current.id, context);
        return;
      }
      const pendingSelection = await this.#reconcileSelections(lane, context);
      const admissions = pendingSelection ? [] : await scanAdmissionIntents(this.#business, this.name);
      for (const admission of admissions) {
        if (admission.operationId !== null) await this.#advanceOperation(session, lane, admission.operationId, context);
      }
      await this.#settleDiscovered(session, lane, context);
    });
  }

  async submitSelection(request: SelectionSubmission): Promise<Response> {
    if (request.sessionId !== this.name) return selectionResponse({ kind: "forbidden" }, this.name);
    return this.withSession(async (session, lane, context) => {
      await this.#reconcileBeforeAdmission(session, lane, context);
      await this.#reconcileSelections(lane, context);
      await this.schedule(0, "wakeSession", { requestKey: request.clientMessageId }, { idempotent: true });
      const outcome = await submitSelection(this.#requireBusiness(), lane, context, request, createCatalogClient((input) => this.env.CATALOG.fetch(input)));
      return selectionResponse(outcome, this.name);
    });
  }

  async #reconcileSelections(lane: AgentLane, context: Context) {
    const db = this.#requireBusiness();
    const pending = await scanSelectionIntents(db, this.name);
    for (const admission of pending) await reconcileSelectionIntent(db, lane, context, admission, createCatalogClient((input) => this.env.CATALOG.fetch(input)));
    return (await scanSelectionIntents(db, this.name)).length > 0;
  }

  #requireBusiness() {
    if (!this.#business) throw new Error("The native business database is not bound");
    return this.#business;
  }

  async #reconcileBeforeAdmission(session: Session, lane: AgentLane, context: Context) {
    const db = this.#requireBusiness();
    const admissions = await scanAdmissionIntents(db, this.name);
    for (const admission of admissions) {
      if (admission.operationId === null) throw new Error("A model admission has no operation ID");
      await reconcileModelAdmission(db, lane, context, { sessionId: this.name, operationId: admission.operationId }, Date.now());
    }
    await this.#settleDiscovered(session, lane, context);
  }

  async #advanceOperation(session: Session, lane: AgentLane, operationId: string, context: Context) {
    const db = this.#requireBusiness();
    const ready = this.#resources
      ? await prepareAuthorizedDrive(this.#resources, this.#credentials.has(operationId), session, lane, operationId, context)
      : await prepareModelOperation(db, session, lane, operationId, context);
    if (!ready) return;
    await this.scheduleOperationWake(operationId);
    const driveContext = this.#resources ? await operationToolsContext(this.#resources, this.#credentials, session, operationId, context) : context;
    await this.driveLane(lane, operationId, driveContext);
    await this.#settleOperation(session, lane, operationId, context);
  }

  async #settleDiscovered(session: Session, lane: AgentLane, context: Context) {
    const db = this.#requireBusiness();
    for (const obligation of await scanUnsettledOperations(db, this.name)) {
      await this.#settleOperation(session, lane, obligation.operationId, context);
    }
  }

  async #settleOperation(session: Session, lane: AgentLane, operationId: string, context: Context) {
    const result = await settleModelOperation(this.#requireBusiness(), session, lane, operationId, context, Date.now());
    const credential = this.#credentials.get(operationId);
    if (!result || !credential) return;
    await credential.models.logout(credential.model.provider);
    this.#credentials.delete(operationId);
    this.#resources?.server.models.deleteProvider(credential.model.provider);
  }

  /** Persist before acknowledgment or drive; native callback/payload identity deduplicates retries. */
  protected async scheduleOperationWake(operationId: string, notBefore?: number) {
    const when = notBefore === undefined ? 0 : new Date(Math.ceil(notBefore / 1000) * 1000);
    const payload = notBefore === undefined ? { operationId } : { operationId, notBefore };
    await this.schedule(when, "wakeSession", payload, { idempotent: true });
  }

  /** SDK keepalive and one-shot schedules share the SDK's alarm multiplexer. */
  protected async driveLane(lane: AgentLane, operationId: string, context: Context) {
    this.#driving = true;
    try { return await this.#driveAndSchedule(lane, operationId, context); }
    finally { this.#driving = false; }
  }

  async #driveAndSchedule(lane: AgentLane, operationId: string, context: Context) {
    const result = await this.keepAliveWhile(() => lane.drive({ operationId, waitForRetry: false }, context));
    if (result.ok && result.value.kind === "waiting" && result.value.reason === "retry") {
      const notBefore = result.value.notBefore;
      await this.scheduleOperationWake(operationId, notBefore);
    }
    return result;
  }

  async #attach(context: Context) {
    if (this.#faulted && this.#attached) {
      await this.#attached.harness.close(context);
      this.#attached = undefined;
    }
    if (this.#attached) return this.#attached;
    const source = this.#source;
    if (!source) throw new Error("Native session composition must be bound before attachment");
    const session = await source.repo.open(source.metadata, context);
    try {
      const { harness } = await createPilgrimageHarness({ ...source.compose(session), session }, context);
      const lane = await harness.lane("main", context);
      harness.events.on("fault", () => { this.#faulted = true; });
      this.#faulted = false;
      this.#attached = { session, harness, lane };
      return this.#attached;
    } catch (error) {
      await session.close(context);
      throw error;
    }
  }
}
