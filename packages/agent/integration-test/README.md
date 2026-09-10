# Native tools with the production Catalog Worker

Run `pnpm --filter @animichi/agent test:integration` from the workspace root with Node 24,
Docker and the repository test-postgres image available. The gate checks the Node fixture
and the test Worker against their respective compiler contexts, then runs six serial cases.
Wrangler is the existing root dependency; the Worker reads the production catalog's
compatibility date and flags. No deployed account, paid model or live Neon branch is needed.

The path is the shared `createPilgrimageHarness` with all seven tools and the official Pi
0.85.1 faux provider, a native `MemorySessionRepo`, the actual typed oRPC client, actual
`wrangler dev` HTTP, unchanged Catalog handlers and Drizzle neon-http, and disposable
PostgreSQL from `@animichi/test-postgres`. The test redirects only the catalog hostname and
sets the public `neonConfig.fetchEndpoint` before loading the production Worker.

The published community image `TimoWilhelm/local-neon-http-proxy` packages upstream Neon
Proxy `release-proxy-8853` plus its shipped Caddy configuration. Its immutable multi-platform
index is `sha256:cd2ae14edf2feafbc3330492de5c80506f77274c3bd013154cdef697bdeb768a`.
The ARM64 manifest is `sha256:ecde021912e1aab596400fa9a467b597061671f1da6c0b3d61f057f7c953917a`;
the AMD64 manifest is `sha256:5730d368cd26f29fc77309fc7ea8e31d1b3bdc6648afc445136e900700384918`.
This is existing community packaging of the native proxy, not the cloud-backed Neon Local
product. The fixture waits for both Caddy and the native proxy listener; it implements no SQL
HTTP protocol, ORM shim or replacement tool runtime.

The first case resolves an anime, reads both published points, plans the native search ref
from a shared origin and searches nearby. The second verifies transactional rollback through
another real tool call, publishes changed rows and coordinates, then checks refreshed resolve,
search and nearby results while the prior committed native result remains unchanged.
Expected identifiers, names, coordinates and route order are literal seeded facts.

The translation cases read accepted Chinese titles from the same real Catalog database,
publish a changed title, and retain the earlier committed native result. A storage failure
after actual Catalog execution leaves a native interrupted result on reopen, without a
second translation invocation. This exercises the production `replay: "never"` policy.

The web cases resolve a real Catalog title before searching. Only the external DuckDuckGo
hostname is redirected to a local HTTP server with deterministic HTML. The unchanged tool
performs its request, parses attributed results, and commits native details. After a storage
failure, public SDK reopen/drive executes its `replay: "safe"` invocation again with the
same invocation ID and current authorization. Revoked authorization prevents the repeated
HTTP effect. Both tools run through the shared production factory with all seven tools.

These cases cover all six domain tools' execution, with real Catalog/Postgres for Catalog
facts and controlled HTTP for external web content. They do not establish search-provider
availability, model translation quality, live platform deployment or the complete #1556
acceptance criteria. The host integration suite owns transactional admission and quota;
the callbacks here observe invocation identity and authorization, not production charges.
The storage fault uses the existing native crash fixture at the public Session mutation
boundary; neither tool execution nor the SDK's recovery implementation is replaced.
