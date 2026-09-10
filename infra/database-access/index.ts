import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";
import * as neon from "@pulumi/neon";
import * as random from "@pulumi/random";
export { edgeRuntimeSecretNames } from "./runtime-secrets.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Database access provisioning — ADR 0003 / #912 PR1.
// Pulumi.yaml retains the original project name as a persisted state identity;
// changing it requires an explicit cross-project stack migration.
//
// Manages, for one Neon branch (the branch is stack config: staging =
// Pulumi.staging.yaml, production = Pulumi.prod.yaml):
//   - Neon service roles. The pre-existing roles were created by the SQL
//     migrations (migrations/neon/20260826000001_roles.sql) as
//     NOLOGIN roles WITHOUT a control-plane-stored password:
//       * reveal_password returns an empty password for them (200, len 0),
//       * reset_password refuses them (422 ROLE_PASSWORD_NOT_AVAILABLE), and
//       * the bridged provider has no password input (password is computed).
//     So the password can only be provisioned by CREATING the role via the
//     Neon API (auto-generated + stored password, LOGIN) — i.e. this stack
//     creates the roles, it does not import them. One-time bootstrap:
//       1. DELETE the SQL-created role via the Neon API (per branch; the
//          roles have no live consumers — the deploy chain still
//          falls back to the owner DSN until the Secrets Store binding lands).
//       2. `pulumi up` — the role is created here with a Neon-generated
//          password that the provider can always read back (reveal_password).
//       3. Re-run the idempotent migration chain against the branch
//          (migrations/neon/20260826000001_roles.sql is a no-op once the role
//          exists; the per-context migrations restore the role's GRANTs, which
//          die with the role and now sit beside the tables they apply to).
//     Rollback: re-run the migrations to recreate the NOLOGIN roles and point
//     the deploy chain back at the owner DSN; the store/secrets are additive.
//   - A Cloudflare Secrets Store holding one secret per component DSN,
//     composed from the role password + branch endpoint host. PR2/PR3 declare
//     the wrangler.toml Secrets Store bindings (staging base names; prod
//     "_PROD"-suffixed names, see secretNameSuffix below).
//
//     Store creation note: the account already has Cloudflare's built-in
//     `default_secrets_store`, and the account plan refuses a second store
//     (`maximum_stores_exceeded`, HTTP 400 code 1003). This stack therefore
//     IMPORTS the account's default store (`secretsStoreId` config) instead
//     of creating one; the store name is only the logical resource name here.
//     Staging and production SHARE this single store, which is exactly why the
//     production DSN secrets carry a "_PROD" suffix.
//
//     RETENTION-1 (#940): the staging retention role and its store secret are
//     retired from this stack — deleting the role resource removes the staging
//     retention grants with it (grants die with the role), while the immutable
//     role/grant migrations keep the SAFE-1-pinned production surface.
//
// The DSN host/db follow the environment's NEON_DATABASE_URL: branch endpoint,
// database `neondb`, sslmode=require.
// ─────────────────────────────────────────────────────────────────────────────

const config = new pulumi.Config();

const projectId = config.require("neonProjectId");
const branchId = config.require("neonBranchId");
const accountId = config.require("cloudflareAccountId");
const databaseName = config.get("databaseName") ?? "neondb";
const secretsStoreName = config.get("secretsStoreName") ?? "animichi-secrets";

const secretsStoreId = config.require("secretsStoreId");

// #1048 production runtime DSNs: staging and production share the account's
// single default Secrets Store, so the store-secret NAMES must not collide
// across stacks. Production appends a "_PROD" suffix to each role DSN secret;
// staging keeps the base names (#912) so the adopted staging resources and
// their wrangler.toml bindings are untouched. Derived from the Pulumi stack
// name ("prod"), so the staging stack is behaviorally byte-identical.
const secretNameSuffix = pulumi.getStack() === "prod" ? "_PROD" : "";

const neonProvider = new neon.Provider("neon", {
  apiKey: config.requireSecret("neonApiKey"),
});

// Role -> secret mapping (#832): these names are bound directly from the
// Cloudflare Secrets Store (plus the _PROD suffix for prod).
//
// agent_svc DSN (#912 follow-up): the agent is a CONTAINER, not a Worker, so
// it has no Secrets Store binding of its own — the edge Worker binds
// AGENT_SVC_DATABASE_URL and `buildContainerEnvVars` (workers/edge/src/
// container/container-env.ts) forwards it into the container env.
const roleDefs: { name: string; secretName?: string; comment: string }[] = [
  {
    name: "catalog_svc",
    secretName: "CATALOG_DATABASE_URL",
    comment: "catalog Worker DATABASE_URL (runtime role DSN)",
  },
  {
    name: "users_svc",
    secretName: "USERS_DATABASE_URL",
    comment: "users Worker DATABASE_URL (runtime role DSN)",
  },
  {
    name: "agent_svc",
    secretName: "AGENT_SVC_DATABASE_URL",
    comment:
      "agent container data-plane role DSN (edge Worker binding, forwarded to the container via CONTAINER_ENV_KEYS)",
  },
  // #1050 — dedicated migrator role (Migration Executor, spec §"Database identity").
  //
  // Provisions the `migrator` LOGIN role via the same Neon-API path as the
  // runtime roles and writes its DSN to the store once as MIGRATOR_DATABASE_URL.
  // The secret is deliberately NEVER bound by any runtime Worker or container
  // env allowlist — it exists for the migration-executor container only, and
  // that isolation is machine-asserted (migrator-role-isolation contract test).
  //
  // Ceiling (spec): the migration chain needs CREATE EXTENSION / CREATE ROLE /
  // blanket GRANTs, so on Neon this role is necessarily neon_superuser-grade;
  // numeric narrowing is limited. Minimization is behavioral, three rules:
  //  (1) single-purpose — it is never a runtime DSN for any service;
  //  (2) non-resident — injected only into the migration container for the
  //      seconds it runs, present in no Worker's standing environment;
  //  (3) independently rotatable — a Neon role password unentangled from every
  //      runtime credential (rotation path per ADR 0003).
  //
  // Roles are PROJECT-scoped in Neon, so creating `migrator` here also makes it
  // available on every branch (production `main` compute included); GRANTs and
  // ownership are branch-scoped and shipped as Atlas migrations
  // (migrations/neon/*). The DSN here composes against THIS branch's
  // read-write endpoint, so each stack writes its own: staging publishes
  // MIGRATOR_DATABASE_URL against the staging branch and the prod stack
  // (Pulumi.prod.yaml, #1048) publishes MIGRATOR_DATABASE_URL_PROD against the
  // main-branch endpoint — the two names workers/migrator/wrangler.toml binds
  // per environment (#1365). Both come from this one roleDefs entry; there is
  // no production-only path that could drift from the staging one.
  {
    name: "migrator",
    secretName: "MIGRATOR_DATABASE_URL",
    comment:
      "dedicated migration-executor role DSN (#1050): single-purpose, non-resident, independently rotatable; bound to NO runtime worker or container (isolation asserted by contract test)",
  },
];

const roles = roleDefs.map(
  (def) =>
    new neon.Role(
      def.name,
      { projectId, branchId, name: def.name },
      { provider: neonProvider },
    ),
);

const host = neon
  .getBranchEndpointsOutput({ projectId, branchId }, { provider: neonProvider })
  .apply((result) => {
    const endpoints = result.endpoints ?? [];
    const rw = endpoints.find((e) => e.type === "read_write");
    if (rw === undefined) {
      throw new Error(`no read-write endpoint found for branch ${branchId}`);
    }
    return rw.host;
  });

const store = cloudflare.SecretsStore.get(
  secretsStoreName,
  `${accountId}/${secretsStoreId}`,
);

const dsnFor = (role: neon.Role, name: string) =>
  pulumi.interpolate`postgresql://${name}:${role.password.apply(encodeURIComponent)}@${host}:5432/${databaseName}?sslmode=require`;

const dsnSecrets = roleDefs.flatMap((def, i) => {
  if (def.secretName === undefined) return [];
  return [
    {
      def,
      name: `${def.secretName}${secretNameSuffix}`,
      dsn: dsnFor(roles[i], def.name),
    },
  ];
});

dsnSecrets.forEach(({ def, name, dsn }) => {
  new cloudflare.SecretsStoreSecret(name, {
    accountId,
    storeId: secretsStoreId,
    name,
    value: dsn,
    scopes: ["workers"],
    comment: def.comment,
  });
});

// ── Catalog admin token (system-health-audit 2026-08-26 §2.4/§3, #1217) ────
// CATALOG_ADMIN_TOKEN guards POST /catalog/admin/* (full-ingest, canary) but
// had never been provisioned in any environment, so the admin surface was a
// functional dead end. Generated here — never hand-typed, logged, or
// committed — and stored in the same shared Secrets Store as the DSN secrets
// above, under the same staging/prod "_PROD" naming split (secretNameSuffix).
const catalogAdminToken = new random.RandomPassword("catalog-admin-token", {
  length: 48,
  special: false,
});

new cloudflare.SecretsStoreSecret(`catalog-admin-token${secretNameSuffix}`, {
  accountId,
  storeId: secretsStoreId,
  name: `CATALOG_ADMIN_TOKEN${secretNameSuffix}`,
  value: catalogAdminToken.result,
  scopes: ["workers"],
  comment: "catalog admin command bearer token (system-health-audit 2026-08-26 §2.4, #1217)",
});

// ── Neon Auth declarations (AUTH-2 #950) ────────────────────────────────────
// The edge verifies JWTs against the branch's JWKS URL (its ONLY identity
// source since the hard cut). Declaring it here lets the deploy chain source
// the edge binding from the Secrets Store instead of the checked-in literal in
// workers/edge/wrangler.toml; it is DERIVED from the branch's Better Auth base
// URL so the operator sets one value, never two.
//
// The QA login creds provision the password user the E2E suite + local-login
// script use (Path A of docs/ops/auth-migration-neon.md §4). The password is a
// secret; the email is not.
//
// All three are config-gated (optional getters): stacks without the keys apply
// unchanged — nothing here is created until an operator sets them, so this is
// declaration, not provisioning.
//   pulumi config set neonAuthBaseUrl https://<branch>.neonauth.c-2..../neondb/auth
//   pulumi config set qaNeonUserEmail qa-bot@animichi.test
//   pulumi config set --secret qaNeonUserPassword <password>
const authBaseUrl = config.get("neonAuthBaseUrl");
if (authBaseUrl !== undefined) {
  new cloudflare.SecretsStoreSecret("neon-auth-jwks-url", {
    accountId,
    storeId: secretsStoreId,
    name: "NEON_AUTH_JWKS_URL",
    value: `${authBaseUrl.replace(/[/]+$/, "")}/.well-known/jwks.json`,
    scopes: ["workers"],
    comment: "edge Neon Auth JWKS (derived from the branch auth base URL, AUTH-2 #950)",
  });
}

const qaNeonUserEmail = config.get("qaNeonUserEmail");
if (qaNeonUserEmail !== undefined) {
  new cloudflare.SecretsStoreSecret("qa-neon-user-email", {
    accountId,
    storeId: secretsStoreId,
    name: "QA_NEON_USER_EMAIL",
    value: qaNeonUserEmail,
    scopes: ["workers"],
    comment: "Neon Auth QA login email (Path A, AUTH-2 #950)",
  });
}

const qaNeonUserPassword = config.getSecret("qaNeonUserPassword");
if (qaNeonUserPassword !== undefined) {
  new cloudflare.SecretsStoreSecret("qa-neon-user-password", {
    accountId,
    storeId: secretsStoreId,
    name: "QA_NEON_USER_PASSWORD",
    value: qaNeonUserPassword,
    scopes: ["workers"],
    comment: "Neon Auth QA login password (secret; Path A, AUTH-2 #950)",
  });
}

// Exported for the wrangler.toml bindings (PR2/PR3) and operators.
export const secretsStoreNameOut = secretsStoreName;
export const secretNames = roleDefs.flatMap((def) =>
  def.secretName === undefined ? [] : [`${def.secretName}${secretNameSuffix}`],
);
export const roleNames = roleDefs.map((def) => def.name);
export const authSecretNames = [
  "NEON_AUTH_JWKS_URL",
  "QA_NEON_USER_EMAIL",
  "QA_NEON_USER_PASSWORD",
] as const;
export const catalogAdminTokenSecretName = `CATALOG_ADMIN_TOKEN${secretNameSuffix}`;
