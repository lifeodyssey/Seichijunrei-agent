import { resolve } from "node:path";
import { builtinModules } from "node:module";
import { build } from "esbuild";
import { Miniflare, Log, LogLevel, Response as WorkerResponse, type Request as WorkerRequest } from "miniflare";
import { issuedToken } from "./migrate.worker.helpers";
import { metadata } from "./preflight-fixtures";

let bundle: Promise<string> | undefined;

async function workerBundle(): Promise<string> {
  const built = await build({ bundle: true, write: false, format: "esm", platform: "browser",
    conditions: ["workerd", "worker"], external: ["cloudflare:workers", "node:*", ...builtinModules],
    banner: { js: 'import { createRequire as createSelectedTestRequire } from "node:module"; const require = createSelectedTestRequire("/bundle/selected-worker.js");' },
    stdin: { contents: 'export { MigratorApplyLock } from "./apply-lock"; import { createMigratorApp } from "./create-app"; export default createMigratorApp();', resolveDir: resolve("src") },
    loader: { ".sql": "text", ".sum": "text" }, plugins: [{ name: "fixture-chain", setup(builder) {
      builder.onResolve({ filter: /\/bundled-chain$/ }, () => ({ path: resolve("test/fixtures/selected-chain.ts") }));
    } }],
  });
  return built.outputFiles[0]?.text ?? "";
}

export async function selectedWorker(transport: (request: WorkerRequest) => Promise<WorkerResponse>, claims: Record<string, unknown> = {}, environment = "staging") {
  const { token, jwk } = await issuedToken(claims);
  bundle ??= workerBundle();
  const runtime = new Miniflare({ modules: [{ type: "ESModule", path: "/bundle/selected-worker.js", contents: await bundle }],
    modulesRoot: "/bundle", compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"], durableObjects: { MIGRATOR_APPLY_LOCK: "MigratorApplyLock" },
    bindings: { MIGRATOR_DATABASE_URL: "postgresql://fixture:fixture@ep-fixture.neon.tech/neondb", MIGRATOR_OIDC_POLICY: environment },
    outboundService: (request: WorkerRequest) => new URL(request.url).hostname === "token.actions.githubusercontent.com"
      ? Promise.resolve(WorkerResponse.json({ keys: [jwk] })) : transport(request),
    log: new Log(LogLevel.ERROR), cf: false,
  });
  return { runtime, request: (path = "/migrate", body: unknown = metadata) => runtime.dispatchFetch(`https://migrator.test${path}`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body),
  }) };
}
