import { catalogContract } from "@animichi/contract/contract";
import { createORPCClient, ORPCError } from "@orpc/client";
import { ClientRetryPlugin, type ClientRetryPluginContext } from "@orpc/client/plugins";
import type { ContractRouterClient } from "@orpc/contract";
import { RequestValidationPlugin, ResponseValidationPlugin } from "@orpc/contract/plugins";
import { OpenAPILink } from "@orpc/openapi-client/fetch";

/** Read-only catalog calls retry transient failures inside the caller's bounded deadline. */
export function createCatalogClient(fetch: (request: Request) => Promise<Response>) {
  const link = new OpenAPILink<ClientRetryPluginContext>(catalogContract, {
    url: "https://catalog.internal", fetch: (request) => fetchWithinDeadline(fetch, request),
    plugins: [new RequestValidationPlugin(catalogContract), new ResponseValidationPlugin(catalogContract),
      new ClientRetryPlugin({ default: { retry: 2, shouldRetry: ({ error }) => transient(error) } })],
    interceptors: [(options) => options.next({ ...options, signal: catalogDeadline(options.signal) })],
  });
  return createORPCClient<ContractRouterClient<typeof catalogContract, ClientRetryPluginContext>>(link);
}

function transient(error: unknown): boolean {
  return error instanceof DOMException && error.name === "TimeoutError"
    || error instanceof ORPCError && (error.status >= 500 || error.status === 408 || error.status === 429);
}

function catalogDeadline(signal?: AbortSignal): AbortSignal {
  return AbortSignal.any([AbortSignal.timeout(80_000), ...(signal ? [signal] : [])]);
}

async function fetchWithinDeadline(fetch: (request: Request) => Promise<Response>, request: Request) {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(25_000)]);
  signal.throwIfAborted();
  const response = await fetch(new Request(request, { signal, redirect: "manual" }));
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new Error("Catalog redirects are not permitted");
  }
  return response;
}
