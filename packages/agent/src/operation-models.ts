import { createModels, createProvider, InMemoryCredentialStore, type Model, type ProviderStreams, type ProviderAuth } from "@earendil-works/pi-ai";
import { stream, streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import { stream as anthropicStream, streamSimple as anthropicSimple } from "@earendil-works/pi-ai/api/anthropic-messages";
import { providerFetch, validateProviderEndpoint } from "./provider-fetch.ts";

const APIS: Readonly<Record<"openai-completions" | "anthropic-messages", ProviderStreams>> = {
  "openai-completions": { stream, streamSimple },
  "anthropic-messages": { stream: anthropicStream, streamSimple: anthropicSimple },
};

/** Each operation owns native ephemeral credentials and Models. Logout removes the key; no ambient lookup exists. */
export async function createOperationModels(model: Model<keyof typeof APIS>, key: string, fetch: typeof globalThis.fetch = globalThis.fetch) {
  if (!key.trim()) throw new Error("A non-empty operation credential is required");
  validateProviderEndpoint(model.provider, new URL(model.baseUrl));
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(model.provider, () => Promise.resolve({ type: "api_key", key }));
  const models = createModels({ credentials, authContext: { env: () => Promise.resolve(undefined), fileExists: () => Promise.resolve(false) } });
  const api = guardedProviderApi(APIS[model.api], providerFetch(model.provider, fetch));
  models.setProvider(createProvider({ id: model.provider, models: [model], auth: operationAuth(credentials, model.provider), api }));
  return models;
}

/** Public provider callbacks apply the same egress policy to normal, simple and SDK retry requests. */
function guardedProviderApi(api: ProviderStreams, fetch: typeof globalThis.fetch): ProviderStreams {
  return {
    stream: (model, context, options) => api.stream({ ...model, headers: undefined }, context, { ...options, headers: {}, fetch }),
    streamSimple: (model, context, options) => api.streamSimple({ ...model, headers: undefined }, context, { ...options, headers: {}, fetch }),
  };
}

/** The native store owns the key, including logout. Request-level auth overrides cannot replace it. */
function operationAuth(credentials: InMemoryCredentialStore, provider: string): ProviderAuth {
  return { apiKey: { name: "Operation credential", resolve: async ({ signal, credential: requested }) => {
    const credential = await credentials.read(provider, { signal });
    if (requested && requested.key !== (credential?.type === "api_key" ? credential.key : undefined)) throw new Error("Operation credential override is not permitted");
    return credential?.type === "api_key" && credential.key ? { auth: { apiKey: credential.key } } : undefined;
  } } };
}
