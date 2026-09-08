// Composition root for Cloudflare Pulumi IaC.
// Resource modules register side effects on import; this file re-exports the
// stable public surface topology tests and stack consumers rely on.
// Layout: see src/README.md

import "./src/buckets.ts"
import "./src/web-routes.ts"
import "./src/hardening.ts"
import "./src/staging.ts"
import "./src/staging-access.ts"

import { config } from "./src/config.ts"
import {
  NEON_AUTH_JWKS_VAR,
  QA_NEON_USER_EMAIL_VAR,
  QA_NEON_USER_PASSWORD_VAR,
  issuerFromJwksUrl,
  jwksUrlFromAuthBaseUrl,
} from "./src/neon-auth.ts"

export { validateLegacyRedirectZones } from "./src/web-routes.ts"
export { validateAccessAllowedEmails } from "./src/staging-access.ts"
export { oneTimePinIdentityProviderId } from "./src/access-identity-provider.ts"
export {
  catalogBucketName,
  tilesBucketName,
  snapshotBucketName,
  stagingAccessClientId,
  stagingAccessClientSecret,
} from "./src/outputs.ts"

// ── Neon Auth staging declarations (AUTH-2 #950) ─────────────────────────────
// The staging edge verifies JWTs against the branch JWKS. IaC derives that URL
// from the branch's Better Auth base URL, while the runtime config test pins
// the checked value to the Web SDK endpoint. QA login creds are declared for
// the E2E suite + local-login script (Path A of docs/ops/auth-migration-neon.md
// §4). All config-gated: stacks without
// `neonAuthBaseUrl` / `qaNeonUser*` set are unchanged. The password is a
// secret — it must reach state as ciphertext, never plaintext.
// `neonAuthJwksUrl` is also declared as a Cloudflare Secrets Store secret in
// infra/database-access (the store owner) so the deploy chain can source the edge
// binding from state.
const neonAuthBaseUrl = config.get("neonAuthBaseUrl");
export const neonAuthJwksUrl =
  neonAuthBaseUrl === undefined ? undefined : jwksUrlFromAuthBaseUrl(neonAuthBaseUrl);
export const neonAuthIssuer =
  neonAuthJwksUrl === undefined ? undefined : issuerFromJwksUrl(neonAuthJwksUrl);
export const qaNeonUserEmail = config.get("qaNeonUserEmail");
export const qaNeonUserPassword = config.getSecret("qaNeonUserPassword");
export const neonAuthVarNames = {
  jwks: NEON_AUTH_JWKS_VAR,
  qaEmail: QA_NEON_USER_EMAIL_VAR,
  qaPassword: QA_NEON_USER_PASSWORD_VAR,
} as const;
