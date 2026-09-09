import type { Env } from "./create-app";

export async function resolveDsn(env: Env): Promise<string | undefined> {
  const url = env.MIGRATOR_DATABASE_URL;
  if (url == null) return undefined;
  return typeof url === "string" ? url : await url.get();
}
