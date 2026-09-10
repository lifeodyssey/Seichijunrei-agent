# infra — AGENTS.md

Pulumi TypeScript IaC for Cloudflare R2 and optional Worker route topology. Worker code and deploy
bindings remain in Wrangler; route ownership stays here. Root guide: `../AGENTS.md`.

## Commands (from `infra/`)

- `pnpm test` — the topology tests (`topology-*.test.ts`), then `test:program-load`: the
  credential-free Pulumi program load (`../scripts/local-gates/infra-check.sh`), which is the only
  check that catches a loader/compiler incompatibility `tsc --noEmit` cannot see. It needs the
  Pulumi CLI and touches no cloud credentials.
- `pnpm run typecheck` — `tsc --noEmit` for the program and for `tsconfig.test.json`. This package
  has **no** `lint` script yet: type-aware oxlint rejects its `moduleResolution: node10` outright
  (TypeScript 7 removed that value), so linting it is a change to the Pulumi program's module
  resolution and its own outcome, not a script alias.
- `pulumi preview --stack lifeodyssey/staging` — preview against `Pulumi.staging.yaml`.
- `pulumi preview --stack lifeodyssey/prod` — preview against `Pulumi.prod.yaml`.
- `pulumi up --stack lifeodyssey/staging` — apply the staging stack; normal delivery runs this through CI.
- Production apply is CI-only: the deploy workflow runs Pulumi `up` with stack `prod` after the
  GitHub `production` environment approval.

## Conventions

- State and `secure:` encryption live in **Pulumi Cloud**, org `lifeodyssey`, declared by `backend.url`
  in each `Pulumi.yaml` (#1077). CI logs in with `pulumi/auth-actions` (GitHub OIDC → short-lived
  personal Pulumi access token scoped to `user:lifeodyssey`, exported as `PULUMI_ACCESS_TOKEN` for
  that job only); no long-lived Pulumi access token, backend URL, R2 state key pair, or config
  passphrase is stored in GitHub secrets.
  Applies are org-qualified: `pulumi up --stack lifeodyssey/<stack>`.
  The one exception is `scripts/local-gates/infra-check.sh`, whose credential-free program-load
  preflight sets `PULUMI_BACKEND_URL` to a throwaway `file://` backend and never reads real state —
  that env var takes precedence over `backend.url` (measured on the pinned Pulumi 3.255.0).
- `Pulumi.yaml` defines the project; `Pulumi.staging.yaml` and `Pulumi.prod.yaml` hold per-environment
  config. Secrets remain encrypted `secure:` values or CI/ESC inputs.
- `index.ts` derives names from `pulumi.getStack()`; prod uses stable names, other stacks suffix
  resource names.
- Routes belong to Pulumi; Worker implementation and service bindings belong to Wrangler.

## Key files + entrypoints

- `index.ts` — R2 media bucket, flag-gated web Custom Domains, edge routes, www redirect, the staging per-host WAF config override, exported catalog DB secret, and the Neon Auth staging declarations (JWKS/issuer derivation + QA login, AUTH-2 #950).
- `database-access/` — database roles, per-service DSNs, and Auth access material. Its Pulumi project name remains the stable persisted state identity until an explicit cross-project stack migration. Its Neon provider SDK is generated at release time and gitignored, so the complete program needs that generated dependency; `topology-prod-database-access.test.ts` pins the prod stack's role/secret derivations from the source. `runtime-secrets.ts` uses the installed native Cloudflare SDK and has isolated resource-graph tests; five shared runtime ESC config keys are required. `anonymousAccessEnabled` additionally requires the environment's Turnstile secret and durable identity seed, and must match the Worker flag. Staging's first Store cutover permits the owner-authorized identity reset documented in the secrets runbook.
- `src/staging-access.ts` — the whole staging front door (D3 #1369): one
  `ZeroTrustAccessApplication` over `stagingDomain` plus the two `animichi-*-staging`
  workers.dev origins, a `non_identity` (Service Auth) policy carrying the
  `animichi-staging-ci` service token, an `allow` policy built from the
  `stagingAccessAllowedEmails` stack config, the account's `onetimepin`
  identity provider that policy's humans sign in through (an **account-level** object this stack
  reads and never creates — `src/access-identity-provider.ts` selects it from the
  `getZeroTrustAccessIdentityProviders` data source and refuses ≠1; declaring it is a `409
  Conflict`, since Cloudflare allows one per account and another Access app already made it),
  and the two stack outputs the ESC environment
  imports through its `pulumi-stacks` provider: `stagingAccessClientId` → `CF_ACCESS_CLIENT_ID`
  and `stagingAccessClientSecret` → `CF_ACCESS_CLIENT_SECRET` under `environmentVariables` of
  `lifeodyssey/animichi/staging`. **The output names are the wiring contract** — ESC resolves
  them by name and imports an unresolvable one as empty, so a rename locks every automated
  caller out with no red anywhere; `topology-staging-access.test.ts` pins both, along with the
  hostname list and both policies. Staging only: production has a real login, and
  `topology-prod.test.ts` pins that no application, policy or token is built there.
- `src/neon-auth.ts` — pure Neon Auth derivation (JWKS URL ↔ issuer base URL, env-var names); pinned by `topology-neon-auth.test.ts`.
- `Pulumi.yaml` — project metadata and base encrypted config.
- `Pulumi.staging.yaml` · `Pulumi.prod.yaml` — live environment stacks.
- `../.github/workflows/cd.yml` — the whole delivery path: one build, one artifact, five ordered
  staging stages, production approval. Both Pulumi programs are applied from the sealed
  `release/foundation/` tree it carries, never from a fresh checkout.
- `../docs/ops/deployment.md` — environment and approval runbook.

## Pitfalls

- Never run a production apply outside CD; its single `production` environment approval is the
  mandatory human gate after the complete affected cohort reaches staging.
- `webRoutesEnabled` defaults false. **Flipping it publishes the site**, and does so atomically on
  purpose: the Custom Domain and the narrowed `/v1/*`, `/img/*`, `/healthz` edge routes appear
  together. Splitting them is the bug this gate exists to prevent — a hostname that resolves before
  its routes are narrowed answers a browser navigation with the edge Worker's JSON 404. Every stack
  gets the same Custom-Domain-plus-three-routes shape (staging included: `apps/web` calls `/v1/*`
  relative to its own origin, so a staging hostname pointed wholly at the web Worker has no chat).
  Prod additionally gets the www placeholder and redirect, and so requires `wwwDomain` on top of
  `cloudflareZoneId` + `webDomain`; other stacks require `cloudflareZoneId` + `stagingDomain`.
  Do not flip it as routine cleanup.
- **Access enforces the moment its policy exists, and it is eventually consistent.** The
  application in `src/staging-access.ts` starts refusing unauthenticated traffic a minute or
  two after the apply, not at the apply — a smoke probe on the landing run can pass without
  ever having been checked. Adding a hostname to it is therefore a lockout risk for whatever
  automation reaches that hostname without the two `CF-Access-*` headers, and removing one is
  a silent exposure nothing goes red for. `stagingAccessAllowedEmails` is refused empty for
  the same reason: an `allow` policy with no include rules is a door no human can open.
- No Hyperdrive: catalog reaches Neon over `@neondatabase/serverless` HTTP.
- **The pre-apply `pulumi stack export` rollback backup is retired** (#485 → #1077). Pulumi Cloud's
  own update history is the rollback record, so CD no longer copies a state snapshot into the R2
  bucket before every `pulumi up`. Nothing writes to that `rollback-backups/` prefix any more, so
  #521 (no lifecycle rule on it) stops growing; the already-accumulated objects are the owner's to
  delete when the R2 state bucket itself is retired. **Marking secrets still matters**: any sensitive
  value in `index.ts` or the stack configs MUST go through `config.requireSecret()` / `getSecret()`
  (see the `pulumi-best-practices` skill §5), never a plain `config.require()` or a literal. An
  unmarked value is stored in the clear in Pulumi Cloud state and comes out in the clear in any
  `pulumi stack export` an operator takes. Never run an export with `--show-secrets`, and never put
  a state export in a GitHub Actions artifact — this repo is public, and a public repo's artifacts
  are downloadable by any signed-in GitHub account.
