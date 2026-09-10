import type { ModelAdmissionRequest, AdmissionOptions } from "../src/agent/admission/types.ts";
import type { ByokCredentialParts } from "../src/agent/byok/byok-credential.ts";
import { sessionAgentStub } from "../src/agent/host/session-agent-stub.ts";
import { BusinessHost as ObservedNativeHost } from "./interleaving.worker.ts";

/** Count entry arrivals only; inherited native resource binding, attachment and execution are unchanged. */
export class BusinessHost extends ObservedNativeHost {
  #requests = 0;
  #wakes = 0;
  readonly #arrived = Promise.withResolvers<undefined>();

  override submitModel(request: ModelAdmissionRequest, options: AdmissionOptions, credential?: ByokCredentialParts) {
    this.#requests += 1; this.#observe();
    return super.submitModel(request, options, credential);
  }

  override async wakeSession() {
    this.#wakes += 1; this.#observe();
    await super.wakeSession();
  }

  #observe() {
    if (this.#requests >= 2 && this.#wakes >= 2) this.#arrived.resolve(undefined);
  }

  async reattachContenders() {
    await this.#arrived.promise;
    return this.observations();
  }
}

export default {
  async fetch(request: Request, env: { SESSION: DurableObjectNamespace<BusinessHost> }) {
    const input = await request.json() as ModelAdmissionRequest;
    const host = await sessionAgentStub(env.SESSION, input.sessionId);
    const path = new URL(request.url).pathname;
    if (path === "/reattach") { await host.wakeSession(); return new Response("reattached"); }
    if (path === "/schedule") { await host.queueRecovery(); return new Response("scheduled"); }
    if (path === "/contenders") return Response.json(await host.reattachContenders());
    if (path === "/report") return Response.json(await host.observations());
    if (path === "/reopen-report") return Response.json(await host.reportReopenFailures());
    return Response.json(await host.submitModel(input, { anonymousAllowance: 2, now: Date.now() }));
  },
};
