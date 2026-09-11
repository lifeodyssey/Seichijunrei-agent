import { createServer } from "vite";
import type { TestContext } from "node:test";

/** Official Vite proxy connects the real web app and real native Worker on one browser origin. */
export async function nativeWebServer(context: TestContext, workerUrl: URL) {
  const config = { schemaVersion: 1, api: {}, turnstileSiteKey: "1x00000000000000000000AA", showcaseMode: "false", featureFlags: {} };
  Reflect.set(globalThis, "__ANIMICHI_RUNTIME_CONFIG__", config);
  context.after(() => { Reflect.deleteProperty(globalThis, "__ANIMICHI_RUNTIME_CONFIG__"); });
  const server = await createServer({ root: new URL("../", import.meta.url).pathname, server: { host: "127.0.0.1", port: 0, proxy: { "/v1": { target: workerUrl.href, changeOrigin: true } } } });
  context.after(() => server.close());
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error("Vite did not publish a local URL");
  return url;
}
