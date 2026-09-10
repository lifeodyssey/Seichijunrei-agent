import { SecretScrub } from "../egress/secret-scrub.ts";
import { createModels, InMemoryCredentialStore, type Model } from "@earendil-works/pi-ai";
import { xiaomiProvider } from "@earendil-works/pi-ai/providers/xiaomi";
import { createOperationModels } from "@animichi/agent/models";
import { BYOK_DIALECTS, type ByokApi } from "../byok/byok-family.ts";
import type { ByokCredentialParts } from "../byok/byok-credential.ts";

/** Published model metadata owns pricing and dialect; credentials never consult ambient environment. */
export async function nativeHostModels(key: string | undefined, fetch: typeof globalThis.fetch = globalThis.fetch) {
  const provider = xiaomiProvider();
  const model = provider.getModels().find((candidate) => candidate.id === "mimo-v2.5");
  if (!model) throw new Error("The published Xiaomi model is unavailable");
  const models = key?.trim() ? await createOperationModels(model, key, fetch)
    : createModels({ credentials: new InMemoryCredentialStore(), authContext: { env: () => Promise.resolve(undefined), fileExists: () => Promise.resolve(false) } });
  if (!key?.trim()) models.setProvider(provider);
  return { models, model, scrub: new SecretScrub(key ? [key] : []), available: Boolean(key?.trim()) };
}

/** The request credential is a transient RPC input, never part of a native operation or business row. */
export async function nativeByokModels(credential: ByokCredentialParts, fetch: typeof globalThis.fetch = globalThis.fetch) {
  const dialect = BYOK_DIALECTS[credential.family];
  if (credential.provider !== dialect.provider) throw new Error("BYOK provider does not match its dialect");
  const model: Model<ByokApi> = { id: credential.modelId, name: credential.modelId, provider: credential.provider,
    api: dialect.api, baseUrl: credential.baseUrl, reasoning: false, input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: dialect.contextWindow, maxTokens: dialect.maxTokens };
  return { model, scrub: new SecretScrub([credential.secret]), models: await createOperationModels(model, credential.secret, fetch) };
}

export type NativeModelResources = Awaited<ReturnType<typeof nativeHostModels>>;
