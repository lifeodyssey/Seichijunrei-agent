import type { Model } from '@earendil-works/pi-ai';

/** Deliberately nonzero fixture prices; the transport never makes a network request. */
export const model: Model<'openai-completions'> = {
  id: 'fixture', name: 'Fixture', api: 'openai-completions', provider: 'openai', baseUrl: 'https://api.openai.com/v1',
  reasoning: false, input: ['text'], cost: { input: 25_000, output: 250_000, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000, maxTokens: 100,
};

export function completion(content: string) {
  const chunk = { id: 'fixture', object: 'chat.completion.chunk', created: 0, model: 'fixture',
    choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
}
