# workers/edge — AGENTS.md

TypeScript Cloudflare Worker (Hono + `@cloudflare/containers`): the **request gateway**. Owns
identity/rate-limit/turnstile enforcement, routing + forwarding to Catalog / Users / the agent
container, and the image/tile proxies. **No pilgrimage domain model** — it is Gateway tier, never
`src/domain/`. The HTML surface lives in `apps/web`.
Root guide: `../../AGENTS.md`. Sibling worker guides: `../catalog/AGENTS.md`, `../users/AGENTS.md`.

## Commands (from `workers/edge/`)

- pnpm. `pnpm test` — the edge's whole deterministic gate set, in one command (#1358): the
  node:test suite under `test/*.test.ts` (doubles in `test/doubles/`), then `test:chat-answer-part`
  (`packages/contract/test/chat-answer-part.test.ts` — it guards THIS package's `data-response`
  projection, so it runs in this lane and not only when the contract changes), then
  `test:bundle-smoke`, then `test:ratelimit-namespace`
  (`scripts/check-edge-ratelimit-namespace.sh` and its behavioral test, which moved here from
  `.github/scripts/`). From the repo root the same command is `pnpm run test:worker` (forwards to
  `pnpm --filter edge-worker test`; `make test-worker` likewise).
- `pnpm run test:bundle-smoke` — the bundler gates (`bundle-smoke/`), the only ones that read the
  ARTIFACT rather than the source: `pi-kernel.test.ts` (W0-S3 #1246) bundles
  `bundle-smoke/pi-kernel.worker.ts` with wrangler's own esbuild settings and **executes** the
  artifact in workerd, and `entry-bundle.test.ts` (#1285) builds `src/entry.ts` the same way and
  fails if zod reached it — the property `src/` keeps by construction and no source-level gate can
  see. Both bundle through `bundle-smoke/wrangler-bundle.ts`, the one copy of those settings.
  Runnable on its own; `pnpm test` runs it as its third segment.
- `pnpm run test:catalog-api` — opt-in staging lane (`api-test/*.test.ts`, W1-4 #1253) for the
  catalog tools, against a deploy carrying `AGENT_TURN_ROUTE = "edge"`, plus the BYOK probe's
  invalid-key evidence (W2-3 #1289; the valid-key case is the owner's manual step, because it
  needs a key that must not be written down). Two halves: the five
  catalog procedures still have no public door (spec Appendix D), and one real `POST /v1/chat`
  through the deployed edge calls `resolve_anime` and is readable back by conversation id — the
  (api) evidence #1253 had to defer until the route switch. Fails closed without
  `CATALOG_API_ORIGIN` + `AGENT_TURN_BEARER`; never in CI. Why the turn is signed in and the
  anonymous journey is manual: `api-test/README.md` and `docs/ops/w1-staging-journey.md`.
- `pnpm run test:spike-db` — opt-in lane (`db-test/*.test.ts`) that runs the W0-S4 spike's run
  store against a **real** PostgreSQL named by `SPIKE_TEST_DATABASE_URL`. Never in CI and never
  against staging; it fails closed without a disposable database. Recipe: `spike/pi/README.md`.
- `pnpm run test:agent-db` — the agent-tier database arm (#1251, #1252): boots a disposable
  PostgreSQL container itself, applies the committed `migrations/neon` chain, and runs the
  intake's own statements against it. Its own directory and lane, not the spike's: this one
  brings its own database (Docker + the offline `animichi-test-postgres` image,
  `agent-db-test/README.md`) and outlives W0. It is the only lane that can answer for a partial
  unique index or a transaction rollback. Not yet in `gate_edge` — run it by hand before pushing
  agent-tier changes; see that README for what wiring it into CI would cost.
- `pnpm run typecheck` — `tsc --noEmit` (TypeScript 7.0.2 via workspace hoist).
- `pnpm run lint:oxlint` — type-aware oxlint, warnings denied.
- Deploy is CI-only: `wrangler deploy -c workers/edge/wrangler.toml` from the repo root
  (hook `block-local-deploy`). Never deploy locally.

## Layout (2026-08-06-edge-gateway-structure-design.md)

- `src/entry.ts` — Worker default export + `RuntimeContainer`; `src/app.ts` — Hono assembly only.
- `src/db/` — Drizzle mapping of the agent turn tables the edge owns from W1 (`messages`,
  `runs`, `run_steps`, plus `sessions` for the retrieval's ownership check); query-only
  metadata, never a DDL authority (`migrations/neon` owns the schema).
- `src/agent/` — the agent turn tier (W1, spec `docs/specs/2026-09-01-agent-ts-rewrite-spec.md`):
  `intake/` (one `POST /v1/chat` becomes one transaction: message + `running` run + quota
  reservation, then `setAlarm(now)` on the session), `session/` (the `AgentSession` DO and the
  turn it runs inside its own `alarm()` handler, #1252: the run state machine, the
  `(run_id, step_index)` step replay, the transcript rebuild, the pi/mimo assembly, the SD-9
  frames and the in-memory subscriber set), `sweeper/` (the singleton `RunSweeper` DO, the
  at-least-once backstop), `settlement/` (how a turn ENDS: the run's terminal row, its
  `daily_usage` rollup and its quota refund, called by the session on its own transaction
  alongside the assistant message — plus, from #1292, a SECOND day row for what the turn spent
  OUTSIDE its pi run. `supplemental-usage.ts` owns that: the tool-less `translate_anime_title`
  call D18 forces onto the server key during a BYOK turn emits no `message_end` the loop can
  see, so the `Toolbox` reports it through `spent()`, and it is charged to `platform` — the one
  `daily_usage_scope_check` value `runs_payer_check` does NOT admit, because no run is ever
  opened on the platform's behalf), `retrieval/` (how a turn is READ BACK:
  `ConversationRetrieval`, the owned and ordered transcript page, the latest run's status
  and — from #1381 — the params the tools of the runs THAT PAGE SHOWS executed with, behind
  `GET /v1/conversations/:id/messages`: spec §二's disconnect semantics, and the only
  agent-tier read that never runs inside the Durable Object), `tools/` (the four catalog tools
  the model calls, #1253).
  Ports live with the use case, Neon adapters beside them, and
  no module here imports `cloudflare:workers` so the node:test suite can load every one of them.
  How a turn ANSWERS is `src/agent/session/turn-answer.ts` (#1283): the model ends its turn by calling one
  `respond` tool — the pi-native mechanism, argued and measured in that file's header — and the
  server derives the intent from its own stored results, projecting the `data-response` part in
  `src/agent/session/turn-answer-part.ts`. That part is both the SD-9 frame the stream pushes and the
  `messages.response_data` the settlement commits, so `retrieval/` publishes the same intent a
  connected client already saw.
  The `Toolbox` port in `src/agent/session/turn-toolbox.ts` is the whole contract with
  `src/agent/tools/`, and `session-turn.ts::turnToolbox` is what fulfils it: `agentToolbox` over
  the private `CATALOG` binding, one `TurnCatalogSession`, and the turn's own `TurnModel`. An
  environment without that binding still runs — the turn just has no tools, web ones included,
  because `translate_anime_title` needs the same catalog. It is handed the whole `TurnModel` and
  not a bare registry because `translationModel` reads `callerKeyed` off it: Python's D18
  (`public_api.py`'s `_server_title_translator`) forces `translate_anime_title` onto the SERVER
  key during a BYOK turn — the caller pays for the turn they asked for, the platform for a
  translation they did not — and #1289 wires it. That hop is guarded too, against its own
  one-host allowlist (`SERVER_MODEL_EGRESS_POLICY`), so a caller-keyed turn has no unguarded way
  out at all; a caller-keyed turn with no server key answers `untranslated` rather than reaching
  for the caller's credential. What routes traffic here is the
  `AGENT_TURN_ROUTE` flag (#1256, extended by #1289): `"edge"` serves `POST /v1/chat`,
  `GET /v1/conversations/{id}/messages` and `POST /v1/byok/probe` from this tier, anything else
  (including unset) forwards all three to the Python container as before. The probe moves with the
  turn on purpose — a credential the edge validated for a turn and the same credential validated
  by the container for a probe would be two verdicts on one key. staging = `edge`, production and `wrangler dev` =
  `container`; the rollback is that one word in `wrangler.toml`. The flag is read in exactly one
  place — `src/gateway/routing-policy.ts`'s `turnRoutePolicy`, consulted by `src/gateway/request.ts`;
  the identity ladder in front of it is `src/gateway/agent-tier-route.ts` and the tier behind it is
  `src/gateway/agent-turn.ts`. One deliberate difference between the two positions, argued in that
  ladder's header: under `edge` an ANONYMOUS visitor may read their own transcript back
  (`ANON_V1_PATHS` still does not list that route, so the container position is unchanged) — W1's
  exit criterion is an anonymous conversation a visitor comes back to, and the retrieval's ownership
  check is what makes it safe.
- `src/agent/session/turn-catalog-session.ts` — the `CatalogToolSession` one turn hands the tools:
  the opaque refs they mint and the rows behind them. Turn-scoped ON PURPOSE, and REBUILT ON A
  REPLAY since #1279: a settled step is answered from `run_steps.result` without calling `execute`,
  so every ref rides the step that minted it (`minted-refs.ts` — `StepResult.minted` carries the
  ref AND the payload, beside `details` rather than inside it, because `details` is what the model
  reads back and what the SD-9 `tool-output-available` frame publishes) and `TurnAttempt.drive`
  puts them all back, in `step_index` order, before the loop resumes. Two sequences continue with
  them: the mint sequence (so a new ref cannot collide with a replayed one) and `step_index`
  itself, which `resumedTranscript` reports and `StepSequence` starts at — a settled step whose
  call the rebuilt transcript already answers is never asked for again, so a retry's FIRST new
  call is the (n+1)-th of the run rather than a second claim on step 0. Since #1377 the ref
  itself NAMES its run (`{kind}:{row_count}:{sequence}@{run_id}`): the transcript replays every
  earlier turn's tool results, so their handles are in the model's context, and only this run's
  mints are put back — a foreign handle must land on `stale_ref` rather than collide with a live
  one. `SelectionRecord`
  (`src/agent/selection/`) is the same move made first for the one step no model asks for; both
  read their payloads back through `src/agent/tools/stored-payload.ts`.
- `src/agent/session/session-envelope.ts`, `turn-envelope.ts`, `durable-envelope-store.ts` — the
  session state that DOES outlive one turn (#1280): the pending clarification and the current
  anime, as one immutable `SessionEnvelope` (per SESSION; refs stay per RUN, which is what kept
  Python's `tool_state` a bag). It is stored in the Durable Object's own `ctx.storage` under the
  `envelope` key rather than in a Neon column — the DO is the single writer (spec §三) and
  `idFromName(sessionId)` makes that storage session-scoped, `retrieval/` never reads it, and a
  column would buy a migration for a fact only the alarm touches; the full trade-off and its price
  are argued in the adapter's header. `TurnEnvelope` owns the moments: `open()` seeds the turn's
  tools from the stored facts — which reach the MODEL as the `<agent_status>` bar
  `agent-status.ts` appends to the end of every model request (#1379, spec §九 9.3), not as a
  system-prompt block: the system prompt is a constant, byte-identical across a session's turns,
  and a per-turn prefix is 李博杰 ch.2 实验 2-3's 动态系统提示词. The bar is rendered inside pi's
  `transformContext`, so it is replaced on every request, never reaches `messages` in Neon, and
  always reflects what the tools have just written. Its values are the catalog's, the geocoder's
  and the user's words, and the model is told the server wrote the bar, so `status-value.ts` is
  the trust boundary: at RENDER time it removes from every value the characters the bar builds its
  own structure from (`<>`, `「」`, newlines) and bounds the length, which is what the ledgers'
  earlier `trustedText` write gate does NOT do and what the two envelope-held values (the resolved
  title, the clarification candidates) never pass through at all; `stage()` writes the whole envelope under the
  run's own key BEFORE the terminal row lands, driven by the `EnvelopeStagingStore` decorator around
  the `TurnStore`; and `close(state)` promotes that staging to the session's envelope once the run
  reaches its OWN terminal path. The order is the recovery: the terminal row is in Neon and the
  envelope is in DO storage, so no transaction spans them — staging first means a failed settlement
  replays the whole turn, and a failed promotion is finished by the alarm's retry. Two rules keep a
  stale staging from outliving a newer answer: `open()` first drains every OTHER queued run's
  staging (a run whose promotion failed stays queued while its row is terminal, so a second run can
  be admitted and must start from the recovered state), and only `succeeded`, `failed` and
  `already_settled` promote. `already_settled` is its own `TurnPhase` precisely so it is not
  confused with `declined`: the first is a retry of an ending this alarm owes, the second is a live
  owner mid-turn whose staging must not be published for it.
- `src/agent/session/trajectory-prefix.ts`, `prefix-turn.ts`, `prefix-seeding.ts`,
  `neon-seeded-session.ts`, `session-prefix.ts` + `src/gateway/staging-prefix-route.ts` — the
  eval's **frozen trajectory prefix** (E-1 #1380, spec §十 10.1; 李博杰《深入理解 AI Agent》
  ch.7 `initialization_actions`). A `seeded_pending` eval case measures a REPLY to a
  clarification the agent never got to ask, and on an HTTP tier the only way to put a turn in a
  session is to have taken it — so this writes one: the prior user message, the assistant
  tool-call message with its settled `run_steps` row, the answer, and the session envelope
  carrying the pending clarification under the id the reply names. It writes through the
  PRODUCT's own seams (`TurnRecords.openTurn`, `TurnStore`, `SessionEnvelopeStore`) and adds no
  second SQL path, and it runs INSIDE the session's Durable Object because the envelope lives in
  that instance's storage. **Two doors, neither sufficient alone**: `APP_ENV === "staging"` is
  the MOUNT (fail closed on every other value — the route does not exist on production, and the
  path is deliberately absent from `AGENT_PATHS` so no document publishes it and no rate table
  can name it), and the caller must present the Neon Auth bearer the product reads a session by,
  with `ConversationRetrieval`'s own `ownedBy` deciding the session is theirs. A session that has
  already taken a turn is refused (a prefix is a session's FIRST turn); a re-seeding of the same
  `case_id` writes nothing, because the case id IS the seeded message's `client_message_id` and
  `messages_session_client_message_id` decides. The prefix run is settled `succeeded` on purpose:
  left `running` it would make the measured turn a 409 on `runs_one_running_per_session`.
- `src/agent/memory/` — what a session REMEMBERS, as two bounded value objects
  inside `SessionEnvelope` (W2-4 #1290, spec §一). `FactLedger` carries the facts a
  turn's own settled steps witnessed — an append/supersede chain for the user's hard
  constraint (route pacing) and a turn-scoped replace-set of episode/scene references —
  and `RetainedEntityLedger` carries the literal strings rescued before the freeze
  shrank the tool return that held them. Both are ports of `apps/agent`'s
  fact and compaction-retention domain modules, bounds included: 8
  records per field, an 8 KiB encoded budget, 96 bytes per value, superseded records
  evicted first — and **oldest-wins** in the retained ledger, because the entities worth
  rescuing are the deepest ones. `turn-fact-recorder.ts` is the only writer of facts
  (`TurnAttempt.drive` calls it after the loop and before the ending, where Python's
  `_execution_result` did), `TurnCatalogSession` fulfils the `TurnMemory` port both
  writers hold, and `agent-status.ts` is the consumer — a ledger field with no
  status line is dead scaffolding. `stored-memory.ts` is the codec the Durable Object
  writes through, because a structured clone restores no class prototype; it re-applies
  both caps on the way in, which is Python's `enforce_bounds`-on-restore.
- **A tool return's short form is frozen at WRITE time** (#1378, spec §九 9.2).
  `src/agent/session/frozen-tool-return.ts` decides it once, as the step is persisted —
  a return over `TOOL_RETURN_MAX_CHARS` (200) gets `tool-return-summary.ts`'s
  deterministic line, stored as `run_steps.result.summary` beside the untouched raw
  `content` (§三's persistence granularity is unchanged; the key is additive, so no
  migration; the cap itself lives in `tool-return-summary.ts`, which both readers import).
  Two returns keep their ORDERED IDENTITIES verbatim rather than a count — an ambiguous
  `resolve_anime` its `candidate_ids`, and since #1389 `plan_route` its `itinerary_ref` and
  `ordered_point_ids` — because that is all an ordinal follow-up ("the second stop") can
  resolve against once the short form is the only record. The bound applies to everything
  BUT those ids: a route summary drops `total_minutes` before it truncates a stop list.
  `ItineraryOk.ordered_point_ids` is the one outcome field with no Python counterpart
  (`src/agent/tools/catalog-tool-outcomes.ts` argues it); `plan_route` deliberately does NOT
  join `ENTITY_ARGUMENT`, and `src/agent/memory/rescued-entity.ts` says why.
  `turn-transcript.ts` replays an EARLIER turn's result as that string and
  THIS run's own settled steps verbatim, so a retried alarm resumes on the bytes its
  first attempt saw and two alarms over the same session produce identical context.
  Nothing re-summarises on the read path — that absence is what makes the bytes stable
  across deploys. The literal entity a shrinking call carried is rescued in the same
  step (`src/agent/memory/rescued-entity.ts`), and a retry reads those entities back off
  the settled rows (`TurnAttempt.drive`) because the envelope carrying the ledger is
  promoted only at a terminal path — which is what the ledger's dedup is now for.
  `src/agent/session/context-compaction.ts` is what remains of the old
  hook: pi's `transformContext` still hangs there, but the per-request "newest 8" window
  is gone (it slid inside a single turn, changing the prefix on every request), leaving
  a batch pass that fires only above `CONTEXT_COMPACTION_TRIGGER_TOKENS = 102_400` and
  is not expected to fire at all — the measured 3-turn transcript is 870 tokens. That
  pass asks `frozenSummaryOf` too, so it can never re-summarise a summary: 防重复保护 is
  the short form's own shape (`isFrozenSummary`), not an added marker. pi's
  OWN compaction was measured against the provider double and rejected for four reasons
  recorded in that file's header.
- `src/agent/tools/` — `agentToolbox(parts)` returns the six `AgentTool`s the session registers
  on the pi agent, in Python's own registration order: `resolve_anime`, `search_bangumi`,
  `search_nearby`, `plan_route` (`catalogToolbox`, #1253), then `web_search` and
  `translate_anime_title` (#1287). Two ports carry everything turn-shaped: `CatalogClient` (production adapter
  `serviceBindingCatalog`, over the private `CATALOG` binding — never a URL, spec Appendix D) and
  `CatalogToolSession`, which the session's turn state implements. **The schema seam** (spec §二)
  lives at `tool-schema-bridge.ts`: contract zod is the source,
  `packages/contract/scripts/emit-tool-schemas.ts`
  is the repo's ONE zod→JSON-Schema conversion, and nothing here re-declares a constraint or loads
  zod. The same red line covers the whole Worker as of #1285: every contract module `src/` takes a
  VALUE from is import-free (`AGENT_PATHS` from `@animichi/contract/agent-paths`,
  `DEFAULT_IDENTITY_POLICY` from `@animichi/contract/identity-policy` — never `agent-contract` or
  `identity`, the zod modules that declare their schemas), and `bundle-smoke/entry-bundle.test.ts`
  measures it. Adding a tool parameter means editing `packages/contract/src/agent-tool-parameters.ts` and
  re-running `pnpm --filter @animichi/contract run emit:tool-schemas`. The `respond` tool
  (`src/agent/session/turn-answer.ts`) rides the same seam, and takes `ANSWER_TOOL_NAME` +
  `CHAT_RESPONSE_INTENTS` from the generated module rather than spelling either out here.
  **The web tools (#1287).** `web_search` is the agent's only untrusted INBOUND channel, so its
  whole design is the boundary: results leave `web-result-trust.ts` sanitised (control characters
  and any literal `untrusted_web_result` tag stripped, fields truncated) inside delimited blocks
  under a preamble that names them as data — byte-identical to Python's `web_trust.py`, because
  the system prompt's untrusted-output paragraph and the eval trajectories both refer to it. The
  tool never throws for its own failure: a refused egress, a rate limit and the 10s deadline all
  become Python's `Search failed for '…': …` sentence, since a throw is an error the model reacts
  to rather than a fact it reads. The backend is DuckDuckGo's HTML endpoint behind the
  `WebSearcher` port (`duckduckgo-web-searcher.ts`, parse in `duckduckgo-result-page.ts` against a
  committed real capture) — chosen over a keyed API because it is the index Python searched and it
  needs no secret, so the tool works on the existing deploy; swapping in a keyed adapter is one new
  file behind that port. `translate_anime_title` is the catalog's `title_cn` first (Chinese titles
  only), then a tool-less call on the TURN's own model, then the original text, with `source` and
  `confidence` assigned by us rather than claimed by the model.
  Two things pi does NOT do for us and this folder therefore does: the per-tool 85s deadline
  (Python got it from pydantic-ai's `Tool(timeout=…)`; `AgentTool` has no such field, so
  `toolExecutionBudget` holds it, injectable so tests need no real clock), and validating a catalog
  response (the contract's zod cannot load here, so the adapter guards the one field each tool
  branches on and degrades anything else to `upstream_unavailable`).
- `src/agent/egress/` — the egress guard (W0-S5, #1248): `EgressPolicy` +
  `ProviderAllowlist` (exact provider hosts, HTTPS/443, own-infra and address-range refusals),
  `GuardedFetch` (`redirect: "manual"` and re-validation of every redirect target) and
  `SecretScrub`. Pure and binding-free, so node:test loads it directly. `web-search-egress.ts`
  (#1287) is one caller inside `src/`: a SECOND `ProviderAllowlist` instance holding one
  host, so the search backend is unreachable from the BYOK policy and the model providers are
  unreachable from this one. Its header argues the two inputs that do not fit a keyless, non-BYOK
  destination (the family token and the key sentinel) and why neither can widen anything.
  `src/agent/byok/` (W2-3 #1289) is the other, and the one spec Appendix D names: the shipped
  BYOK path reuses the module the spike measured rather than a second copy of those red lines.
- `src/agent/byok/` — one caller's OWN provider key, for one turn (W2-3 #1289, spec §四 S5).
  `byok-headers.ts` reads the four `X-BYOK-*` headers into a `ByokCredential` (a port of
  `apps/agent`'s `parse_byok_credential`) and hands the base URL straight to `EgressPolicy`;
  `byok-family.ts` translates the caller's vocabulary (`openai-compatible|anthropic|gemini`) into
  the allowlist's (`openai|anthropic|google`) and picks the pi adapter — **gemini rides Google's
  OpenAI-compatible surface** because pi-ai's `google-generative-ai` adapter refuses an injected
  fetch (Appendix D), while `anthropic-messages` accepts one and keeps its native dialect
  (`test/byok-turn-model.test.ts` measures both with a real round trip against a scripted socket).
  `byok-turn-model.ts` is the per-turn sibling of `src/agent/session/turn-model.ts`: a throwaway registry
  carrying only that credential, a `GuardedFetch` on every provider request, and a `SecretScrub`
  seeded with the key. `byok-probe.ts` is the one bounded probe behind `POST /v1/byok/probe`.
  **The credential is in memory only** — it rides `TurnSubmission` to the intake, the arm request
  to `AgentSession`, and that incarnation's heap to the alarm; no column, no `ctx.storage`, no
  cache. A run whose incarnation was evicted between the arm and the alarm therefore reaches the
  alarm without it — and is REFUSED rather than driven on the server key: `runs.payer = 'byok'` is
  the durable trace, `LoadedTurn.callerKeyed` reads it, and `DurableTurn` settles such a run
  `provider_failed` (refund by `settleFailedTurn`'s own SQL, error closing frames so a connected
  client can resend). The same refusal covers a `RunSweeper` re-arm, which carries no credential at
  all. The request-path half of the red line — an unusable credential is a 400, never a server-key
  turn — is enforced at the gateway. One
  deliberate difference from the Python tier, argued in `byok-headers.ts`: the
  `openai-compatible` family reaches `api.openai.com` and nothing else, because S5's first red
  line is an exact-host allowlist.
- `src/identity/` — auth (JWT/anonymous) + turnstile gate; `src/gateway/` — forward +
  routing/catalog policy (pure functions) + responses; `src/protect/` — rate limit / cost breaker /
  DO guard; `src/proxy/` — image/tile/showcase proxies; `src/container/` — container env +
  egress denylist data.
- `src/gateway/agent-turn.ts` — the three routes the `AGENT_TURN_ROUTE` flag can move onto this
  Worker's own agent tier (#1256, #1289), and the ONLY place that composes `intake/` + `session/` +
  `retrieval/` + `byok/` for a live request. BYOK is login-gated on both routes that accept it,
  and the gate runs BEFORE the headers are parsed, exactly as `turn_admission.py` and
  the Python probe route order it. A BYOK turn is also committed on the `byok` PAYER rather than
  the member's — the third value of `RUN_PAYERS`, which nothing set before #1289 even though the
  settlement has always priced it at zero and banked it in its own `daily_usage` scope. Injected into the gateway seam as `GatewayDeps.agentTurns`
  so `node:test` drives the routing contract with no Neon pool and no Durable Object.
  `chat-envelope.ts` reads the AI SDK body (a port of Python's `chat_body.py`);
  `agent-turn-responses.ts` holds every non-turn answer, each labelled with the Python route it
  mirrors — the flag is a FALLBACK flag, so no shape on that wire may be new.
  Two things the switch owns beyond routing: the intake's transaction now OPENS the `sessions`
  row (Python's session store left with `apps/agent`) and refuses a conversation another identity
  owns, and it enforces `ANON_DAILY_MESSAGE_QUOTA` — the ceiling #1251 deliberately left unowned —
  by comparing the count its own reservation upsert returns, so the refusal rolls back the whole
  turn (`src/agent/intake/anonymous-message-allowance.ts`, `agent-db-test/turn-quota-ceiling.db.test.ts`).
- `test/*.test.ts` flat; test doubles live in `test/doubles/` and are imported by tests only —
  production code never imports from `test/`.
- `db-test/` — the opt-in real-PostgreSQL lane (W0-S4, #1247). Test-only, outside `pnpm test`,
  and deleted with the spike when W0 closes.
- `api-test/lane-origin.ts` — the ONE door onto a deployed origin. It resolves
  `CATALOG_API_ORIGIN`, requires HTTPS off the loopback, attaches the Cloudflare
  Access service token (`CF-Access-Client-Id` / `CF-Access-Client-Secret`, read from
  `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` through
  `@animichi/contract/access-service-token`), and forbids following a redirect —
  which D3 (#1369) made load-bearing rather than defensive, since a 302 to the
  identity provider is what an unauthenticated request gets. Both variables or
  neither: half a token is refused before the request is built, because Access
  answers a one-header request with a login page that reads as a broken app. The
  loopback is behind no Access application and is handed no credential.
  `packages/eval` reaches staging through this same module.
- `api-test/` — the W1-4 staging lane (#1253). Test-only: `main` in `wrangler.toml` is the only
  boundary the edge bundle has, and no lane directory is reachable from it.
- `agent-db-test/` — the agent-tier database arm (#1251), kept apart from `db-test/` precisely
  because that one leaves with the spike. Test-only: neither directory is reachable from the
  Worker's `main`, and `pg`/`testcontainers` are devDependencies.
- `bundle-smoke/` — the bundler gates (#1246, #1285). Test-only: its entrypoint is outside the
  Worker's `main`. `@earendil-works/pi-ai` and
  `pi-agent-core` are runtime `dependencies` as of #1252 — `src/agent/session/` runs the kernel,
  so a devDependency there would be a Worker that cannot bundle its own agent loop.
  Its entrypoint carries the esbuild `.lazy` chunk-init workaround reported in
  `docs/specs/2026-09-01-pi-ai-esbuild-lazy-chunk-report.md`; leave the eager
  `api/openai-completions` import alone.
- `spike/<name>/` — throwaway probe Workers with their own `wrangler.toml`, deployed by hand and
  deleted when their spike closes (`spike/pi/` = W0-S1 #1244 + W0-S2 #1245 + W0-S4 #1247 +
  W0-S5 #1248). `src/` never imports from `spike/`, and no spike is in a CD cohort; each carries
  its own README with the deploy and measurement steps.

## Runtime rules

- Edge verifies identity but does **not** re-authenticate Users: `/v1/users/*` gets
  `Authorization` stripped and verified identity forwarded as `X-User-Id`/`X-User-Type` (AUTH-2
  #950); `src/identity/auth.ts` resolves anonymous vs Neon-Auth JWT (the
  `sk_*` API-key path and the `agent` identity class are deleted, AUTH-1 #945), and
  `src/gateway/forward.ts` injects the identity headers.
- Policy stays in pure functions (`routing-policy.ts`, `catalog-policy.ts`) so it runs under
  node:test with no Cloudflare bindings; `app.ts` only wires them up. New public paths go in the
  policy tables, not the container class.
- `src/container/container-env.ts` owns the container env allowlist/required keys and the
  `DENIED_EGRESS_HOSTS` glob list — it is read verbatim by docs/security guards (see
  `docs/ops/secrets.md`, `docs/ops/cloudflare-hardening.md`); keep paths and key names in lockstep.
- The agent tier reads Neon directly through the `AGENT_SVC_DATABASE_URL` Secrets Store
  binding — the same binding the container already unwraps (`src/container/container-env.ts`,
  `docs/ops/secrets.md`), now with the Worker itself as a second consumer. Both deployed
  environments bind it as of W4-1 (#1314) — staging from the store secret `AGENT_SVC_DATABASE_URL`,
  production from `AGENT_SVC_DATABASE_URL_PROD` in the same shared store; `test/agent-database-binding.test.ts`
  pins that split, because binding a store secret that does not exist fails the deploy. It is the WebSocket driver
  (`drizzle-orm/neon-serverless`), not neon-http: the intake is an interactive multi-statement
  transaction and neon-http has no transactions.
- Durable Object classes stay plain classes with `fetch`/`alarm` (`EdgeGuard`, `RunSweeper`) —
  no `cloudflare:workers` RPC base class, so every source stays importable under node:test.
  A binding's `class_name` is resolved against `src/entry.ts`'s exports at deploy time;
  `test/agent-durable-objects.test.ts` reads the two files against each other so that failure
  cannot wait for a deploy.
- `wrangler.toml` is the single config surface (`main = "src/entry.ts"`, resolved config-relative);
  routes are declared in Pulumi, never here (#541).

## Tests

node:test (no vitest, no workers pool). Two files in the suite still read a workflow verbatim,
and they are the whole list: `auth-config.test.ts` (#1047 — no deploy surface may carry
`secrets.NEON_AUTH_JWKS_URL` / `secrets.CORS_ALLOWED_ORIGIN`) and `migration-boundary.test.ts`
(every environment reaches the database only through the migrator Worker). A change under
`.github/workflows/` must keep `pnpm run test:worker` green for those two. Everything else that
used to pin pipeline text was deleted or repointed at the file owning the contract (#1373) —
`release-toolchain.test.ts` reads `package.json` manifests, not workflows, and
`staging-baseline-reset.test.ts` now executes
`infra/database-access/production-baseline-guard.sh` instead of extracting it from `cd.yml`.
Do not add a new assertion about a job name, a step name, or an `if:` condition: pipeline shape
belongs to the contract tests in `.github/scripts`.
