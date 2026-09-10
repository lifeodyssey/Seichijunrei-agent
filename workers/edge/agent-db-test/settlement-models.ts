import { createModels, createProvider, type Model } from "@earendil-works/pi-ai";
import { stream, streamSimple } from "@earendil-works/pi-ai/api/openai-completions";

const first: Model<"openai-completions"> = { id: "first", name: "First price", provider: "settlement-price", api: "openai-completions",
  baseUrl: "https://price.test/v1", reasoning: false, input: ["text"], contextWindow: 128_000, maxTokens: 4096,
  cost: { input: 10_000, output: 10_000, cacheRead: 0, cacheWrite: 0 } };
const second: Model<"openai-completions"> = { ...first, id: "second", name: "Second price", cost: { input: 0.01, output: 0.01, cacheRead: 0, cacheWrite: 0 } };

function pricedResponse(model: string, input: number, output: number) {
  const chunk = { id: model, object: "chat.completion.chunk", created: 0, model,
    choices: [{ index: 0, delta: { content: "done" }, finish_reason: "stop" }], usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output } };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
}

/** Pi's published provider computes each call's price; only the HTTP response is scripted. */
export function settlementModels() {
  const responses = [pricedResponse("first", 10, 20), pricedResponse("second", 100, 200)];
  const fetch: typeof globalThis.fetch = () => {
    const response = responses.shift();
    return response ? Promise.resolve(response) : Promise.reject(new Error("Unexpected priced model call"));
  };
  const models = createModels();
  models.setProvider(createProvider<"openai-completions">({ id: first.provider, models: [first, second],
    auth: { apiKey: { name: "Fixture key", resolve: () => Promise.resolve({ auth: { apiKey: "fixture-only" } }) } }, api: {
    stream: (model, context, options) => stream({ ...model, api: "openai-completions" }, context, { ...options, apiKey: "fixture-only", fetch }),
    streamSimple: (model, context, options) => streamSimple({ ...model, api: "openai-completions" }, context, { ...options, apiKey: "fixture-only", fetch }),
  } }));
  return { models, model: first };
}
