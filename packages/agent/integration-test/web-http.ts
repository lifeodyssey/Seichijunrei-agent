import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { TestContext } from "node:test";

/** Only the external search HTML is scripted; the production tool parses the HTTP response. */
export async function webHttp(context: TestContext) {
  const page = { title: "Original web finding" };
  const requests: { url: string; redirect: RequestRedirect; method: string }[] = [];
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<div class="result"><a class="result__a" href="https://bgm.tv/subject/1556">${page.title}</a><div class="result__snippet">Accepted title &amp; attribution.</div></div>`);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => { if (error) reject(error); else resolve(); })));
  const address = server.address(); assert.ok(address && typeof address === "object");
  const webFetch: typeof globalThis.fetch = (input, init) => {
    const request = new Request(input, init); const url = new URL(request.url);
    assert.equal(url.origin, "https://html.duckduckgo.com");
    requests.push({ url: request.url, redirect: request.redirect, method: request.method });
    return fetch(new Request(new URL(`${url.pathname}${url.search}`, `http://127.0.0.1:${String(address.port)}`), request));
  };
  return { page, requests, webFetch };
}
