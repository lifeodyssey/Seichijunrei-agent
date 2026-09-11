import type { Session } from "@earendil-works/pi-agent-core/harness/session";
import { persistOperationInput } from "./operation-tool-settings.ts";
import type { AgentLane } from "@earendil-works/pi-agent-core";
import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import { prepareModelAdmission, acceptReservedModel } from "../admission/admit-model-request.ts";
import type { AdmissionOptions, ModelAdmissionOutcome, ModelAdmissionRequest } from "../admission/types.ts";
import type { ByokCredentialParts } from "../byok/byok-credential.ts";
import type { NativeSessionResources } from "./native-bootstrap.ts";
import { nativeByokModels } from "./native-models.ts";

type CredentialModels = Awaited<ReturnType<typeof nativeByokModels>>;
export type OperationCredentials = Map<string, CredentialModels>;

async function bindCredential(resources: NativeSessionResources, credentials: OperationCredentials, lane: AgentLane, context: Context, operationId: string, byok: CredentialModels) {
  if (await lane.getResult(operationId, context)) return;
  const provider = byok.models.getProvider(byok.model.provider);
  if (!provider) throw new Error("The native BYOK provider is unavailable");
  const previous = credentials.get(operationId);
  if (previous) await previous.models.logout(previous.model.provider);
  resources.server.models.setProvider(provider);
  credentials.set(operationId, byok);
}

function canBind(prepared: Awaited<ReturnType<typeof prepareModelAdmission>>) {
  return "id" in prepared || prepared.kind === "replayed" || prepared.kind === "pending";
}
async function requestModels(resources: NativeSessionResources, request: ModelAdmissionRequest, credential?: ByokCredentialParts) {
  if ((request.payer === "byok") !== Boolean(credential)) throw new Error("BYOK requires this request's credential");
  if (!credential && !resources.server.available) throw new Error("The server model credential is unavailable");
  return credential ? nativeByokModels(credential) : undefined;
}

/** The host calls this under Session exclusion; only the admission digest contains model identity. */
export async function admitConfiguredModel(resources: NativeSessionResources, credentials: OperationCredentials, session: Session, lane: AgentLane, context: Context,
  request: ModelAdmissionRequest, options: AdmissionOptions, credential?: ByokCredentialParts): Promise<ModelAdmissionOutcome> {
  const byok = await requestModels(resources, request, credential);
  const model = byok?.model ?? resources.server.model;
  const configured = { ...request, modelIdentity: { provider: model.provider, modelId: model.id, baseUrl: model.baseUrl } };
  const prepared = await prepareModelAdmission(resources.db, configured, { ...options, anonymousDailyBudget: resources.budget });
  if (byok && prepared.operationId && canBind(prepared))
    await bindCredential(resources, credentials, lane, context, prepared.operationId, byok);
  if (!("id" in prepared)) return prepared;
  if (!prepared.operationId) throw new Error("The model admission has no native operation ID");
  await persistOperationInput(session, prepared.operationId, configured, context);
  await lane.setModel({ provider: model.provider, modelId: model.id }, context);
  return acceptReservedModel(resources.db, lane, context, configured, prepared);
}

/** Read-only replay uses the same configured digest without rebinding a provider or credential. */
export async function configuredReplayRequest(resources: NativeSessionResources, request: ModelAdmissionRequest, credential?: ByokCredentialParts) {
  const byok = await requestModels(resources, request, credential);
  const model = byok?.model ?? resources.server.model;
  return { ...request, modelIdentity: { provider: model.provider, modelId: model.id, baseUrl: model.baseUrl } };
}
