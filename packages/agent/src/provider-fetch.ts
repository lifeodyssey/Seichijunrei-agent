const HOSTS: Readonly<Record<string, string>> = {
  openai: "api.openai.com", anthropic: "api.anthropic.com", google: "generativelanguage.googleapis.com", xiaomi: "api.xiaomimimo.com",
};

export function validateProviderEndpoint(provider: string, url: URL): void {
  if (url.protocol !== "https:" || url.hostname !== HOSTS[provider] || url.port || url.username || url.password)
    throw new Error("Provider endpoint is not permitted");
}

/** Redirects are refused before credentials can leave the exact provider origin. Error bodies stay private. */
export function providerFetch(provider: string, fetch: typeof globalThis.fetch): typeof globalThis.fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    validateProviderEndpoint(provider, new URL(request.url));
    request.signal.throwIfAborted();
    const response = await fetch(new Request(request, { redirect: "manual" }));
    if (response.ok) return response;
    await response.body?.cancel();
    return new Response("Provider request failed", { status: response.status >= 400 ? response.status : 502 });
  };
}
