import { selectedPoint } from "./seed-selection.ts";

/** Script only the outbound provider/catalog boundaries; the actual default host owns all execution. */
export function operationToolsNetwork(translate: boolean, nearby = false) {
  let mainRequests = 0;
  return { catalog: () => Response.json({ rows: [{ ...selectedPoint, city: "Tokyo" }], synced_at: "2026-09-10", partial: false }),
    model: async (request: Request) => {
      const body = await request.json() as { tools?: unknown[] };
      if (!body.tools?.length) return completion({ content: "Official translated title" }, "stop");
      mainRequests += 1;
      if (mainRequests > 1) return completion({ tool_calls: [call(0, "respond", { kind: "greeting", message: "Finished" })] });
      const calls = [call(0, "search_bangumi", { bangumi_id: "123" })];
      if (nearby) calls.push(call(1, "search_nearby", {}));
      if (translate) calls.push(call(1, "translate_anime_title", { title: "Original title", target_language: "en" }));
      return completion({ tool_calls: calls });
    } };
}
function call(index: number, name: string, args: object) {
  return { index, id: `native-${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}
function completion(delta: object, finish = "tool_calls") {
  const chunk = { id: "native", object: "chat.completion.chunk", created: 0, model: "gpt-4.1", choices: [{ index: 0, delta, finish_reason: finish }], usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 } };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
}
