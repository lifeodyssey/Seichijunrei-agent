# Select complete immutable releases independently of main push order

Status: accepted for #1564. This amends the delivery-selection and queue decisions in
[ADR 0006](0006-platform-over-handwritten-ci.md). Its preference for native platform capabilities,
separate OIDC audiences, CI-only deployment, and Secrets Store runtime bindings remains unchanged.
Activation requires the platform evidence listed in the [deployment runbook](../ops/deployment.md).

## Decision

A push to main builds a complete release snapshot and publishes its immutable GitHub artifact ID.
It does not deploy. The trusted main-only `cd.yml` controller accepts an explicit existing
`artifact_id`, deploys it to staging, records what staging tested, and promotes the same artifact
after its production environment approval. There is one deployment controller and no tag path.

For main history A → B → C, selecting B includes A's catalog, schema and foundation prerequisites.
A may be skipped and C may remain undeployed. The release source SHA must belong to the controller's
accepted main history, but it need not equal the controller SHA or the latest remote head.

GitHub owns artifact storage, immutable IDs, cross-run download and digest verification. The
controller uses the official REST API and pinned upload/download actions. Repository policy adds
admission checks for the source repository, successful main-push producer attempt, exact builder
workflow, full-snapshot format, expiry, ID and digest. Missing artifacts are never rebuilt or
substituted during deployment.

Each snapshot carries web server/assets, catalog/users/edge/migrator bundles and deploy configs,
real pushed agent/migrator registry digests, the complete Atlas chain including any baseline
marker, the unchanged Prisma contract and complete native graph, and tracked Pulumi sources plus
their generated pinned Neon SDK. Native Wrangler parses
and seals deploy configuration; consumers compare it with the selected accepted source. The trusted
controller and its scripts always come from the dispatch commit, never from the artifact.

Each environment has one job-level lock covering preflight, foundation, migration, all Workers,
smoke and receipt. `cd-staging` and `cd-production` are independent. The actual production job owns
`environment: production`, so approval protects credential acquisition and execution without
holding the staging lock. `cancel-in-progress: false` preserves active deployments; GitHub's native
single-pending behavior may replace a pending selection. Commit-order queues and `queue: max` retire.

Before any Pulumi apply or Worker upload, the controller verifies remote registry existence,
digest and linux/amd64 image configuration with native Docker inspection, then calls the already
installed migrator's authenticated read-only ledger preflight. Production additionally refuses a
staging-only baseline before all mutations. Missing/empty/partial/divergent/newer ledger state is
not evidence of compatibility. The apply endpoint carries the same bounded metadata into the existing
fixed Durable Object lock. It checks the bundle prefix, repeats the native ledger read and shared
compatibility comparison before ledger creation or DDL, then applies through the selected head.
A prior read is not a reservation of database state.

After the initial Atlas-only preflight, publish the selected migration executor before Prisma
preview: the previous executor cannot see a future artifact's native graph. Wait for both its Atlas
and Prisma bundle identities, then use the public native read-only plan API. Application foundation,
DDL and service publication remain after that preview, inside the same environment lock. Apply
revalidates both owners under the fixed lock and uses Prisma's public control client; it never
translates its graph into another runner. Atlas keeps its existing objects and immutable history,
while Prisma owns only the new agent contract. Receipts bind the native installed marker to the
selected contract, not the configured graph head or the latest source checkout.

The immutable staging receipt binds artifact ID/digest, release and controller SHAs, actual
script-scoped Worker deployment/version IDs, container application/namespace/image identities,
applied schema and successful smoke. It proves that B was tested. Later C staging need not prevent
B's promotion, provided fresh production checks accept B. Worker version IDs differ across scripts
and environments; the promoted identity is the original release artifact and image digests.

## Prerequisites and limits

- #1575 must install the read-only preflight endpoint through the existing authorized CD path before
  #1564 activates. A missing endpoint fails closed; the guarded controller cannot first deploy it
  and then claim that preflight preceded all mutations.
- The new `release-build` environment and `release-build.yml@refs/heads/main` identity need explicit
  native GitHub/Pulumi issuer configuration and a registry credential. Do not borrow the staging
  deployment subject or widen a workflow/ref wildcard. Deploy jobs keep the exact `cd.yml` identity.
- #1565 owns provider-enforced build/foundation/application/smoke authority separation. An ESC export
  filter does not prevent its Pulumi token from opening sibling environments and is not a security
  boundary. The candidate's existing personal Pulumi token model does not prove that separation.
- Production baseline cutover, hostname/routing readiness and runtime-secret provisioning are
  explicit platform prerequisites. A local build, YAML audit or Wrangler dry run proves none of them.
- Platform probes must establish real cross-run artifact verification, registry access, concurrent
  staging/production behavior and approval enforcement before the story is considered complete.
