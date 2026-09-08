# W2 parity checklist — what the TS tier owes the Python agent, item by item

Spec `docs/specs/2026-09-01-agent-ts-rewrite-spec.md` §五 gives W2 one exit
criterion and it is a human one: **功能对等清单逐项勾（手动验证）**. There is no
automated eval before W3 (§二, owner decision), so this document IS the exit.

Card #1304, umbrella #1257, epic #1243.

Placement: `docs/ops/`, per `docs/DOCS_POLICY.md` rule 6 (operational docs live
under `docs/ops/`) — the same shelf as `docs/ops/w1-staging-journey.md`, which
this checklist ticks itself against. Nothing here changes behaviour.

The rows come from the merged W1/W2 PRs — #1277 #1278 #1281 #1282 #1284 #1286
and #1291 #1293 #1295 #1296 #1298 — plus the code they landed and the decision
issues they opened. A cell that cannot be sourced from one of those says so,
rather than guessing.

## How to read a row

- **Python behaviour** — paths are relative to `apps/agent/src/animichi/`, with a
  line number, because that tier is what "parity" is measured against and it is
  about to be deleted (§五 W4).
- **TS behaviour** — paths are relative to `workers/edge/src/`.
- **automated proof** — full repo paths. `workers/edge/test/*` runs in
  `pnpm run test:worker`; `workers/edge/agent-db-test/*` in
  `pnpm --filter edge-worker run test:agent-db`; `workers/edge/api-test/*` in
  `pnpm --filter edge-worker run test:catalog-api` against a real deploy;
  `packages/contract/test/*` in `pnpm --filter @animichi/contract test`.
  A cell reading `—` means no automated proof exists, and the divergence column
  then has to say why — `workers/edge/test/w2-parity-checklist-contract.test.ts`
  fails if it does not.
- **manual staging step** — a section of `docs/ops/w1-staging-journey.md`. `—`
  means the row is not observable from the browser and the automated proof is
  the whole evidence.
- **☐ ticked (owner)** — the owner flips this to ☑ during the manual pass and
  signs off on #1257.

## 1 · Tools

| item | Python behaviour (file:line) | TS behaviour (file) | automated proof (test file / lane) | manual staging step | divergence / decision (issue) | ☐ ticked (owner) |
|---|---|---|---|---|---|---|
| `resolve_anime` | `agents/animichi_tools.py:28` | `agent/tools/resolve-anime-tool.ts` | `workers/edge/test/catalog-resolve-tool.test.ts`, `workers/edge/api-test/agent-turn.test.ts` | journey §1 (S2) | — | ☐ |
| `search_bangumi` | `agents/animichi_tools.py:46` | `agent/tools/search-bangumi-tool.ts` | `workers/edge/test/catalog-search-tools.test.ts` | journey §1 (S2) | — | ☐ |
| `search_nearby` | `agents/animichi_tools.py:58` | `agent/tools/search-nearby-tool.ts` | `workers/edge/test/catalog-search-tools.test.ts` | journey §3b step 4 | — | ☐ |
| `plan_route` | `agents/animichi_tools.py:69` | `agent/tools/plan-route-tool.ts` | `workers/edge/test/catalog-plan-route-tool.test.ts` | journey §3b step 6 | — | ☐ |
| `web_search` | `agents/web_tools.py:63` (10 s budget at `:89`, top 5 at `:95`) | `agent/tools/web-search-tool.ts`, `agent/tools/duckduckgo-web-searcher.ts` | `workers/edge/test/web-search-tool.test.ts`, `workers/edge/test/duckduckgo-result-page.test.ts`, `workers/edge/api-test/web-search-turn.test.ts` | journey §3c | backend is DuckDuckGo's HTML endpoint instead of Python's `ddgs` package — same index, no secret, swap is one adapter behind `WebSearcher` (PR #1291) | ☐ |
| `translate_anime_title` | `agents/web_tools.py:99` (chain at `:130`) | `agent/tools/translate-title-tool.ts`, `agent/tools/catalog-title-translation.ts`, `agent/tools/model-title-translation.ts` | `workers/edge/test/translate-title-tool.test.ts`, `workers/edge/test/toolless-translation-model.test.ts` | journey §3d | the tool-less completion runs outside the pi `Agent`, so its tokens are metered nowhere on any turn — #1292 | ☐ |
| failure degrades to Python's sentence, never a throw | `agents/web_tools.py:93` | `agent/tools/web-search-tool.ts` | `workers/edge/test/web-search-tool.test.ts` | journey §3c step 4 | — | ☐ |
| untrusted-web boundary (preamble, delimited blocks, control chars, tag stripping) | `agents/web_trust.py:68`, `:93`, `:101` | `agent/tools/web-result-trust.ts` | `workers/edge/test/web-result-trust.test.ts`, `workers/edge/api-test/web-search-turn.test.ts` | journey §3c step 3 | — | ☐ |
| `detect_prompt_injection` | `agents/web_trust.py:38` | not ported | — | — | log-only in Python and never called from `agents/web_tools.py`; an observability gap, not a security one — owner decision pending on #1287 | ☐ |
| registration order of the six tools | `agents/animichi_tools.py:78` + `agents/web_tools.py:145` | `agent/tools/agent-toolbox.ts` | `workers/edge/test/agent-session-catalog-toolbox.test.ts` | journey §1 (S2 frame list) | — | ☐ |
| per-tool 85 s deadline | `agents/animichi_tools.py:25` | `agent/tools/catalog-timeouts.ts` | `workers/edge/test/catalog-tool-budget.test.ts` | — | pydantic-ai gave Python `Tool(timeout=…)`; pi's `AgentTool` has no such field, so the budget is ours (PR #1277) | ☐ |
| tool parameter schemas come from one zod→JSON-Schema seam | `agents/animichi_tools.py:28-77`, `agents/web_tools.py:63-129` (pydantic-ai read the signatures) | `agent/tools/tool-schema-bridge.ts` over generated `packages/contract/src/agent-tool-schemas.ts` | `workers/edge/test/catalog-tool-parameters.test.ts`, `workers/edge/test/web-tool-parameters.test.ts`, `packages/contract/test/agent-tool-schemas.test.ts` | — | — | ☐ |
| catalog reached by private service binding, never a URL | unsourced — Python called the catalog over HTTP; no single line states the policy | `agent/tools/service-binding-catalog.ts` | `workers/edge/test/catalog-service-binding.test.ts`, `workers/edge/api-test/catalog-api.test.ts` | — | spec Appendix D decision, not a Python behaviour | ☐ |
| search egress confined to one host | unsourced — Python's search ran through the pydantic-ai DuckDuckGo tool (`agents/web_tools.py:38`) with no per-destination allowlist on that path | `agent/egress/web-search-egress.ts` | `workers/edge/test/web-search-egress.test.ts` | — | stricter than Python by construction (spec §四 S5) | ☐ |

## 2 · Selection and clarify

| item | Python behaviour (file:line) | TS behaviour (file) | automated proof (test file / lane) | manual staging step | divergence / decision (issue) | ☐ ticked (owner) |
|---|---|---|---|---|---|---|
| selection request fields (`selected_point_ids`, `selected_candidate_ids`, `clarification_id`, origin) | `interfaces/routes/chat_body.py:159-161`, `interfaces/schemas.py:78` | `agent/selection/selection-request.ts` | `workers/edge/test/selection-request.test.ts` | journey §3b step 3 | Python REJECTS a body carrying both id lists (`interfaces/schemas.py:84-89`); the TS request lets points win instead of raising (PR #1296). No issue yet — raise one if the owner wants the refusal back | ☐ |
| candidate validation: `anime_ambiguity` accepts many, `place_ambiguity` exactly one | `agents/selection.py:77`, `:89`, `:91` | `agent/selection/candidate-selection.ts` | `workers/edge/test/selection-validation.test.ts` | journey §3b step 3 | — | ☐ |
| id normalisation (trim, dedupe, non-list → absent) | `agents/selection.py:72` | `agent/selection/selection-request.ts` | `workers/edge/test/selection-request.test.ts` | — | — | ☐ |
| `plan_multi` — parallel fetch, deterministic merge, one `multi` ref | `agents/selection.py:96`, merge at `:216` | `agent/selection/multi-selection.ts`, `agent/selection/merged-works.ts` | `workers/edge/test/selection-merge.test.ts`, `workers/edge/test/selection-turn.test.ts` | journey §3b step 4 | — | ☐ |
| `partial` when a half could not be fetched | `agents/selection.py:271`, `:278` | `agent/selection/multi-selection.ts` | `workers/edge/test/selection-merge.test.ts` | journey §3b step 4 | on the wire `partial` is `plan_multi` + `status: partial`, not an intent of its own — the model-loop `partial` intent is not a selection path (PR #1296) | ☐ |
| omitted halves absent from `plan_multi.data` | `agents/selection.py:242`, `:246` | `agent/selection/merged-works.ts` | `workers/edge/test/selection-merge.test.ts` | journey §3b step 4 | contribution is decided while inserting rows rather than by Python's `_contributed`, argued in file (PR #1296) | ☐ |
| place clarification answers through `search_nearby` | `agents/selection.py:312`, error text at `:359` | `agent/selection/place-selection.ts` | `workers/edge/test/selection-place.test.ts` | journey §3b step 4 | — | ☐ |
| `plan_selected` from picked point ids | `agents/selected_route.py:37`, success at `:125`, error at `:150` | `agent/selection/selected-itinerary.ts` | `workers/edge/test/selection-turn.test.ts` | journey §3b step 6 | — | ☐ |
| refusal texts for a stale, unknown or wrong-mode pick | `agents/selection_messages.py:13-27` | `agent/selection/selection-copy.ts` | `workers/edge/test/selection-validation.test.ts` | journey §3b step 5 | a refused pick carries the specific sentence Python minted and then discarded (PR #1296) | ☐ |
| `too_large` and the localized route-error table | `agents/selection.py:134`, `:142`, `agents/selection_messages.py:13` | not reachable | — | — | the catalog port degrades every failure to one untyped error (#1253), so no code path can produce them; a typed-errors card closes it (PR #1296) | ☐ |
| clarification consumed exactly once; a late pick is refused | `agents/selection.py:306`, revision at `agents/session_state.py:177` | `agent/session/session-envelope.ts` (`clarificationRevision`), `agent/selection/turn-selection.ts` | `workers/edge/test/selection-replay.test.ts`, `workers/edge/agent-db-test/turn-selection.db.test.ts` | journey §3b step 5 | — | ☐ |
| `clarification_id` published on the clarify part | `interfaces/routes/chat_body.py:161` | `agent/session/turn-answer-part.ts` | `workers/edge/test/agent-turn-answer.test.ts`, `workers/edge/test/selection-request.test.ts` | journey §3b step 2 | restored in #1288 after #1280 had left it out; `apps/web`'s clarify card already echoes it | ☐ |
| a selection turn skips the model loop | `agents/selection.py:96` (no agent run on this path) | `agent/selection/turn-selection.ts` | `workers/edge/test/selection-turn.test.ts`, `workers/edge/test/selection-eligibility.test.ts` | journey §3b step 4 | a selection turn is exempt from the model and caller-keyed eligibility checks, so a catalog-only deploy still answers a pick (PR #1296) | ☐ |
| a pick is one `(run_id, step_index)` step, replayed not re-executed | not applicable — step idempotency is a TS-tier contract (spec §三) | `agent/session/turn-step.ts`, `agent/selection/turn-selection.ts` | `workers/edge/test/selection-replay.test.ts`, `workers/edge/agent-db-test/turn-selection.db.test.ts` | — | — | ☐ |
| a pick leaves scene references in the fact ledger | `domain/fact_ledger.py:261` | `agent/memory/turn-fact-recorder.ts` | `workers/edge/test/selection-facts.test.ts` | journey §3e step 4 | — | ☐ |

## 3 · Typed answers

| item | Python behaviour (file:line) | TS behaviour (file) | automated proof (test file / lane) | manual staging step | divergence / decision (issue) | ☐ ticked (owner) |
|---|---|---|---|---|---|---|
| a turn ends by submitting a typed result | `agents/animichi_agent.py:206`, `:412` (union `output_type` of final-result tools) | `agent/session/turn-answer.ts` (one final `respond` tool) | `workers/edge/test/agent-turn-answer.test.ts` | journey §1 (S2) | measured, not chosen: the installed pi kernel hands `streamFn` no `response_format`, so a final tool is the pi-native shape and costs no extra provider call (PR #1286) | ☐ |
| the answer reaches the client as a `data-response` part | `interfaces/routes/chat_stream.py:144` | `agent/session/turn-frames.ts`, `agent/session/turn-answer-part.ts` | `workers/edge/test/agent-turn-answer.test.ts`, `workers/edge/test/turn-answer-part.type-test.ts`, `packages/contract/test/chat-answer-part.test.ts` | journey §1 (S2, two parts under one id) | — | ☐ |
| the intent vocabulary is the contract's, not a second copy | `agents/runtime_models.py:21`, `:56` | generated `packages/contract/src/agent-tool-schemas.ts` read by `agent/session/turn-answer.ts` | `packages/contract/test/agent-tool-schemas.test.ts`, `packages/contract/test/chat-data-parts.test.ts` | — | — | ☐ |
| the same intent is published by the messages GET | `interfaces/routes/conversations.py:121` | `agent/retrieval/transcript-message.ts` | `workers/edge/test/conversation-retrieval.test.ts`, `workers/edge/agent-db-test/turn-answer.db.test.ts` | journey §3 | — | ☐ |
| the `respond` tool's own events stay off the stream | not applicable — Python's final result was never a visible tool part | `agent/session/turn-frames.ts` | `workers/edge/test/agent-turn-answer.test.ts` | journey §1 (the S2 callout) | — | ☐ |
| a submitted answer repairs the pending clarification; a turn that submits nothing leaves it | `agents/animichi_runner.py:360` (end-of-run repair keyed on `ClarifyResponseModel`) | `agent/session/turn-envelope.ts`, `agent/session/turn-answer.ts` | `workers/edge/test/agent-session-envelope-turns.test.ts`, `workers/edge/test/agent-turn-answer.test.ts` | journey §3b step 5 | deferred by #1280 and closed in #1283 — treating "no answer" as "not clarify" would let a prose question wipe the clarification | ☐ |
| the intent the model picks matches what its tools returned | `agents/runtime_models.py:21` | not code — the model's own choice of intent | — | journey §1 (S2b, the rendered card) | observed on staging: a turn whose `search_bangumi` returned rows answered `general_qa` and rendered as prose. Model quality, not pipeline — belongs to the W3 eval set (#1283 comment) | ☐ |
| the answer path loads no zod — the schema module it reads is generated and import-free | not applicable — Python has no bundle | generated `packages/contract/src/agent-tool-schemas.ts` read by `agent/session/turn-answer.ts` | `packages/contract/test/agent-tool-schemas.test.ts`, `workers/edge/bundle-smoke/entry-bundle.test.ts`, `packages/contract/test/import-free-modules.test.ts` | — | closed by #1285: the whole `entry` bundle is now asserted zod-free, after `AGENT_PATHS` and `DEFAULT_IDENTITY_POLICY` moved to import-free contract modules | ☑ |

## 4 · BYOK

| item | Python behaviour (file:line) | TS behaviour (file) | automated proof (test file / lane) | manual staging step | divergence / decision (issue) | ☐ ticked (owner) |
|---|---|---|---|---|---|---|
| the four `X-BYOK-*` headers parse into one credential | `agents/byok_models.py:169` | `agent/byok/byok-headers.ts`, `agent/byok/byok-credential.ts` | `workers/edge/test/byok-credential.test.ts` | journey §3f step 1 | — | ☐ |
| an empty key is a rejection | `agents/byok_models.py:106`, `:255` | `agent/byok/byok-headers.ts` | `workers/edge/test/byok-credential.test.ts` | journey §3f step 5 | — | ☐ |
| per-family model default | `agents/byok_models.py:139`, `:145` | `agent/byok/byok-family.ts` | `workers/edge/test/byok-credential.test.ts` | journey §3f step 1 | — | ☐ |
| `anthropic` keeps its native dialect | `agents/byok_models.py:227` | `agent/byok/byok-family.ts` | `workers/edge/test/byok-turn-model.test.ts` | journey §3f step 3 | pi-ai's `anthropic-messages` accepts an injected fetch, so it is used as-is (PR #1293) | ☐ |
| `gemini` rides Google's OpenAI-compatible surface | `agents/byok_models.py:239` | `agent/byok/byok-family.ts` | `workers/edge/test/byok-turn-model.test.ts` | journey §3f step 3 | spec Appendix D: pi-ai's `google-generative-ai` adapter refuses an injected fetch | ☐ |
| `openai-compatible` base URL | `agents/byok_models.py:115`, `:198` (any HTTPS endpoint passing the address checks) | `agent/byok/byok-headers.ts` over `agent/egress/provider-allowlist.ts` | `workers/edge/test/byok-credential.test.ts`, `workers/edge/test/byok-egress-policy.test.ts` | journey §3f step 2 | narrowed to `api.openai.com` only — S5's first red line is an exact-host allowlist. The one place `AGENT_TURN_ROUTE = "edge"` is not byte-for-byte the container. Owner decision open: keep narrow or enumerate gateways (#1289) | ☐ |
| SSRF boundary (private ranges, metadata address, own infrastructure, non-443, non-HTTPS) | `agents/byok_models.py:198` | `agent/egress/egress-policy.ts`, `agent/egress/host-address.ts` | `workers/edge/test/byok-egress-addresses.test.ts`, `workers/edge/test/byok-egress-policy.test.ts` | — | — | ☐ |
| every redirect re-validated at hop 1 | `infrastructure/egress_transport.py:51`, `:184` | `agent/egress/guarded-fetch.ts` | `workers/edge/test/byok-egress-redirect.test.ts` | — | — | ☐ |
| no server-key fallback, ever | `agents/byok_models.py:265` | `agent/byok/byok-turn-model.ts`, `agent/session/durable-turn.ts` | `workers/edge/test/byok-tier-route.test.ts`, `workers/edge/test/byok-turn-wiring.test.ts`, `workers/edge/test/byok-lost-credential.test.ts` | journey §3f step 5 | a run whose DO incarnation was evicted between arm and alarm is failed `provider_failed` on the durable `runs.payer = 'byok'` marker rather than driven on the server key (PR #1293) | ☐ |
| the credential never lands in storage | `agents/byok_models.py:64` (request-scoped) | `agent/byok/byok-turn-model.ts`, `agent/session/agent-session.ts` | `workers/edge/test/byok-arm-hop.test.ts` | — | — | ☐ |
| keys scrubbed from frames and provider errors | `agents/byok_models.py:50` | `agent/egress/secret-scrub.ts` | `workers/edge/test/byok-secret-scrub.test.ts` | — | — | ☐ |
| `POST /v1/byok/probe` — verdict plus vision capability | `interfaces/routes/byok.py:92`, `agents/byok_probe.py:73` | `agent/byok/byok-probe.ts`, `gateway/agent-turn.ts` | `workers/edge/test/byok-probe-verdict.test.ts`, `workers/edge/api-test/byok-probe.test.ts` | journey §3f step 1 | the valid-key case is manual on purpose — it needs a key that must not be written down | ☐ |
| the probe is login-gated | `interfaces/routes/byok.py:88` | `gateway/agent-tier-route.ts` | `workers/edge/test/byok-probe-auth.test.ts` | journey §3f step 1 | the brief's "anonymous-only as today" was wrong; the code has always been authenticated-only (#1289 comment) | ☐ |
| a BYOK turn is priced at zero on its own payer | `interfaces/public_api.py:922` | `agent/settlement/turn-settlement.ts`, `agent/intake/turn-intake.ts` | `workers/edge/test/byok-tier-route.test.ts`, `workers/edge/agent-db-test/turn-settlement.db.test.ts` | — | `runs.payer = 'byok'` existed in the schema but nothing produced it before #1289 | ☐ |
| D18 — `translate_anime_title` runs on the SERVER key during a BYOK turn | `interfaces/public_api.py:922` | `agent/session/session-turn.ts`, `agent/tools/model-title-translation.ts` | `workers/edge/test/byok-translation-egress.test.ts`, `workers/edge/test/toolless-translation-model.test.ts` | journey §3f step 4 | with no server key it degrades to `untranslated` instead of reaching for the caller's credential (PR #1293) | ☐ |
| that translation's usage booked to a `platform` scope | `interfaces/public_api.py:922` (`AttributedUsage(usage, "platform")`) | not implemented | — | — | the tool-less path runs outside the pi `Agent` so its `message_end` never reaches the settlement, and `daily_usage.scope` admits no `platform` value — needs DDL, #1292 | ☐ |

## 5 · Compaction and memory

| item | Python behaviour (file:line) | TS behaviour (file) | automated proof (test file / lane) | manual staging step | divergence / decision (issue) | ☐ ticked (owner) |
|---|---|---|---|---|---|---|
| newest 8 messages untouched | `agents/history_compaction.py:32` | `agent/session/context-compaction.ts` | `workers/edge/test/agent-context-compaction.test.ts` | journey §3e step 2 | — | ☐ |
| tool returns over 200 characters summarised | `agents/history_compaction.py:33`, `:180` | `agent/session/context-compaction.ts`, `agent/session/tool-return-summary.ts` | `workers/edge/test/agent-context-compaction.test.ts` | journey §3e step 2 | — | ☐ |
| `resolve_anime` returns get the candidate summary | `agents/history_compaction.py:116` | `agent/session/tool-return-summary.ts` | `workers/edge/test/agent-context-compaction.test.ts` | — | — | ☐ |
| the call's literal entity is retained before the return shrinks | `agents/history_compaction.py:60` | `agent/session/context-compaction.ts`, `agent/memory/retained-entity-ledger.ts` | `workers/edge/test/agent-memory-retention.test.ts` | journey §3e step 4 | — | ☐ |
| compaction is deterministic and a fixpoint | `agents/history_compaction.py:128` | `agent/session/context-compaction.ts` | `workers/edge/test/agent-context-compaction.test.ts` | — | pi-agent-core's own compaction was measured and rejected — never fires at this token scale, model-written, not a fixpoint, costs a provider call (PR #1298) | ☐ |
| retained-entity ledger bounds: 8 entities, 8 KiB, 96 B per value, oldest wins | `domain/compaction_retention.py:30`, `:100` | `agent/memory/retained-entity-ledger.ts` | `workers/edge/test/agent-memory-retention.test.ts` | — | — | ☐ |
| fact ledger bounds: 8 records per field, 8 KiB, 96 B per value and id | `domain/fact_ledger.py:35-37` | `agent/memory/fact-ledger.ts` | `workers/edge/test/agent-memory-fact-ledger.test.ts` | — | byte budgets are measured on our camelCase JSON; the caps are Python's (PR #1298) | ☐ |
| hard constraint is an append/supersede chain, superseded evicted first | `domain/fact_ledger.py:173`, `:184`, `:199` | `agent/memory/fact-ledger.ts` | `workers/edge/test/agent-memory-fact-ledger.test.ts` | journey §3e step 3 | — | ☐ |
| route pacing recorded from a settled step | `domain/fact_ledger.py:248` | `agent/memory/turn-fact-recorder.ts` | `workers/edge/test/agent-memory-fact-recorder.test.ts` | journey §3e step 3 | — | ☐ |
| scene references are a turn-scoped replace-set | `domain/fact_ledger.py:261` | `agent/memory/fact-ledger.ts`, `agent/memory/turn-fact-recorder.ts` | `workers/edge/test/agent-memory-fact-recorder.test.ts`, `workers/edge/test/selection-facts.test.ts` | journey §3e step 4 | — | ☐ |
| bounds re-applied when the stored state is restored | `domain/compaction_retention.py:100` | `agent/memory/stored-memory.ts` | `workers/edge/test/agent-memory-retention.test.ts`, `workers/edge/test/agent-session-envelope.test.ts` | — | a structured clone restores no class prototype, so the codec re-applies both caps (PR #1298) | ☐ |
| remembered facts reach the model as prompt lines | `agents/animichi_agent.py:265` (`trusted_session_context`) | `agent/session/turn-instructions.ts` | `workers/edge/test/agent-session-memory-turns.test.ts` | journey §3e step 3 | — | ☐ |
| compaction shapes context across TURNS | `interfaces/session_facade.py:102` (`build_message_history` replayed raw tool returns) | `agent/session/turn-transcript.ts` degrades another run's tool-call row to text | `workers/edge/test/agent-turn-transcript.test.ts`, `workers/edge/test/agent-session-memory-turns.test.ts` | journey §3e (the callout) | the retention window is effectively per RUN, so cross-turn context is smaller than Python's by construction. Owner decision open: accept as the TS tier's semantics or replay prior runs' tool returns — #1297 | ☐ |
| pending clarification and current anime survive a turn | `agents/session_state.py:171`, `agents/animichi_agent.py:265` | `agent/session/session-envelope.ts`, `agent/session/durable-envelope-store.ts` | `workers/edge/test/agent-session-envelope-turns.test.ts`, `workers/edge/test/agent-session-envelope-alarms.test.ts` | journey §3b step 1 | stored in the DO's `ctx.storage`, not a Neon column — the DO is the single writer (spec §三); not SQL-inspectable, trade-off argued in the adapter header (PR #1282) | ☐ |
| `PendingClarification.revision` | `agents/session_state.py:177` | `agent/session/session-envelope.ts` (`clarificationRevision`) | `workers/edge/test/selection-replay.test.ts` | journey §3b step 5 | dropped by #1280 (no selection path existed then), reintroduced by #1288 as the monotonic id a stale pick is refused against | ☐ |

## 6 · Session and retrieval

| item | Python behaviour (file:line) | TS behaviour (file) | automated proof (test file / lane) | manual staging step | divergence / decision (issue) | ☐ ticked (owner) |
|---|---|---|---|---|---|---|
| `POST /v1/chat` streams SD-9 frames while connected | `interfaces/routes/chat_stream.py:144` | `agent/session/turn-stream-handoff.ts`, `agent/session/turn-subscribers.ts` | `workers/edge/test/turn-stream-handoff.test.ts`, `workers/edge/test/agent-turn-stream.test.ts` | journey §1 | live delivery is best-effort by decision; a stream the session cannot open still returns the accepted run as `202` (PR #1281) | ☐ |
| the turn finishes with nobody connected | not applicable — Python ran the turn inside the request | `agent/session/agent-session.ts`, `agent/session/durable-turn.ts` | `workers/edge/test/agent-session-do.test.ts`, `workers/edge/agent-db-test/turn-loop.db.test.ts` | journey §2 and §3 | the whole point of the rewrite (spec §三) | ☐ |
| a disconnected client pulls the final result by session id | `interfaces/routes/conversations.py:121` | `agent/retrieval/conversation-retrieval.ts` | `workers/edge/test/conversation-retrieval.test.ts`, `workers/edge/agent-db-test/conversation-retrieval.db.test.ts` | journey §3 | no stream resume — owner decision, spec §二 断线语义 | ☐ |
| `run.status` on the messages GET | not applicable — the field is new in the TS tier | `agent/retrieval/conversation-retrieval.ts` | `packages/contract/test/session-run-status.test.ts`, `workers/edge/agent-db-test/conversation-retrieval.db.test.ts` | journey §3 | additive contract change; `messages` / `revision` / `next_offset` untouched (PR #1281) | ☐ |
| a conversation you do not own is a 404, same as one that does not exist | `interfaces/routes/conversations.py:130`, `:149` | `agent/retrieval/conversation-retrieval.ts`, `gateway/agent-tier-route.ts` | `workers/edge/test/conversation-retrieval.test.ts` | journey §4 | under `edge` an anonymous visitor may read their OWN transcript back; the container position is unchanged (PR #1284) | ☐ |
| anonymous daily message ceiling refuses with `quota_resets_at` | `application/admission_limits.py:99`, `interfaces/anon_quota.py:23`, `:28` | `agent/intake/anonymous-message-allowance.ts` | `workers/edge/test/anonymous-message-allowance.test.ts`, `workers/edge/agent-db-test/turn-quota-ceiling.db.test.ts` | journey §4 | the ceiling #1251 left unowned; the refusal rolls back message, run and reservation together (PR #1284) | ☐ |
| one running run per session; a second is refused | `application/turn_admission.py:123` | `agent/intake/turn-intake.ts` over `runs_one_running_per_session` | `workers/edge/test/turn-intake.test.ts`, `workers/edge/agent-db-test/turn-intake.db.test.ts` | — | — | ☐ |
| a tool step is persisted before the loop continues, and replayed not re-executed | not applicable — a TS-tier contract (spec §三, Appendix C) | `agent/session/turn-step.ts`, `agent/session/turn-step-sequence.ts` | `workers/edge/test/agent-turn-loop.test.ts`, `workers/edge/agent-db-test/turn-loop.db.test.ts` | — | — | ☐ |
| the tool session is rebuilt on replay | not applicable — Python had no cross-incarnation replay | `agent/session/turn-catalog-session.ts`, `agent/session/minted-refs.ts` | `workers/edge/test/agent-turn-ref-replay.test.ts`, `workers/edge/agent-db-test/turn-ref-replay.db.test.ts` | — | every ref rides the step that minted it and is put back before the retry resumes, so a named ref plans instead of reading `stale_ref` (#1279) | ☐ |
| a stuck run is picked up by a backstop independent of the session DO | not applicable — no equivalent in the request-scoped tier | `agent/sweeper/run-sweeper.ts`, `agent/sweeper/run-sweep.ts` | `workers/edge/test/run-sweeper.test.ts`, `workers/edge/test/run-sweep.test.ts`, `workers/edge/agent-db-test/run-sweep.db.test.ts` | — | — | ☐ |
| quota refunded exactly once on a failed turn | `interfaces/usage_metering.py` (no single line — the refund is spread across the metering service) | `agent/settlement/turn-settlement.ts` | `workers/edge/test/turn-settlement.test.ts`, `workers/edge/agent-db-test/turn-refund.db.test.ts` | — | — | ☐ |
| the flag can send every route back to the container in one word | not applicable | `gateway/routing-policy.ts` | `workers/edge/test/agent-turn-routing.test.ts`, `workers/edge/test/agent-turn-route-policy.test.ts`, `workers/edge/test/agent-turn-route-config.test.ts` | journey §5 | anything but the literal `edge` is `container`; staging is `edge`, production and `wrangler dev` are `container` (PR #1284) | ☐ |
| the request body shape the web app already sends | `interfaces/routes/chat_body.py:159-161` | `gateway/chat-envelope.ts` | `workers/edge/test/chat-envelope.test.ts` | journey §1 | — | ☐ |
| the staging lanes present staging's credential | not applicable | `workers/edge/api-test/lane-origin.ts` | `workers/edge/test/web-search-lane.test.ts`, `workers/edge/test/lane-gate-header.test.ts` | see "How to run the manual pass" | the credential is the Cloudflare Access service token since #1369 (it was `STAGING_GATE_TOKEN` when this row was written, PR #1295); without it every lane request comes back as the Access login page, unrelated to the code | ☐ |

## How to run the manual pass

Preconditions are `docs/ops/w1-staging-journey.md` §0: staging must be on a
deploy that carries `AGENT_TURN_ROUTE = "edge"` — merged is not deployed
(`docs/ops/deployment.md`) — and `/healthz` must answer 200.

**Credentials.** Two, neither of which belongs in this repo:

- `CF_ACCESS_CLIENT_ID` + `CF_ACCESS_CLIENT_SECRET` — the Cloudflare Access
  service token, both or neither (#1369 replaced the `STAGING_GATE_TOKEN` WAF gate
  this row used to name). The same pair the Playwright suite sends as
  `use.extraHTTPHeaders`; the recipe and the reasoning are in
  `workers/edge/api-test/README.md` under "The Cloudflare Access service token",
  and the values come from `esc env open lifeodyssey/animichi/staging`. A login
  page means the door, not the app.
- `AGENT_TURN_BEARER` — any real staging Neon Auth access token; the browser's
  own session token works and is short-lived by design.

**The automated lanes**, from the repo root, after that deploy is live:

```sh
CATALOG_API_ORIGIN=https://staging.animichi.com \
AGENT_TURN_BEARER="$(cat ~/.animichi/staging-access-token)" \
CF_ACCESS_CLIENT_ID="$(esc env open lifeodyssey/animichi/staging environmentVariables.CF_ACCESS_CLIENT_ID --format string)" \
CF_ACCESS_CLIENT_SECRET="$(esc env open lifeodyssey/animichi/staging environmentVariables.CF_ACCESS_CLIENT_SECRET --format string)" \
pnpm --filter edge-worker run test:catalog-api
```

That is four suites: `workers/edge/api-test/catalog-api.test.ts` (no public
catalog door), `workers/edge/api-test/agent-turn.test.ts` (one real turn calling
`resolve_anime`, readable back), `workers/edge/api-test/web-search-turn.test.ts`
(the DuckDuckGo hop and the untrusted preamble) and
`workers/edge/api-test/byok-probe.test.ts` (the invalid-key rejection). All
three variables fail closed.

The offline suites this document points at run without any credential:

```sh
pnpm run test:worker
pnpm --filter edge-worker run test:agent-db   # needs Docker
pnpm --filter @animichi/contract test
```

**The browser journey** is `docs/ops/w1-staging-journey.md`, in one sitting, in
one fresh private window: §1 anonymous conversation → §2 leave mid-turn → §3
come back and pull the result → §3b clarify, pick, route → §3c web search →
§3d translation → §3e memory across turns → §3f BYOK → §4 the refusals.

**What to screenshot** — the journey names each one: S0 (deployed sha next to
`healthz`), S1–S3 (headers, frames, second turn), S4 (leaving mid-turn), S5
(the transcript with `run.status`), S5b–S5d (clarify id, the pick, the stale
refusal), S5e (the untrusted preamble), S5f (the translation part), S5g (the
cross-turn recall), S5h–S5j (the BYOK probe, the base-URL refusal, the
wrong-key 400). S5 is the one that decides W1; S5e, S5g and S5h are the ones
that decide W2.

## Sign-off

Fill this in on #1257. W2 closes when it is complete and every row above is ☑
or carries a named divergence the owner has accepted.

```text
Deployed commit under test:
Date / operator:
Lanes: test:catalog-api ____  test:worker ____  test:agent-db ____  contract ____
Journey: §1 ___ §2 ___ §3 ___ §3b ___ §3c ___ §3d ___ §3e ___ §3f ___ §4 ___
Rows ticked: __ / __
Divergences accepted as-is (issue → verdict):
  #1297 cross-run replay vs per-run window →
  #1289 openai-compatible narrowed to api.openai.com →
  #1287 detect_prompt_injection not ported →
  #1292 platform usage scope →
  #1285 zod in the entry bundle →
  points-win over Python's exclusive-ids refusal →
Verdict (W2 exit):
```
