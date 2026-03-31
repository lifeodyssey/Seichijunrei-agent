// Hybrid Cloudflare Worker that serves exported frontend assets and proxies
// runtime API requests to the Python container on port 8080.
import { Container } from "@cloudflare/containers";

const CONTAINER_ENV_KEYS = [
  "ANITABI_API_URL",
  "APP_ENV",
  "CACHE_TTL_SECONDS",
  "DEBUG",
  "DEFAULT_AGENT_MODEL",
  "ENABLE_MCP_TOOLS",
  "FIRESTORE_SESSION_COLLECTION",
  "GEMINI_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_MAPS_API_KEY",
  "LOGFIRE_TOKEN",
  "LOG_LEVEL",
  "MAX_RETRIES",
  "MCP_ANITABI_URL",
  "MCP_BANGUMI_URL",
  "MCP_TRANSPORT",
  "OBSERVABILITY_ENABLED",
  "OBSERVABILITY_EXPORTER_TYPE",
  "OBSERVABILITY_OTLP_ENDPOINT",
  "OBSERVABILITY_SERVICE_NAME",
  "OBSERVABILITY_SERVICE_VERSION",
  "RATE_LIMIT_CALLS",
  "RATE_LIMIT_PERIOD_SECONDS",
  "REDIS_SESSION_DB",
  "REDIS_SESSION_HOST",
  "REDIS_SESSION_PASSWORD",
  "REDIS_SESSION_PORT",
  "REDIS_SESSION_PREFIX",
  "SERVICE_HOST",
  "SERVICE_PORT",
  "SESSION_STORE_BACKEND",
  "SESSION_TTL_SECONDS",
  "SUPABASE_ANON_KEY",
  "SUPABASE_DB_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_URL",
  "TIMEOUT_SECONDS",
  "USE_CACHE",
];

function buildContainerEnvVars(env) {
  const envVars = {
    APP_ENV: "production",
    SERVICE_HOST: "0.0.0.0",
    SERVICE_PORT: "8080",
  };

  for (const key of CONTAINER_ENV_KEYS) {
    const value = env[key];
    if (typeof value === "string" && value.length > 0) {
      envVars[key] = value;
    }
  }

  envVars.APP_ENV = "production";
  envVars.SERVICE_HOST = "0.0.0.0";
  envVars.SERVICE_PORT = "8080";

  return envVars;
}

function shouldProxyToContainer(pathname) {
  return pathname === "/healthz" || pathname.startsWith("/v1/");
}

export class RuntimeContainer extends Container {
  defaultPort = 8080;
  requiredPorts = [8080];
  enableInternet = true;

  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = buildContainerEnvVars(env);
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (!shouldProxyToContainer(pathname)) {
      return env.ASSETS.fetch(request);
    }

    // All instances share the same container ("default") so the in-memory
    // session backend remains consistent across requests.
    const id = env.CONTAINER.idFromName("default");
    return env.CONTAINER.get(id).fetch(request);
  },
};
