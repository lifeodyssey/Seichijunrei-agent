import type { MiddlewareHandler } from "hono";
import type { Env, MigratorDeps } from "./create-app";
import { createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
import {
  createGitHubOidcVerifier,
  type GitHubOidcVerifier,
  type GitHubOidcVerificationResult,
} from "@animichi/contract/oidc-github";
import { GITHUB_OIDC_JWKS_URL, policyFor } from "./policy";

const REMOTE_JWKS = createRemoteJWKSet(new URL(GITHUB_OIDC_JWKS_URL));

interface Authentication {
  verifier?: GitHubOidcVerifier;
  jwks?: JWTVerifyGetKey;
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  const scheme = /^bearer[ \t]+/i.exec(header);
  if (scheme === null) return null;
  const token = header.slice(scheme[0].length).trim();
  return token.length > 0 ? token : null;
}

/** Shared signed-token verification; each route retains its own refusal response. */
export async function authenticateRequest(
  request: Request,
  selector: string | undefined,
  deps: Authentication,
): Promise<GitHubOidcVerificationResult | null> {
  const token = bearerToken(request);
  if (token === null) return null;
  const verifier = deps.verifier ?? createGitHubOidcVerifier(policyFor(selector), deps.jwks ?? REMOTE_JWKS);
  return verifier.verify(token);
}

export function mainController(deps: MigratorDeps): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    c.header("Cache-Control", "no-store");
    const verified = await authenticateRequest(c.req.raw, c.env.MIGRATOR_OIDC_POLICY, deps);
    if (verified === null) return c.json({ error: "unauthorized" }, 401);
    if (!verified.ok || verified.claims.ref !== "refs/heads/main") return c.json({ error: "forbidden" }, 403);
    await next();
  };
}
