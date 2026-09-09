import { Miniflare, createFetchMock } from "miniflare";
import type { JWK } from "jose";
import { nativeModules } from "./prisma-bundle";
import { postgresHttp } from "./prisma-postgres";
import { GITHUB_OIDC_JWKS_URL } from "../../src/policy";

export async function startPrismaWorker(directory: string, dsn: string, jwk: JWK) {
  const mock = createFetchMock();
  mock.disableNetConnect();
  const jwksUrl = new URL(GITHUB_OIDC_JWKS_URL);
  mock.get(jwksUrl.origin).intercept({ path: jwksUrl.pathname }).reply(200, { keys: [jwk] }).persist();
  mock.get(/https:\/\//).intercept({ path: "/sql", method: "POST" }).reply(200, async (options) => {
    const headers = new Headers(options.headers as Record<string, string>);
    const body = await new Response(options.body as BodyInit).text();
    const response = await postgresHttp(dsn, headers, body);
    return response.text();
  }).persist();
  const worker = new Miniflare({ modules: await nativeModules(directory), modulesRoot: directory,
    compatibilityDate: "2026-06-01", compatibilityFlags: ["nodejs_compat"], port: 0, inspectorPort: 0,
    bindings: { ENVIRONMENT: "staging", MIGRATOR_DATABASE_URL: dsn }, fetchMock: mock,
    durableObjects: { MIGRATOR_APPLY_LOCK: { className: "MigratorApplyLock", useSQLite: true } },
  });
  const close = async () => { await worker.dispose(); await mock.close(); };
  try {
    await worker.ready;
    return { worker, close };
  } catch (error) {
    await close();
    throw error;
  }
}
