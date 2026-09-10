import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { authorizeInvocation, type PilgrimageToolContext } from "./tool-context.ts";
import { webSearchResults, untrustedWebText } from "./web-search-results.ts";

const parameters = Type.Object({ query: Type.String({ pattern: "\\S", maxLength: 500 }) }, { additionalProperties: false });

/** Public search is read-only and keyless; safe replay still rechecks authorization and quota. */
export const webSearch: AgentHarnessTool<PilgrimageToolContext, typeof parameters> = {
  name: "web_search", label: "Search the web", replay: "safe", parameters,
  description: "Search for attributed facts and accepted title translations. Never derive pilgrimage points or routes from web prose.",
  async execute(_id, params, _update, tools, invocation, context) {
    await authorizeInvocation(tools, invocation, context);
    const signal = AbortSignal.any([AbortSignal.timeout(10_000), ...(context.abortSignal ? [context.abortSignal] : [])]);
    const details = webSearchResults(await searchPage(params.query, tools.webFetch ?? globalThis.fetch, signal));
    return { content: [{ type: "text", text: details.length ? untrustedWebText(details) : `No results found for: ${params.query}` }], details: { results: details } };
  },
};

async function searchPage(query: string, fetch: typeof globalThis.fetch, signal: AbortSignal) {
  signal.throwIfAborted();
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);
  const response = await fetch(new Request(url, { signal, redirect: "manual", headers: { "User-Agent": "animichi-agent/1.0 (+https://animichi.com)", Accept: "text/html" } }));
  if (response.status !== 200) return rejectSearchResponse(response);
  return response.text();
}

async function rejectSearchResponse(response: Response): Promise<never> {
  await response.body?.cancel();
  throw new Error("Web search is temporarily unavailable");
}
