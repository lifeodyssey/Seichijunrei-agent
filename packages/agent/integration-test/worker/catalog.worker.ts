import { neonConfig } from "@neondatabase/serverless";
import type { Env } from "../../../../workers/catalog/src/index.ts";

export default {
  async fetch(request: Request, env: Env & { TEST_FETCH_ENDPOINT: string }, context: ExecutionContext) {
    neonConfig.fetchEndpoint = env.TEST_FETCH_ENDPOINT;
    const catalog = await import("../../../../workers/catalog/src/index.ts");
    return catalog.default.fetch(request, env, context);
  },
};
