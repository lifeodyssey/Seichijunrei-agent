// Hybrid Cloudflare Worker that serves exported frontend assets and proxies
// runtime API requests to the Python container on port 8080.
import { Container } from "@cloudflare/containers";

const CONTAINER_ENV_KEYS = [
  "ANITABI_API_URL",
  "APP_ENV",
  "CORS_ALLOWED_ORIGIN",
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

// ── Auth helpers ─────────────────────────────────────────────────────

async function validateJwt(token, env) {
  try {
    const resp = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: env.SUPABASE_ANON_KEY,
      },
    });
    if (!resp.ok) return { ok: false };
    const user = await resp.json();
    return { ok: true, userId: user.id };
  } catch {
    return { ok: false };
  }
}

async function validateApiKey(rawKey, env) {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(rawKey);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const keyHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    const resp = await fetch(
      `${env.SUPABASE_URL}/rest/v1/api_keys?key_hash=eq.${keyHash}&revoked=eq.false&select=user_id`,
      {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );
    if (!resp.ok) return { ok: false };
    const rows = await resp.json();
    if (!rows.length) return { ok: false };

    // Update last_used_at best-effort
    fetch(
      `${env.SUPABASE_URL}/rest/v1/api_keys?key_hash=eq.${keyHash}`,
      {
        method: "PATCH",
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ last_used_at: new Date().toISOString() }),
      }
    );

    return { ok: true, userId: rows[0].user_id };
  } catch {
    return { ok: false };
  }
}

async function authenticate(request, env) {
  const authHeader = request.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return { ok: false };
  const token = authHeader.slice(7).trim();
  if (!token) return { ok: false };

  if (token.startsWith("sk_")) {
    const result = await validateApiKey(token, env);
    return result.ok
      ? { ok: true, userId: result.userId, userType: "agent" }
      : { ok: false };
  }

  const result = await validateJwt(token, env);
  return result.ok
    ? { ok: true, userId: result.userId, userType: "human" }
    : { ok: false };
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
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    // Static assets and health check pass through without auth.
    if (pathname === "/healthz") {
      const id = env.CONTAINER.idFromName("default");
      return env.CONTAINER.get(id).fetch(request);
    }

    if (pathname.startsWith("/img/")) {
      const imagePath = pathname.slice(5);
      if (!imagePath || imagePath.includes("..")) {
        return new Response("Bad request", { status: 400 });
      }

      const upstreamUrl = `https://image.anitabi.cn/${imagePath}`;
      const cacheKey = new Request(request.url, request);
      const cache = caches.default;
      let cached = await cache.match(cacheKey);
      if (cached) return cached;

      const upstream = await fetch(upstreamUrl, {
        headers: { "User-Agent": "Seichijunrei/1.0" },
      });

      if (!upstream.ok) {
        return new Response(upstream.body, {
          status: upstream.status,
          headers: { "Content-Type": upstream.headers.get("Content-Type") || "image/jpeg" },
        });
      }

      const headers = new Headers(upstream.headers);
      headers.set("Cache-Control", "public, max-age=604800, s-maxage=2592000");
      headers.set("Access-Control-Allow-Origin", "*");
      headers.delete("Set-Cookie");

      const response = new Response(upstream.body, { status: 200, headers });
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    }

    if (!pathname.startsWith("/v1/")) {
      return env.ASSETS.fetch(request);
    }

    // All /v1/* routes require authentication.
    const auth = await authenticate(request, env);
    if (!auth.ok) {
      return new Response(
        JSON.stringify({ error: { code: "unauthorized", message: "Valid credentials required." } }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    // Forward with identity headers so the container can trust them.
    const authedRequest = new Request(request, {
      headers: new Headers({
        ...Object.fromEntries(request.headers),
        "X-User-Id": auth.userId,
        "X-User-Type": auth.userType,
      }),
    });

    // All instances share the same container ("default") so the in-memory
    // session backend remains consistent across requests.
    const id = env.CONTAINER.idFromName("default");
    return env.CONTAINER.get(id).fetch(authedRequest);
  },
};
