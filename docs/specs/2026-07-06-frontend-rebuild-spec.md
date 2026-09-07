# Frontend Rebuild — Main Spec

Status: DRAFT for Coordinator planning (rev. 10 — Patch P3 retired the last two pending items: P6 (SSE disconnect semantics) and the message-length cap are both now **Finalized (finalized 2026-07-07)** per the user-approved "spec 收口三件" ruling, so the spec package now carries **zero** pending-confirmation items; Patch P3 also unified the dual-route path (the SD-28 supplement) and added iter-0 story S0.10; rev. 9 — Patch A landed the C6 ruling (D16/D18/D19 + the Generative UI constitution's URL allowlist clause → Finalized), added SD-28/29/30 to the SD conclusions index, and translated the full document to English; rev. 8 — Backfill A aligned the doc with inputs §7-11/SD-13-27, superseding the rev. 7 SD-9 three-event-SSE proposal that had since been overturned)
Date: 2026-07-06
Author: Planning agent (rev. 7, based on `2026-07-06-frontend-rebuild-inputs.md` §1-9); Backfill A (rev. 8, based on the full §1-11 text; commits in git log; authority layering below); Patch A (rev. 9, C6 ruling + SD-28/29/30 index + English translation)
Baseline: `main` (`02cd7fa`), new branch `feat/frontend-rebuild`

> **S0.9 authority amendment (2026-08-02):** This supersedes older SD-1 wording. The Neon
> migration authority is `migrations/neon/*.sql` plus generated `migrations/neon/atlas.sum`, applied
> by pinned Atlas. Drizzle remains runtime query/type metadata only; there is no
> `atlas-provider-drizzle` desired-state generation or Drizzle migration runner. Supabase
> migrations are frozen auth/legacy compatibility history, not a second Neon source.

Sole authoritative input: `docs/specs/2026-07-06-frontend-rebuild-inputs.md`, §7-11 (backfilled from SD-13-30; this pass covers the SD-26 pipeline supplement D1-D6 and SD-28/29/30). **Authority layering (important; corrected by the main session on 2026-07-06; revised by Backfill A's evening review on 2026-07-06; revised again by Patch A the same evening per the C6 ruling)**:
- **Finalized** (directly actionable, no further user confirmation needed): §1-5 (Decision Registry / Iteration Train / three inventory reports), §6 X1-X15, and the SD interview conclusions across §7-11 covering **SD-0 through SD-30** (including §8's supplementary confirmation wording for SD-7). **SD-9 has been revised** (see below, backfilled from §10 Step 2): the three-event custom-SSE proposal has been overturned; it is now Finalized as the AI SDK UI message-stream protocol via pydantic-ai's `VercelAIAdapter`. **SD-13/15/16/17/18/19/20/21/22/23/24/25/26/27/28/29/30** (each walked through with the user in turn across §8-11 and promoted to Finalized, backfilled from that section) fold into the Finalized scope as well, superseding the matching pending-confirmation tags from the earlier version: P2 → Finalized (SD-19); P3 → rescinded, superseded by SD-18's new usage-metering hook; P8 → Finalized (SD-20); P9 → Finalized (SD-21); P10 → Finalized (SD-13 rule 2); the Generative UI core philosophy (semantic payload + app-owned registry) → Finalized (SD-13); no internal skill framework, MCP client deferred until actually needed → Finalized (SD-24). **Per the C6 ruling (2026-07-06)**: the Generative UI constitution's "payload URLs may only render from a catalog data source or an explicit allowlist source" clause → Finalized (C6a, grounded in SD-19's same-origin injection-defense requirement); D18 (BYOK covers only the main loop, internal calls always use the server's own key) → Finalized (C6b, made explicit from what SD-20's D18-boundary regression AC already implied); D16 (model-switch eval gate) and D19 (no model tiering) are confirmed as pre-existing finalized defaults and are removed from the legacy pending-confirmation list (C6c). **Per the P3 patch (2026-07-07, user-approved "spec 收口三件" ruling)**: the last two remaining pending items — P6 (SSE disconnect semantics — `turn_id`/`seq`, no mid-stream resume, `GET messages` fallback, a D4 exception card with retry) and the message-length cap (env `MESSAGE_MAX_CHARS`, initial value 4000) — are both now **Finalized (finalized 2026-07-07)**, exactly as already written; see §8.8 and the security quick-reference table.
- **Pending-confirmation items — NONE REMAINING (finalized 2026-07-07)**: the last two items, P6 (SSE disconnect semantics) and the message-length cap, were retired by the P3 patch per the user-approved "spec 收口三件" ruling and are now Finalized (finalized 2026-07-07). D16/D18/D19 and the Generative UI constitution's URL allowlist clause were already promoted to Finalized by the C6 ruling above. The spec package now contains zero pending-confirmation items.

Design source drafts: `docs/archive/design-sync/`. Where these conflict with the older spec (`2026-06-22-frontend-rebuild-tanstack-design.md`, etc.), the inputs file and this spec take precedence.

---

## ① Vision and Scope

Seichijunrei's frontend is being rebuilt wholesale, from Next.js + OpenNext-SSR into `apps/web` (TanStack Start, SPA + selective SSR, Cloudflare Worker runtime), deployed to the **finalized domain `animichi.com`** (SD-0), cutting over in a single big-bang that replaces production directly. The backend stays a hybrid microservice setup — the PydanticAI containerized agent (SD-4, closed and final) plus the TS catalog service — with a **new, third** TS service, `workers/users`, added to hold user-domain data (SD-2, Finalized). Final ownership rule: catalog-domain data → `workers/catalog` oRPC; user-domain data → `workers/users` oRPC (Neon+Drizzle); the agent gains no further data endpoints. The agent's cognitive architecture stays as it is (SD-7: single-tool loop + deterministic bypass, no new routing layer); the outward-facing capability surface (Iteration 7) is **task-shaped** rather than conversational (SD-12: `resolve_anime`/`search_points`/`plan_pilgrimage`, stateless and idempotent, with no direct chat pass-through exposed). Chat's streaming protocol is finalized as the **AI SDK UI message-stream protocol** (pydantic-ai's official `VercelAIAdapter` + the frontend's AI SDK v7 `useChat`, backfilled from the revised SD-9, superseding the earlier "three-event custom SSE" proposal); the project's own contract narrows down to a zod schema for custom data parts, living in `packages/contract`. BYOK's first release covers OpenAI-compatible/Anthropic/Gemini (SD-11). **The following security/contract refinements are Finalized** (backfilled from SD-19/20/21/13): delimiting external content + an architectural invariant (P2/SD-19); an SSRF egress guard (P8/SD-20, the strict variant with post-resolution IP validation); GPS precision truncated to roughly 100 m (P9/SD-21); additive-only payload contract evolution + registry governance policy (P10/SD-13 rule 2). The original "cost-accumulation middleware" (P3) has been rescinded, superseded by SD-18's new usage-metering hook + container-ingress circuit breaker. **The last two items awaiting user sign-off are now Finalized (finalized 2026-07-07, per the P3 patch's "spec 收口三件" ruling)**: P6 (SSE disconnect semantics, restated around the AI SDK `finish` event + a `GET messages` fallback) and the message-length cap (env `MESSAGE_MAX_CHARS`, initial value 4000) — no pending-confirmation items remain. The 8 iterations (0-7) are built in the order of the 巡礼 (pilgrimage) ring — Chat/Plan (計画, "Plan") leads, then details/list pick up saving, then Walk (歩く, "Walk") is the on-the-ground trial, then しおり (a shareable keepsake booklet) output flows back, then 発見 ("Discover") draws in newcomers (続きから, "continue from where you left off" — depends only on the sessions/routes lists, SD-8), then the workbench raises efficiency, then the open API faces outward (task-shaped capability, SD-12; external release order per SD-25 = Claude Skill first → a quick, coarse-grained MCP server next → A2A deferred until the DD-10 freeze is triggered) — every iteration ends in a releasable increment that is independently deployable to production. Scope covers all 24 page-level HTML canvases under `docs/archive/design-sync/` (see §6) and making SEO/GEO executable (backfilled from SD-27, see `2026-07-06-seo-geo-plan.md`).

We are not aiming for "feature parity with the old site from day one" — we're aiming for "at the end of every iteration, production has no dead-end UI, no bare errors, and the visuals match the design canvases."

---

## ② Decision Log

### G1-G8 (grill-me rulings, 2026-07-06)

| # | Decision | Ruling |
|---|---|---|
| G1 | Baseline | New branch `feat/frontend-rebuild` off `main` (02cd7fa); the new frontend lands in `apps/web/`; the spike code (the `frontend/` on branch `docs/frontend-rebuild-plan`, 11 feature commits) **migrates the code, not the history** |
| G2 | Cutover | **Big-bang**: Iteration 0's walking skeleton replaces the production frontend directly; the old Next.js `frontend/` and the OpenNext chain are deleted in the same iteration |
| G3 | Rendering | SPA + **selective SSR** (the `/s/:id` and `/anime/:id` route families) — a formal revision of the old spec's "pure SPA" decision (D4) |
| G4 | Backend ownership | **Full-stack vertical slices**: any story needing new backend capability brings its own minimal enabler. Final ownership rule: catalog-domain data → `workers/catalog` oRPC; **user-domain data → a new TS service `workers/users`'s oRPC routes (`/v1/users/*`), backed by Neon+Drizzle, contract in `packages/contract`**; `apps/web`'s auth client is the **Neon Auth SDK (Better Auth)** (SD-31), **auth-only** and never talks directly to any data table; **no new data endpoints may be added to the agent service** — the agent keeps only session/orchestration state (single-tool loop + deterministic bypass, SD-7). **X11 discipline**: `apps/web` itself must always consume the capability/user-data surface through the public `/v1` API, never a private backdoor; Iteration 7's SDK/MCP reuse the same contract and expose **task-shaped capability only** (SD-12), never a chat pass-through |
| G5 | Iteration train | Chat first, 8 iterations (0-7) |
| G6 | Walk offline | **All-at-once within Iteration 3** (service worker + map/route caching + offline check-in queue sync) — not split up, not deferred |
| G7 | Anonymous Chat | **Fully opened up**: Chat works end-to-end while logged out; the login wall appears only at save time (P5); paired with edge rate limiting + Cloudflare Turnstile + anonymous quotas + BYOK (three provider families, SD-11); the outward-facing API moves into Iteration 7 (order per SD-25: Claude Skill first + a quick, coarse-grained MCP server); **A2A is deferred** (→ DD-10 frozen, pending real enterprise-orchestration-side signal) |
| G8 | Asset production | The fox's 8-frame trot sprite + a 20-icon product icon set are produced via an AI generation pipeline; the AC must include "considered done only after a human has reviewed and accepted it" |

### D1-D15 (architecture decision registry rulings, Finalized)

| # | Decision | Ruling | Key facts |
|---|---|---|---|
| D1 | TanStack Start | Kept | Spike proven out; docs/CI still all reference Next.js — the Iteration 0 doc rewrite handles this too |
| D2 | animal-island-ui-tailwind | Kept, upgrade to latest 1.0.x | Compatibility verification lands in Iteration 0 |
| D3 | Capacitor | **Deferred** (non-goal, after the loop closes) | LOCKED paper decision, zero code |
| D4 | Rendering strategy | **Revised**: SPA + selective SSR (= G3) | `wrangler.toml [assets]` and CI both still assume the old approach — Iteration 0 must fix this |
| D5/D6 | monorepo + oRPC contract | Kept, **scope expanded** | This train adds a new `workers/users` oRPC contract + a zod schema for the chat AI SDK UI message-stream's custom data parts (backfilled from the revised SD-9, superseding the old "three-event SSE schema" wording), both landing in `packages/contract` |
| D7 | Agent Pyodide-Worker-ification / TS rewrite | **Both REJECTED, final (SD-4)** | Containerized Python + a warm-keeping strategy is the final architecture; the X2 first-token SLO is thereby upgraded to a hard requirement |
| D8 | Neon/Supabase split | **SD-3 activated (data→Neon) + SD-31 activated (auth→Neon Auth), progressive rollout** | The data plane moves to Neon; **the auth backend moves to Neon Auth (SD-31, activating SD-3⑤)**. 5 sub-points (① fix the selected_route bug / ② build new tables in Neon / ③ freeze the Supabase catalog tables / ④ migrate sessions etc. / ⑤ **auth → Neon Auth (SD-31)**: the code integration lands in this train's auth stories, while fully retiring the Supabase auth project + migrating real users stays out of scope) |
| D9 | Pulumi IaC | Non-goal | Exception: the R2 bucket binding is declared directly |
| D10 | Multiple environments | Non-goal | Current state is single-environment tag→prod |
| D11 | i18n | Kept | The spike's Context+dictionary mechanism carries over directly |
| D12 | Test strategy | Kept + gaps filled | `apps/web`'s coverage floor is set from the value measured at Iteration 0; the layered agent-eval stays permanently on (X8) |
| D13 | Tag-based deploy | Mechanism kept, content rewritten | `workers/users` needs the same CI/deploy steps as `workers/catalog` |
| D14 | Agent cognitive-loop architecture | **Unchanged (SD-7 final, user-confirmed)** | Single-tool loop (native tool-calling, ReAct lineage) + typed final output + the `ModelRetry`/`output_validator` double guard + deterministic bypass (SP8/SP9, `selected_point_ids`); intent accuracy is handled through eval-driven prompt/few-shot/tool-description tuning, no new routing/dispatch layer |
| D15 | Session memory scope | **Per-session, `user_memory` dormant** (SD-8); **memory mechanism refined (backfilled from SD-15)** | The `user_memory` table stays dormant — not deleted, not invested in; "続きから" (continue from where you left off, Iteration 5) depends only on the `sessions`/`routes` lists. SD-15 refinements: ① the fact ledger = `tool_state` made typed, starting fields = proposal summary so far / current selection set / user's hard constraints / resolved anime titles / episode-and-scene references, every field timestamped with add/amend/supersede semantics (lands in Iteration 1, around S1.7); ② anonymous→logged-in session-ownership migration (device token→user_id) lands in Iteration 1; ③ the `user_memory` wake-up blueprint (out of scope for this train) = a self-built profile table (not Mem0/Letta/Zep) + user-visible/editable/deletable/toggle-off + GEM write semantics + a lightweight "pending-promotion" soft-fact buffer; ④ semantic compaction keeps a verbatim-fragment fallback, a quick add-on AC in Iteration 1 |

### D16-D19 (from scattered points in inputs §9 "model strategy"/"subagent, final ruling"; **per the C6 ruling (Patch A, 2026-07-06 evening), D16/D18/D19 are now all Finalized**: D17 was already promoted to Finalized after being walked through in §10 Step 8/SD-24; D16 and D19 are confirmed as pre-existing finalized defaults and are removed from the legacy pending-confirmation list per C6c; D18 is made explicit per C6b, grounded in what SD-20's D18-boundary regression AC already implied)

| # | Decision | Status | Content |
|---|---|---|---|
| D16 | Model-switch gate | **Finalized (per C6c ruling — confirmed as a pre-existing default)** | Switching the primary model must pass the eval gate (the L1 full suite, 617→~750 cases per SD-30, weighted toward locale+intent, decided on a combined score/¥ basis); shares infrastructure with the X8 layered eval gate. The concrete model-switch gate runbook is SD-30④ (full outcome+trajectory eval → CI comparison + a score/¥ report → key-family CI floor no worse than baseline → human sign-off) |
| D17 | Subagent usage scope | **Finalized (backfilled from SD-24①, confirmed item-by-item in §10 Step 8 "partially Finalized")** | Zero subagents in the product runtime, aside from the translation subagent (a clean, pure-function boundary); an injection-isolation subagent is deferred to an Iteration 7 evaluation (→ DD-4 frozen); **planning/clarification/search are not split out** (splitting them out = one more LLM judgment call that can go wrong, hurting the 54% IntentMatch score); SP9 is "the same agent re-invoked with constraints," not multiple agents; the harness's development-time multi-agent orchestration is kept strictly separate from the product runtime |
| D18 | BYOK coverage scope | **Finalized (per C6b ruling, grounded in what SD-20's D18-boundary regression AC already implied, now made explicit)** | Covers only the main-loop LLM call; internal calls always use the server's own key |
| D19 | Model tiering | **Finalized (per C6c ruling — confirmed as a pre-existing default)** | No model tiering (YAGNI reasoning: tool execution is code logic, not an LLM call) |

### X1-X15 supplementary architecture notes (added by the main session throughout 2026-07-06, Finalized)

| # | Note | Landing spot |
|---|---|---|
| X1 | **Map-stack ADR**: MapLibre GL + Protomaps (pmtiles stored in R2), static-first; **Mapbox is banned** | S0.4; S1.4/S1.5/S2.2/S5.2; remove `NEXT_PUBLIC_MAPBOX_TOKEN` (S0.3) |
| X2 | **Chat first-token SLO**: warm p95 ≤3s + container warm-keeping; **hard requirement following SD-4** | S1.2 `-> api` |
| X3 | **BYOK × Logfire scrub**: keys are stripped from every observability surface; **covers all three provider families following SD-11** | S1.11 hard AC `-> integration` |
| X4 | **Global daily-budget circuit breaker**: auto-downgrades to the login wall once the threshold is exceeded | S1.8 `-> unit/api` |
| X5 | **Edge auth model change made explicit** | S1.8 enabler + S0.9 |
| X6 | **Client-side image pipeline**: R2 stores only finished assets; shared items strip EXIF by default | S4.2/S4.6/S4.7 |
| X7 | **SW/SSR bypass rule**: network-first for `/s/:id` and `/anime/:id` | S3.6/S4.3/S5.1 `-> browser` |
| X8 | **Layered eval, permanently on**: 5 smoke cases as a PR gate, all 617 nightly | S0.1; a dependency of S7.1 |
| X9 | **D7 both REJECTED** | See the D7 row |
| X10 | **Platform capability adaptation layer**: camera/geo/haptics/wake-lock/clipboard-share | S1.3/S2.5/S3.3/S4.2/S4.6 |
| X11 | **SDK strategy**: ①② are already folded into G4; ③④⑤ expand into S7.5/S7.6/S7.7, MCP adds S7.4, all scoped down to SD-12's task-shaped capability. **Release order backfilled from SD-25**: single source of truth = `packages/contract` zod→OpenAPI + `/v1`, all four shells (Skill/MCP/A2A/SDK) are thin adapters; Iteration 7 landing order = ① Claude Skill (zero new infrastructure — SKILL.md + `seichijunrei_client.py` moves into `scripts/`) ② a quick, coarse-grained MCP server (`FastMCP.from_openapi`) ③ **A2A deferred** (→ DD-10 frozen). Tech-debt cleanup done along the way: the 9 tools' `dict[str,object]` returns → Pydantic models |
| X12 | User-domain enabler ownership — superseded by SD-2 | See G4, SD-2 |
| X13 | Migration toolchain — superseded by SD-1 (Atlas SQL authority; Drizzle query/type metadata only) | See SD-1 |
| X14 | Edge worker graduation — corrected by SD-6 (already TS + 16 test cases — **measured 2026-07-07: 11 in `worker/entry.test.ts` + 5 in `worker/auth.test.ts` = 16**, superseding the earlier "15" figure in the inputs SD-6 line; the only gap is CI) | S0.3 |
| X15 | **Catalog data-quality gate**: coordinate validation/dedup/episode-count completeness + volume-drift alerting | S5.8 |

### SD Interview conclusions (inputs §7-11 govern; **Finalized**; see the full text of inputs §7-11 for details, this section is only a one-line index + key deltas)

| Round | Conclusion |
|---|---|
| SD-0 Domain | **`animichi.com` Finalized**; `aninavi.app` either 301s or is left non-blocking; kitsunavi.com kept as a brand-upgrade backup → DD-20 frozen |
| SD-1 Migration chain | `migrations/neon/*.sql` plus generated `atlas.sum` are authoritative; Drizzle is query/type metadata only; Supabase migrations remain auth/legacy compatibility; boundary written up in `docs/ops/migrations.md` (S0.9) |
| SD-2 User-domain access | API-first, `/v1/users/*` oRPC (`workers/users`); the **Neon Auth SDK** is auth-only (SD-31 — was `supabase-js`) |
| SD-3 Data plane | Data plane moves to Neon (5 sub-points, D8); ⑤ the auth migration is now **activated by SD-31 (→ Neon Auth)**, no longer DD-1 frozen |
| SD-4 Agent runtime | Python FastAPI container, Finalized, not up for further debate (D7) |
| SD-5 Session state | Iteration 1 keeps the current endpoints, best-effort, migrates to Neon alongside SD-3④ |
| SD-6 Edge worker | Already TS + 16 test cases (**measured 2026-07-07: `entry.test.ts` 11 + `auth.test.ts` 5 = 16**; this is the authoritative count, correcting the "15 用例" figure in the inputs SD-6 line); the only gap is wiring CI (S0.3) |
| SD-7 Cognitive loop | **Final (user-confirmed)**: single-tool loop (native tool-calling, ReAct lineage) + typed final output + the `ModelRetry`/`output_validator` double guard + deterministic bypass; intent accuracy is handled via eval-driven tuning, no architectural rework (D14); a routing-layer rework → DD-2 frozen |
| SD-8 Session memory | Per-session + a session list; `user_memory` dormant (D15); waking it up → DD-3 frozen |
| SD-9 Streaming protocol (**revised version, backfilled from §10 Step 2, superseding the old "three-event SSE" proposal below**) | **The AI SDK UI message-stream protocol is Finalized**: on the backend, pydantic-ai's official `VercelAIAdapter` (`/v1/chat` already runs this); on the frontend, AI SDK v7 `useChat` (inside TanStack). Semantic mapping: step badges ← the tool-parts state machine; progressive cards ← data parts overwritten in place by ID; the waiting ritual/fox mood ← derived by a frontend state machine; final state + disconnects ← the `finish` event + the P6 `GET` fallback (freely reuse AI SDK's native resume support wherever it fits). The project's own contract narrows to a zod schema for custom data parts (in `packages/contract`). Iteration 1 spike: whether typed output can stream out progressively through `VercelAIAdapter` — if not, fall back to the backend actively pushing data parts between tool calls. Unify on `/v1/chat`, retiring the custom-SSE `/v1/runtime/stream`; no dual protocols left standing. **Note**: P6 (turn_id/seq/disconnect-semantics details) is now **Finalized (finalized 2026-07-07, per the P3 patch)**, restated in this protocol's terms, see below |
| SD-11 BYOK scope | pydantic-ai's native multi-provider support, first release covers three families (OpenAI-compatible/Anthropic/Gemini), per-request model override, X3 scrub applies across all families |
| SD-12 Outward-facing capability shape | **Iteration 7 capability shape = task-shaped**: `resolve_anime` / `search_points` / `plan_pilgrimage(anime, constraints)`, stateless, idempotent, cacheable; Workers thin adapter → the same `/v1` contract; exposed via MCP; A2A → DD-10 frozen (per C6d ruling: softened from an earlier "MCP/A2A" pairing, since A2A has since been deferred per SD-25③); **no direct chat pass-through exposed** |
| SD-13 Generative UI (§10 Step 1, backfilled) | **Philosophy A is Finalized**: semantic payload + an app-owned registry (backed by industry precedent: MCP Apps/AI SDK7/A2UI). Three rules: ① append-only card stream (E1); ② additive-only versioning, governance modeled on MCP's deprecation policy (Active/Deprecated/Removed, ≥12 months); ③ partial-tolerant components. `presentation_hint` = a server-suggested value + frontend has final say + unknown values degrade gracefully. Iteration 7 adds a minimal MCP Apps subset (`@mcp-ui/server`; ChatGPT-specific field extensions → DD-19 frozen). **Supersedes/replaces the old P10** (additive-only evolution); see the security quick-reference table below |
| SD-15 Session memory refinement (§10 Step 3, backfilled) | See the D15 row above for the full content |
| SD-16 Fox persona (§10 Step 4, topic 1, backfilled) | **Version A, a restrained first-person fox + the name unified as Animichi** (backed by a 23-line tone-sample copy library). The cry "kon" (コン) is downgraded to a pet name/easter egg (a pun exclusive to Japanese, with no equivalent in Chinese or English). Trilingual rendering: Japanese "アニミチだよ/コンって鳴く" ("I'm Animichi / I go 'kon'"), Chinese "我是 Animichi,带你巡礼的小狐狸" ("I'm Animichi, the little fox who'll guide your pilgrimage"), English "I'm Animichi, your pilgrimage fox." Five persona rules: ① when named, never uses 私/僕 (humble/masculine "I") in Japanese; ② casual register by default, switching to polite register for disclaimers/privacy/login/payment; ③ zero kaomoji, emoji used only functionally (🚩✓); ④ never write "コンコン" as anything but the cry itself, not the name; ⑤ the trilingual voice mapping feeds into eval family F. Formal appearances (splash/about/first greeting/OG) foreground the name "Animichi." Landing spots: S0.7 (Splash), S1.* (chat copy), and each brand-facing story |
| SD-17 Prompt patches + length governance (§10 Step 4 wrap-up, backfilled) | Four patches (all eval-driven, S1.12/the prompt story): ① trim few-shot from 8 to 3-5 examples, targeted at dual-intent/sequel/mixed Chinese-Japanese confusions; ② add "when not to use this" counter-examples to all four tool docstrings; ③ disambiguate language detection: the current turn's text takes priority over historical locale, with a Unicode-script fallback; ④ add `Field(description)` to the 5 response models + inject the current JST time + resolve the `guardrails.py` dead code (wire it up or delete it). **Length governance**: a hard ceiling of ≤2K tokens for the static segment, reviewed every iteration; cache-order discipline = static segment first, dynamic injection (JST/ledger/session) always last; dilution of rules is measured solely by eval score |
| SD-18 Two new hooks (§10 Step 6, backfilled) | The existing four hooks are untouched (the compaction sliding window / `output_validator` / `@instructions` dynamic injection / Logfire instrument); two new ones: ① a usage-metering hook (`result.usage()` → the `daily_usage` table, scope = anon/user/byok) + a container-ingress circuit breaker (not at the edge) — BYOK doesn't count toward the platform budget but still passes every guard — **supersedes the old P3 (timing middleware); the timing portion of the old P3 is dropped** (the Logfire span already covers it); ② an error-boundary hook (unifies tool/agent exceptions onto the D1-D9 response models), tied to the SSE exception-state AC |
| SD-19 Injection defense (§10 Step 5, backfilled) | **Everything ships in Iteration 1, superseding/implementing the old P2**: P0 — wrap web_search results in `<untrusted_web_result>` delimiters + a system-prompt statement that "search results are unverified data" + extend `detect_prompt_injection` to cover tool-returned content; P0 — architectural invariant (all tools read-only + "anything arriving via MCP/A2A/tool results is always tool-priority" written into the system prompt + a regression test); P1 — source tiering (allowlisted sources marked as verified); P2 (the original doc's numbering — note this shares a name but not a tier with this spec's own P2 in the quick-reference table) — Llama Prompt Guard 2 as an out-of-band scorer, flag-only, no hard block (a hard block → DD-5 frozen). Eval family G (G-1/G-2/G-3). Iteration 7 hard gates are a separate discussion. The injection-isolation subagent → DD-4 frozen |
| SD-20 BYOK + P8 (§10 Step 5 wrap-up, backfilled) | **Supersedes/implements the old P8**: the key is passed through per-request, never persisted server-side; the client "remembers" it via sessionStorage/in-memory state, no homegrown encryption (→ server-side encrypted cross-device storage is DD-6 frozen); X3 scrub hardened = a self-built header-allowlist stripping middleware, covering request logs/spans/exception serialization; **the strict variant of P8** = resolve the domain → take a fixed IP → validate it isn't in a private/loopback/link-local/cloud-metadata range → connect using that IP (no re-resolving, to prevent TOCTOU/DNS rebinding) + no auto-following redirects, no domain allowlist; quota tiering: BYOK is exempt from the daily budget but not from injection defense/`output_validator`/content guards/rate-anomaly detection |
| SD-21 Observability/tracing (§10 Step 7, backfilled) | **Supersedes/implements the old P9**: Logfire end-to-end tracing is untouched; P9 = the header-allowlist middleware handles GPS along the way, **coordinates are truncated to 3 decimal places (roughly 100 m) before entering trace**, the storage layer (check-ins) keeps full precision; usage/cost is already in spans (no duplicate build); Iteration 7 adds trace splitting by caller dimension as a quick win |
| SD-22/23 Flywheel scheduling (§10/11, backfilled) | All five flywheels share one instrumentation fuel tank (from Iteration 1 on). Flywheel 1, agent quality (spins up fully from Iteration 1: trace → the `eval_candidates` table → human review → the official set); Flywheel 2, intent taste (fields only instrumented in Iteration 1, analyzed in Iterations 3-5); Flywheel 3, UGC→catalog (schema placeholder instrumented in Iteration 1, the review pipeline → DD-7 frozen); Flywheel 4, SEO growth (Iteration 5, see SD-27); Flywheel 5, memory personalization (dormant → DD-3 frozen). **The self-evolve boundary**: any ingestion/write/gate change always requires human approval — no unattended closed loop |
| SD-24 Subagent + mcp-client (§10 Step 8, backfilled) | See the D17 row above (the subagent portion); mcp-client (consuming third-party MCP as a client) is deferred until actually needed → DD-8 frozen; no runtime-internal skill framework is introduced (YAGNI, trigger = tool count growing past 20+ → DD-9 frozen) |
| SD-25 External release shape (§10 Step 8 wrap-up, backfilled) | See the X11 row above; single source of truth = `packages/contract` → OpenAPI+`/v1`, all four shells are thin adapters; order = Skill → MCP → A2A deferred (→ DD-10 frozen) |
| SD-26 Image search, two phases (§11, task #7, backfilled) | Text RAG is not introduced. Two phases: ① LLM-vision coarse screen to identify the anime (Iteration 1, the chat "photo" state, goes through the existing `resolve_anime`; unrecognized cases fall back to clarify); ② precise scene/shot-angle (機位) matching within an identified anime (Iteration 4, embedding coarse screen [standard] + LLM-vision fine ranking as the workhorse, series-merged scale 1000+, the anime-matching unit = series). Three-layer reverse discovery (direct world-knowledge recognition → nearby GPS search → whole-library vector search); layer 3/an ANN index/contrastive fine-tuning are all → DD-11/12/13 frozen. The five-signal image-search instrumentation (query_type/gps_available/layer_hit/candidates_shown/user_confirmed) goes into the Iteration 1 full-instrumentation list. **The pipeline supplement (D1-D6, inputs §11) is Finalized**: D1, orchestration — phase 1 stays a standalone vision call, phase 2's `match_scene` collapses into a single-tool, internally deterministic pipeline (coarse screen + fine ranking in one pass, no added LLM orchestration layer); D2, the indexing pipeline belongs to catalog (embeddings are produced alongside the Anitabi sync pipeline, stored as halfvec in Neon); D3, `match_scene` is this project's first "tool that internally makes an LLM call" (cost flows into `daily_usage`; fine ranking prefers the user's BYOK key, otherwise a platform key; capped at ≤2 batches per query); D4, a vision-supply decision tree branching on BYOK vision capability; D5, the general rule for onboarding any new BYOK capability = capability probe + a runtime canary + graceful fallback; D6, a hard AC for visual-channel injection defense + a per-use quota |
| SD-27 SEO/GEO (§11, task #8, backfilled) | The landing package → `docs/archive/specs/2026-07-06-seo-geo-plan.md`. Highlights: the anime page `/anime/:id` is the SEO workhorse (SSR); points don't get their own pages (→ DD-14 frozen); robots block training crawlers while allowing search/citation/agent crawlers; **llms.txt is downgraded to a single static page, the llms-full pipeline is dropped** (a non-goal, superseding the old Iteration 7 mention of `llms-full.txt`); JSON-LD narrows to Organization/WebSite/BreadcrumbList + page-level geo, **no FAQPage schema** (already de-listed); trilingual subpaths /ja /zh /en + hreflang + a hard AC for per-language localized title/H1/slug; MCP-as-GEO lands in Iteration 7; the quality gate = X15 + a template-ratio check; the full iteration mapping is in seo-geo-plan.md §7, the non-goal list is in §8 |
| SD-28 Route-planning tiers (§11, task #11, backfilled) | **Finalized (the layered scheme)**: tier 0 = haversine × a 1.3 detour factor (Iteration 1; **per the P3-patch dual-route unification, this coefficient lands in the TS `workers/catalog/src/lib/route.ts`, not the Python `route_optimizer.py` — route ordering is unified onto the catalog and `route_optimizer.py` is retired**, see the S1.5/S1.7 enablers and the Patch P3 note below); tier 1, the walking segment = self-hosted OSRM/Valhalla + OSM (moved to Iteration 3, riding along with Walk's polyline rendering/barrier detection, rather than for Iteration 1's time-precision purposes); tier 2 = rail-topology estimation, 100% self-built with zero third-party ToS exposure (ekidata.jp as the topology's primary source + the national geographic survey's N02 line geometry + Shinkansen completion, shortest path via Dijkstra; suggested to land in Iteration 2, adjustable at double review). Precise timetables route out to Jorudan/Google Maps deep links (an in-the-moment travel concern). Tier 3, timetable-level transfers → DD-21 frozen. Acceptance: nearest-station coverage across the whole catalog ≥99% (unit); estimate vs. Jorudan ground truth across 20 popular anime routes, P80 error ≤±10 min (eval); instrumentation: transit_leg_shown / deeplink_clicked. The Google Routes API is out — not on pricing but on ToS grounds (it forbids long-term caching of transit results) |
| SD-29 Retrieval architecture, overall stance (§11, task #12, backfilled) | **Finalized = "structured-data-first agentic retrieval"**: the existing tool loop (autonomous retrieval decisions + `ModelRetry` self-correction + multi-hop resolve→search→plan + `output_validator`-grounded generation) is already a textbook agentic-RAG shape; no RAG framework (LangChain/LlamaIndex/Haystack) is introduced. Retrievers are assigned by data shape: structured data (points/geography/anime relationships) → SQL/PostGIS (vectorizing this is rejected); visual → vector coarse screen + LLM fine ranking (SD-26); external web content → web_search (SD-19 injection defense); long-form UGC text → no such data exists yet (→ DD-22 frozen). Embedding convention: always uses the system's own key, never BYOK |
| SD-30 Eval-system overhaul (§11, task #13, backfilled) | **Finalized**: two orthogonal axes — a trigger axis (L0 smoke test / L1 full suite / L2 adversarial / L3 domain-specific) + a dimension axis (outcome + **new trajectory-level deterministic assertions**: the expected-tools set/order, repeated-call detection, a step cap — filling the biggest gap). The statistical threshold is upgraded from a bare "baseline − 2 points" cutoff to **layered bootstrap 95% CI + paired comparison**. **The model-switch gate runbook (item ④)**: full outcome+trajectory eval → a CI comparison + a score/¥ report → key-family CI floor no worse than baseline → human sign-off (this is the concrete basis for D16's model-switch gate). Archival moves to Logfire Experiments. Judge discipline: qwen3.5-9b is an out-of-band coarse filter, not a semantic authority; a future authoritative judge (eval family F) must first pass a 50-case human gold-standard calibration. ~~The pydantic-evals migration → DD-23 frozen.~~ **Superseded by `2026-07-14-agent-modernization.md` §4.** **The spec's language convention (per the same-day user instruction)**: the 9 spec files + seo-geo-plan.md are in English (engineering deliverables for the executor/reviewer); inputs/base ledgers/conflicts/the DD registry stay in Chinese (discussion ledgers) |
| SD-31 Auth backend (Neon Auth) | **Finalized (2026-07-07, user call, ADR-level propagation)**: the auth backend = **Neon Auth (Better Auth v1.4.18 base)**, retiring Supabase auth-only and converging on all-Neon; this **activates and upgrades SD-3⑤** (was DD-1 frozen). Rationale: ① the base swapped from the then-rejected Stack Auth to the mature **Better Auth v1.4.18**, so the original rejection reason has expired; ② full auth-method coverage — **magic-link built in** (what the product uses today) / email OTP / Google·Apple·X built in / **LINE via the Generic OAuth plugin** (same effort as the self-built Supabase Edge Function, not a blocker); ③ **the killer feature = every Neon branch carries its own isolated auth environment** → the multi-env/preview (per-PR/staging) identity-isolation problem disappears (echoes D10 + `infra/pr-preview-env`: a Neon branch brings its own identity + data); ④ auth data lands in Neon (`neon_auth` schema, **native RLS**), **one system replaces two**; ⑤ **already enabled** (Neon Auth `better_auth` mode, since 2026-06-23); worker/agent verify against its **JWKS**, the endpoint supplied via `NEON_AUTH_JWKS_URL` (env/secret-injected — the endpoint hostname / project-id are **not committed to this public repo**). Cost: Beta (GA approaching); AWS regions only (our deploy region is covered ✓). **Migration boundary**: provisioning is already done via CLI (`neonctl neon-auth`); the **code integration** (login UI on the Neon Auth SDK, worker/agent JWKS verification, Neon RLS policies) = **iteration stories during the apps/web rebuild** (S0.6 login / S1.7 login-wall / S1.8 anonymous / the `workers/users` JWT verification in S2.8·S3.7·S4.5) — **the legacy frontend is not touched**; Supabase auth retires once the integration lands, migrating real users if any exist. **Amends prior SDs**: SD-2 / SD-6 / G4's "`supabase-js` is auth-only" → "**the Neon Auth SDK is auth-only**"; the `workers/users` bearer JWT changes from Supabase-issued to **Neon Auth-issued, verified against the Neon Auth JWKS**; SD-3②③④ (build user-domain tables in Neon / freeze the Supabase catalog tables / migrate session·message data to Neon) are unchanged; the still-out-of-scope tail = fully retiring the Supabase auth project + real-user migration + deleting the Supabase catalog tables. **Now aligned within iter-0**: the iter-0 domain story (#252 / S0.8) configures the auth callback/redirect + magic-link email template; its **auth backend is flipped to Neon Auth here** (S0.8's checklist item 5 / the domain-wrap-up AC / Files-changed), because S0.6's login integration is itself an iter-0 story — so the earlier "moves to Neon Auth when the auth-integration story lands" framing was imprecise (that story *is* iter-0). What genuinely stays as a manual-ops follow-up for the #252 owner is the **product-domain** migration itself (onboarding `animichi.com` to Cloudflare, the old-domain 301 rules, GSC/Bing property changes) — registrar/DNS ops, not auth-backend config |

**Supplementary code-level evidence verified by the Planner**:
- `packages/contract/scripts/emit-openapi.ts` currently covers only `catalogContract`; SD-2's `/v1/users/*` contract is an entirely new addition.
- `apps/agent/agent/agents/selected_route.py` lines 30-31/33 confirm the cross-database read path referenced by SD-3① (`SupabaseClient` reads points, out of sync with the Neon/CatalogClient path used by the same-session search flow).
- `apps/agent/pyproject.toml` line 46 declares `pydantic-ai-guardrails>=0.2.2`, with zero imports anywhere in the repo — **confirmed dead dependency** (this finding came from the Planner's own code audit and isn't affected by the P-series "proposal under discussion" status; see S1.6/S1.12 for how it's handled).
- `/v1/chat` currently uses `VercelAIAdapter` — **corrected by Backfill A (2026-07-06 evening)**: an earlier version of this doc flagged this as "not quite matching the SD-9 three-event naming," a risk item. Since SD-9 has been revised so that the AI SDK UI message-stream protocol itself *is* `VercelAIAdapter`, the two are now aligned — this is no longer a risk needing reconciliation, it's simply the existing correct implementation. S1.1/S1.2's job becomes "confirm the existing `/v1/chat` endpoint matches the revised SD-9's semantic mapping and fill in the custom data-parts schema," not "reconcile protocol ownership."

### Global convention: platform capability adaptation layer (X10, Finalized)

`apps/web/src/platform/` establishes a thin interface layer wrapping camera / geo / haptics / wake-lock / clipboard-share; **product components may never call `navigator.*` directly**. Any story touching camera/location+vibration/clipboard/share requires an AC of "goes through the adaptation layer" `-> unit`.

### Global convention: user-domain data access path (SD-2, Finalized)

A user's own data is always accessed through the **newly built `workers/users` TS service**'s oRPC routes (`/v1/users/*`), landing in **Neon**, with the contract in `packages/contract`. `apps/web`'s auth client is the **Neon Auth SDK (Better Auth)** (SD-31), **auth-only**.

### Global convention: Chat streaming protocol (**the revised SD-9, Finalized, backfilled from inputs §10 Step 2, superseding this section's earlier "three-event SSE" wording** + the P6 disconnect-semantics detail, now Finalized 2026-07-07)

**The Finalized portion**: the protocol is the AI SDK UI message stream, backend pydantic-ai's official `VercelAIAdapter` (`/v1/chat` is already this implementation today), frontend AI SDK v7 `useChat` (inside TanStack Start). Semantic mapping: step badges ← the tool-parts state machine; progressive cards ← data parts overwritten in place by ID; the waiting ritual/fox mood ← derived by a frontend state machine (not a field the protocol carries natively); final state ← the `finish` event. The project's own contract narrows to **a zod schema for custom data parts** (in `packages/contract`), no longer a standalone three-event schema. Generative registry components are designed partial-tolerant from day one (carrying forward SD-13 rule 3); the protocol must be able to degrade gracefully; the discriminated union's `intent` field must arrive ahead of the other fields (this constraint carries over unaffected by the protocol change). Iteration 1 spike: confirm whether typed output can stream out progressively as data parts through `VercelAIAdapter`; if not, the backend pushes data parts actively between tool calls instead. Standardize on `/v1/chat`; the existing custom-SSE `/v1/runtime/stream` retires once the chat migration completes, leaving no dual protocol.

**The P6 portion (inputs §8, restated in AI SDK protocol terms; Finalized 2026-07-07 per the P3 patch's "spec 收口三件" ruling)**: custom data parts additionally carry `turn_id`+`seq`; **no resume-on-disconnect support** (no SSE Last-Event-ID–style resumption — a run can't be picked back up mid-way; AI SDK's native resume capability is preferred wherever it can be reused directly rather than building our own); after a disconnect, the client calls `GET messages` to fetch the final state rather than attempting to resume the stream; a generation interruption shows in the UI as a D-series exception-state card (D4) with retry. This detailed mechanism is written into the ACs for S1.1/S1.2/S1.6 and is now Finalized exactly as written — the user has confirmed the "no resume-on-disconnect" trade-off, so it may serve directly as a merge-blocking gate.

### Global convention: the Generative UI constitution (**Finalized — the core philosophy backfilled from SD-13; the URL allowlist clause is likewise Finalized per the C6a ruling**)

- **Finalized (SD-13, Philosophy A)**: the LLM can **only** pick an already-registered component type from the registry + fill in a structured semantic payload; the app's own registry handles rendering, and the LLM **never generates UI code**. Three rules: ① an append-only card stream; ② additive-only versioning (governance modeled on MCP's deprecation policy: Active/Deprecated/Removed, ≥12 months); ③ partial-tolerant components (may omit fields + a skeleton slot; Storybook builds half-populated and legacy-payload stories). `presentation_hint` = a server-suggested value + the frontend has final say + unknown values degrade gracefully.
- **Finalized (per the C6a ruling, grounded in SD-19's same-origin injection-defense requirement)**: any URL appearing inside a payload **may only** render from a catalog data source or an explicit allowlist source. This clause is the rendering-layer, same-origin corollary of SD-19's injection-defense architectural invariant (external content must be delimited and treated as untrusted) — SD-13's registry philosophy together with SD-19's same-origin requirement already cover this clause jointly, so no additional dedicated user confirmation is needed.
- This clause is written into the Reviewer checklist for the Iteration 1/6 component stories as a hard merge-blocking gate.

### Global convention: security/privacy hard-item overview (**updated by Backfill A, 2026-07-06 evening**: P2/P8/P9/P10 were each promoted to Finalized after being walked through in the subsequent §10 rounds, P3 has been rescinded and superseded; **updated again by the P3 patch, 2026-07-07**: the last two items — P6 and the message-length cap — are now Finalized (finalized 2026-07-07), so every row below is Finalized; quick-reference table)

| Hard item | One-liner | Main landing spot | Status |
|---|---|---|---|
| P2 | External content (web_search, etc.) entering context must be delimited + marked untrusted | S1.12 | **Finalized (backfilled from SD-19)** — `<untrusted_web_result>` delimiting + a system-prompt statement + `detect_prompt_injection` extended to cover tool-returned content + an architectural invariant (tools are read-only + results can never be promoted to instructions) + source tiering |
| P3 | ~~A tool-boundary timing + token-cost-accumulation middleware, feeding the X4 circuit breaker~~ | S1.12 | **Rescinded, superseded by SD-18's usage-metering hook** — the original timing portion is dropped (the Logfire span already covers it, avoiding duplicate build), replaced by `result.usage()` → the `daily_usage` table + a container-ingress circuit breaker |
| P6 | SSE events carry turn_id+seq, no resume on disconnect, fetch final state after a disconnect, D4 exception card with retry | S1.1/S1.2/S1.6 | **Finalized (finalized 2026-07-07, per the P3 patch)** (restated in terms of the revised SD-9's AI SDK protocol, see the "Global convention: Chat streaming protocol" section) |
| P8 | Outbound-request SSRF guard (https-only + block private-net/loopback/metadata IPs) | S1.11 | **Finalized (backfilled from SD-20)** — the strict variant with post-resolution IP validation (no re-resolving, preventing TOCTOU/DNS rebinding; no auto-following redirects), no domain allowlist (an allowlist would kill the core BYOK use case of self-hosted vLLM/relay providers) |
| P9 | Precise GPS never enters Logfire, truncated to ~100 m, storage layer keeps full precision | S3.3 | **Finalized (backfilled from SD-21)** — coordinates are cut to 3 decimal places before entering trace; implemented as a side effect of the header-allowlist middleware |
| Message-length cap | A cap on the length/type of user input messages (a Guardrails addendum); env `MESSAGE_MAX_CHARS`, initial value 4000 (initial value; executor may tune with evidence) | S1.12 | **Finalized (finalized 2026-07-07, per the P3 patch)** |
| P10 | payload schema_version + additive-only evolution + versioned degrade-gracefully rendering | `packages/contract` + S1.1/S1.3-S1.5 | **Finalized (backfilled from SD-13 rule 2)** — additive-only versioning, governance modeled on MCP's deprecation policy (Active/Deprecated/Removed, ≥12 months) |

**Guidance for the Coordinator**: **every** entry above is now Finalized and can serve directly as a hard merge-blocking gate — the last two items (P6 and the message-length cap) were confirmed by the user on 2026-07-07 (the P3 patch's "spec 收口三件" ruling), so there are no longer any items requiring a review-stage user sign-off pass.

### Defaults set by the main session (the Finalized portion)

- PR #206 (the atlas CI fix) is listed as an **Iteration 0 prerequisite** — see §10.
- `animal-island-ui-tailwind` upgrades to the **latest 1.0.x**; compatibility verification lands in S0.2/S0.5.
- **Self-importing Zen Maru Gothic is a hard AC.**
- D7 (REJECTED), D9/D10 (non-goal), and actually deleting the Supabase catalog tables — none of these are touched in this train. **SD-3⑤ (the auth migration) is now activated by SD-31**: the Neon Auth code integration lands in this train's auth stories, while fully retiring the Supabase auth project + migrating real users stays out of scope.
- Capacitor is deferred until after the loop closes.
- **Domain finalized as `animichi.com` (SD-0)** — the `CANONICAL_DOMAIN` config key name stays; its value is `animichi.com` starting at S0.8.
- The design exports are already checked in, serving as the Tester's visual baseline (oracle).
- **Planner's supplementary defaults (Finalized, this spec's own call)**:
  1. `apps/web`'s coverage floor is set starting from the value measured at Iteration 0.
  2. The R2 bucket reuses the single existing bucket `seichijunrei-assets`, distinguished by prefix.
  3. `workers/catalog` adds a small number of new public read-only routes in Iteration 5 (an `isPublicCatalog` allowlist pattern), needs eng-review sign-off.
  4. Existing agent data endpoints are not required to migrate or be removed in this train.
  5. The `pydantic-ai-guardrails` dead dependency gets a binary choice (wire it up or remove it); the Planner recommends removal — this came from the Planner's own code audit, independent of any pending-confirmation tier, and needs no further user confirmation.
- **No internal skill framework** — already promoted to Finalized item-by-item via SD-24③ (YAGNI, trigger = tool count growing past 20+ → DD-9 frozen).
- **An MCP client (the agent actively consuming third-party MCP capability, distinct from Iteration 7's outward-facing MCP server) is deferred until real demand appears** — already promoted to Finalized item-by-item via SD-24② (→ DD-8 frozen).

### Defaults set by the main session (other minor scattered points in inputs §8 — settled defaults, not requiring user sign-off; **updated by Backfill A**: the MCP client/internal skill framework have moved up to "the Finalized portion" above; what's left here is only the scattered points not covered by any subsequent round)

- Prompts stay managed in-code (no separate prompt-management system).
- Sampled scoring of production sessions — → **DD-17 frozen** (triggered by ops bandwidth + session volume ≥500/week; not a work item for this train).
- The `greet_user`/`answer_question` pseudo-tool quirk (they're really output shapers) is recorded as-is, not refactored.

### The user's additional scope (SEO/GEO + the coverage matrix) has been allocated across iterations; see the iteration-train table and §6.

---

## ③ Iteration Train Overview

| Iter. | Theme | Stories | Detail level | Core deliverables | File |
|---|---|---|---|---|---|
| 0 | Foundations | 10 | Fully detailed | The apps/web skeleton + deploy-chain fixes (worker/** CI wiring) + the map ADR + layered eval + the DS foundation + spike code migration + old-frontend removal + SEO foundations (**backfilled from SD-27**: the full animichi.com domain-migration checklist + a static robots.txt/llms.txt page + a sitemap skeleton + an IndexNow key + GSC/Bing/CF Analytics + Organization/WebSite/BreadcrumbList + a hard AC for CF crawler reachability, see `2026-07-06-seo-geo-plan.md` §7) + doc rewrites (`docs/ops/migrations.md`) + **contract enforcement + hygiene sweep (S0.10, backfilled from the P3 patch / `2026-07-07-refactor-backlog.md`: catalog adopts `implement(catalogContract)` + F2-F6 hygiene batch + dead eval-dataset/TODO cleanup)** | `2026-07-06-frontend-rebuild/iter-0.md` |
| 1 | 計画 (Plan): Chat | **13** | Fully detailed | Chat Phase 1's full single-column-stream state set (44 states) + the **AI SDK UI message-stream protocol** (the revised SD-9, Finalized, superseding the old "three-event SSE" wording, P6's disconnect semantics now Finalized 2026-07-07) + opening up anonymous use/quotas/Turnstile/BYOK's three provider families (SD-11 Finalized, each its own story) + the P5 login wall + a hard first-token SLO + the `selected_route` cross-database bug fix + **hardened agent guardrails** (S1.12, including SD-19 injection defense [Finalized] + SD-18's two new hooks [Finalized] + the message-length cap [Finalized 2026-07-07, env `MESSAGE_MAX_CHARS`, initial value 4000] + paying down the guardrails dead dependency) + image-search phase 1 (SD-26, the chat "photo" state, LLM-vision coarse screen to identify the anime) + full instrumentation (the fuel tank for flywheels 1-5 + the five image-search signals, SD-22/23/26) | `iter-1.md` |
| 2 | Follow-through: details + list | 10 | Fully detailed | Route details v2 + the マイルート (My Route) bookshelf view + the save/list enabler (`workers/users` oRPC + Neon) + sessions data migration; the anime page's fact ledger (SD-15) fields accumulate alongside chat | `iter-2.md` |
| 3 | 歩く (Walk) | 10 | Detailed before kickoff | The Graduation transition + Walk's 10 states + offline all-at-once + the check-in enabler (`workers/users` oRPC + Neon, including **SD-21's Finalized** GPS truncation: cut to 3 decimal places/~100 m before trace, full precision in storage) + the fox trot sprite + conversation_messages data migration | `iter-3.md` |
| 4 | 残す (Keep): しおり | 9 | Detailed before kickoff | The しおり (keepsake booklet) layout family (a client-side image pipeline, EXIF stripped by default) + `/s/:id` public sharing (SSR, dynamic OG backfilled from SD-27) + 対比図 (comparison-diagram) creation (client-side canvas) + R2 upload + image-search phase 2 (SD-26, precise scene/shot-angle matching within an anime: embedding coarse screen + LLM-vision fine ranking) + a 対比図 image sitemap (SD-27) | `iter-4.md` |
| 5 | 発見 (Discover): anime pages + homepage | 10 | Detailed before kickoff | The anime public page, variant A, encyclopedia-style (SSR) + new public catalog oRPC routes + the data-quality gate (X15) + the homepage (続きから depends only on the sessions/routes lists) + programmatic SEO/GEO (**backfilled from SD-27**: trilingual fact-summary blocks + narrowed JSON-LD + region pages + a new-season sitemap SLA + the quality gate wired into CI, see `2026-07-06-seo-geo-plan.md` §7) + flywheel 2 (intent taste) and flywheel 4 (SEO growth) begin analysis (SD-22/23) | `iter-5.md` |
| 6 | Workbench | 6 | Detailed before kickoff | Chat Phase 2's desktop two-column layout (a persistent map/lightbox/SP8/SP9) | `iter-6.md` |
| 7 | Open API | 9 | Detailed before kickoff | Unlock the eval gate + **external release order per SD-25**: the agent skill (first) + a quick, coarse-grained MCP server (**A2A deferred, → DD-10 frozen, not done in this iteration**) + MCP (Finalized per SD-12: task-shaped capability, a Workers thin adapter) + publish the OpenAPI spec + an npm SDK + the Python client graduates + a minimal MCP Apps subset (SD-13) + MCP-as-GEO submissions (SD-27: MCP Registry/mcp.so/Glama/an isitagentready self-check) + llms.txt gets an MCP-endpoint addendum (**no llms-full.txt, backfilled from SD-27's non-goal list, superseding the old version's mention of llms-full.txt here**) | `iter-7.md` |

**Dependency chain**: Chat produces routes → details/list follow through on saving → Walk walks the route → しおり keeps the outcome → 発見 draws in newcomers → the workbench raises efficiency → the open API faces outward.

**Note on story counts exceeding the "3-8" guideline** (re-synced to the actual per-iteration story files): Iteration 0 (10 — adds S0.10, the contract-enforcement + hygiene sweep, backfilled from the P3 patch) / Iteration 1 (13 — the anonymous-use work split four ways + the 44-state set + the S1.12 guardrails story + the SD-30 eval-infra enabler S1.13) / Iteration 2 (10, save/list enabler + data migration each their own story) / Iteration 3 (10, offline + check-in enabler + data migration each their own story) / Iteration 4 (9, image-search phase 2 splits into its own stories) / Iteration 5 (10, area pages + the CI quality gate expand it) / Iteration 6 (6) / Iteration 7 (9, the SDK/MCP/MCP-Apps work expands; the S7.3 frozen placeholder is not counted) — all have been individually verified as "completable by a single executor in a day."

---

## ④ Releasable Definition

Every story must satisfy the following once merged to main:

1. CI fully green (lint + typecheck + test + the coverage ratchet, with no new suppression comments).
2. Tagging deploys straight to prod, no extra manual steps.
3. **No dead-end UI** after deploy — every visible entry point either has a real implementation or renders the design's degraded/empty state; never a bare white screen or a bare error.
4. `/healthz`'s `git_branch` field can verify the deploy landed at the right commit.
5. Visuals match the corresponding canvas — the Tester screenshot-compares against the design source, state by state. **Comparison mode (per SD-30 review, Codex P2)**: the gate is **exact state coverage** (every documented state for the story family is rendered and captured at the two reference viewports — mobile 390×844 and, for the workbench/desktop families, 1280×800) **plus a manual design-approval checklist** — the Tester confirms each state visually matches its canvas oracle. No automated pixel-diff percentage threshold is imposed, because the design canvases are HTML mockups (living oracles), not pixel-identical targets; the escape hatch is explicit human design sign-off recorded in the Tester's iteration walkthrough.
6. Trilingual (ja/zh/en) copy is complete.

**Note**: there are no longer any pending-confirmation ACs. The last two (P6, the message-length cap) were Finalized by the P3 patch on 2026-07-07, and D16/D18/D19 plus the Generative UI constitution's URL allowlist clause were Finalized earlier by the C6 ruling — so every AC in the package is a Finalized, blocking condition for Releasable status. (Historical note: this clause previously carved out pending items as non-blocking; that carve-out is now empty.)

---

## ⑤ Global DoD

On top of ④ (the Finalized portion):

- Every AC carries a test-type annotation (`unit|integration|eval|browser|api`) and `ac_total == ac_with_test`.
- No new lint/type suppression comments of any kind.
- Coverage thresholds only ever rise, never fall; when new code raises coverage, backfill the threshold config to match.
- Lighthouse CI CWV budget: LCP ≤2.5s, CLS ≤0.1, effective starting at Iteration 0.
- Asset-production stories carry a manual "reviewed and accepted by a human" AC.
- The Tester walks every state against the matching canvas at the end of each iteration.
- **X8 (updated per SD-30)**: any PR that changes a prompt / model-config / guardrail file must pass the **L0 smoke gate** (~80 cases: one per path + the P0 set in all three languages); the **L1 full suite** (617 cases today, targeted to grow to ~750) runs nightly + on model-swap gates / releases and is **not** a per-PR blocking gate. Pass/fail is decided by a **stratified bootstrap 95% CI + paired comparison** (overlapping CIs = inconclusive), retiring the old bare "baseline − N points" threshold.
- **X3/SD-11**: keys for all three BYOK provider families must never reach the observability surface; an integration test is required before merge.
- **X10**: camera/geo/haptics/wake-lock/clipboard calls must go through `apps/web/src/platform/`.
- **SD-2/G4**: any new backend capability first asks which of the three ownership buckets it belongs to; no new data endpoints on the agent service.
- **X2/SD-4**: Chat's first-token warm p95 ≤3s is a hard gate.
- **SD-9 (revised)**: generative registry components declare their partial-tolerant field list; the protocol is the AI SDK UI message stream, with the custom data-parts schema living in `packages/contract`.
- **SD-13**: generative registry components version additive-only; `presentation_hint` has the frontend as final arbiter, with unknown values degrading gracefully.
- **SD-13/C6a**: any URL inside a payload may only render from a catalog data source or an explicit allowlist source.
- **SD-19**: external content (web_search, etc.) entering context must be delimited and marked untrusted before use; the architectural-invariant regression test stands as the record of this.
- **SD-20**: BYOK's three provider families route outbound requests through the P8 SSRF egress guard (post-resolution IP validation).
- **SD-21**: precise GPS coordinates may never enter the Logfire trace; truncate to 3 decimal places (~100 m).

**DoD addenda — now Finalized (finalized 2026-07-07, per the P3 patch)**: P6's disconnect semantics and the message-length cap (env `MESSAGE_MAX_CHARS`, initial value 4000; initial value, executor may tune with evidence) are part of the mandatory gate — no addenda remain in a pending state.

---

## ⑥ Design Draft Coverage Matrix

`docs/archive/design-sync/`'s top level has **24 `.html` files**, empirically verified (see §11's verification note; this doesn't match the inputs file's stated "21," so all 24 are attributed here based on the actual count).

### HTML canvases (24)

| # | File | Attribution | Implementing/reference story | Notes |
|---|---|---|---|---|
| 1 | `Splash 静态版.html` | Implement | S0.7 | The current mobile splash screen, day/night frames, ≤800ms, no JS |
| 2 | `Splash - Seichijunrei.html` | **Archived, not implemented** | — | An animated exploration variant; the fox-trot memory beat has been extracted into S3.8/S0.7 |
| 3 | `Landing - Seichijunrei.html` | Implement | S0.6 | Already built in the spike, migrated and adopted in Iteration 0 |
| 4 | `首页 - Seichijunrei.html` | Implement | S5.5 | App Home: search / continue-from-where-you-left-off / popularity ranking |
| 5 | `Chat 完整状态.html` | Implement (reference) | S1.1-S1.7 | A clickable demo, 7 states |
| 6 | `Chat 状态总览.html` | Implement (**primary deliverable**) | S1.1-S1.12 | The full mapping of all 44 states; includes the C2t frame (§8) |
| 7 | `Chat 初始状态.html` | **Archived, not implemented** | — | An old version with only 2 states, superseded by #6 |
| 8 | `DS 补全 - Chat 桌面.html` | **Spec canvas** | S0.5, S6.* | The authoritative source for tokens/icons/component-state matrices |
| 9 | `工作台 - 地图常驻方案.html` | Implement | S6.1-S6.6 | Phase 2's desktop two-column layout |
| 10 | `Graduation 转场 - Storyboard.html` | **Spec canvas** (F0-F5) | Implemented in S3.1 | A pure storyboard, no clickable interaction |
| 11 | `Walk 状态总览.html` | Implement (primary deliverable) | S3.2-S3.5 | 10 states; the finalized direction is W-B′ full-bleed |
| 12 | `Walk demo.html` | Implement (interactive reference) | S3.2-S3.5 | Real check-in with vibrate+undo, the composition-comparison slider |
| 13 | `路线详情 状态总览.html` | Implement (primary deliverable, current v2) | S2.1-S2.6 | A single-page living document |
| 14 | `路线详情 demo.html` | Implement (interactive reference) | S2.1-S2.6 | Uses localStorage `route-demo-v1` |
| 15 | `路线详情 状态总览 v1.html` | **Archived, not implemented** | — | Archived; `spec-route-detail.md`'s opening line rules v2 authoritative |
| 16 | `しおり share 状态总览.html` | Implement (primary deliverable) | S4.1-S4.4 | The layout family + the generation screen + the public page |
| 17 | `しおり demo.html` | Implement (interactive reference) | S4.1-S4.4 | Toggle items one by one to swap layouts live |
| 18 | `作品公開页 状态总览.html` | Implement (variant A, encyclopedia-style) / **archived** (variant B, poster-style) | S5.1-S5.3 (A) | Same file, two variants — only A is built |
| 19 | `作品公開页 demo.html` | Implement (interactive reference, A) | S5.1-S5.3 | Tap a bubble → zoom → the shot-angle sheet |
| 20 | `マイルート 状态总览.html` | Implement (variant A, bookshelf) / **archived** (variant B, schedule) | S2.7 (A) | Same file, two variants — only A is built |
| 21 | `マイルート demo.html` | Implement (interactive reference, A) | S2.7 | Three states: today-has-a-route / today-has-none / empty |
| 22 | `対比図作成 状态总览.html` | Implement | S4.6 | CMP-0 through CMP-4, 5 states |
| 23 | `対比図作成 demo.html` | Implement (interactive reference) | S4.6 | Real getUserMedia + canvas compositing |
| 24 | `前端全景 - Journey Hub.dc.html` | **Index canvas** | — | Pure navigation; the index itself lags behind and is maintained by the design side, not a target for this train to fix |

### md / structural docs

| File | Attribution | Notes |
|---|---|---|
| `docs/archive/design-sync/docs/user-journey.md` | Spec canvas (one of the authoritative five) | The scenario/emotional basis for every iteration |
| `docs/archive/design-sync/docs/DESIGN.md` | Spec canvas (one of the authoritative five) | Frontmatter is missing explore/walk/map-* — backfilled in S0.5 |
| `docs/archive/design-sync/docs/spec-chat-page-states.md` | Spec canvas (one of the authoritative five) | The source of Iteration 1's state machine (44 states) |
| `docs/archive/design-sync/docs/spec-chat-page-design.md` | Spec canvas (one of the authoritative five) | The map portion is superseded by X1's MapLibre reading; the streaming-protocol portion is superseded by the **revised SD-9**'s AI SDK UI message stream (replacing the old "three-event SSE" reading) |
| `docs/archive/design-sync/docs/spec-route-detail.md` | Spec canvas (one of the authoritative five) | The sole source for Iteration 2 |
| `docs/archive/design-sync/docs/card-user-journey.html` | Spec canvas (one of the authoritative five, an APPROVED visual anchor) | Authoritative for scope decisions |
| `journey-走查.md`(spike 分支文档) | Spec canvas (authoritative for Q1-Q5) | Already absorbed into §8 |
| `ds-审计.md`(spike 分支文档) | Spec canvas | The P0 deliverables are already in the DS-supplement canvas, absorbed into S0.5 |
| `fox-walk-spec.md` | Spec canvas | The sole basis for S3.8 |
| `generative-ui.md` | Spec canvas | The Phase 1/Phase 2 boundary for Iterations 1/6 |
| `design-project-log.md` | Index canvas (a step-by-step log) | For provenance tracing, not a deliverable |
| `AI_USAGE.md` (design-sync root) | Spec canvas (the upstream package's API manual) | Not produced by this project |
| `skill/SKILL.md` | Spec canvas (a pixel-level style guide) | Not produced by this project |

### Assets (grouped by directory)

| Directory/file | Attribution | Consuming story |
|---|---|---|
| `assets/fox/*.svg` (11 poses) | Implement | S1.2/S0.7/S3.2; S3.8 adds the new trot sprite |
| `assets/img/*` | Implement | S0.6/S5.5 decoration; not the same as the DS supplement's S2 20-icon system (a separate line) |
| `assets/compare/{anime,real}.jpg` | Implement (reference material) | S4.6, doesn't ship with the product |
| `assets/torii.svg` | Implement | S0.6, the header's brand mark |
| `assets/fonts.css` | Implement | S0.5, vendored directly |
| `assets/index.css`/`assets/core.css` | **Not adopted** | Always goes through the DS bundle tokens instead |
| `_ds_bundle.js`/`support.js`/`image-slot.js`/`tweaks-panel.jsx` | **Not adopted** (canvas tooling scaffolding) | Business code may not import these |

---

## ⑦ Non-goals

- **D7 Agent Pyodide-Worker-ification / TS rewrite — both REJECTED** (SD-4, final).
- **D9 Pulumi IaC expansion** (the R2 bucket is an exception), **D10 multiple environments**: neither is done.
- **SD-3⑤'s Neon Auth migration is now activated by SD-31** — the code integration (login UI on the Neon Auth SDK / worker+agent JWKS verification / Neon RLS) lands in this train's auth stories (S0.6/S1.7/S1.8 + the `workers/users` JWT verification). What stays **out of scope**: fully retiring the Supabase auth project + migrating real users + actually deleting the Supabase catalog tables.
- **A full migration of the existing agent data endpoints**: direction is confirmed, but not touched in this train.
- **Agent cognitive-loop architecture rework** (D14): no new routing/dispatch layer (a routing-layer rework → **DD-2 frozen**).
- **Cross-session/global user memory** (D15): not built (waking it up → **DD-3 frozen**).
- **Capacitor integration**: deferred until after the loop closes.
- **The catalog's standalone-deploy-job legacy issue**: not fixed in this train.
- **J16, companion collaboration**: no corresponding page exists in the design export, so none is produced.
- **Chat's large-scale supercluster GL/mega-map scenario (>500 points)**: deferred as originally ruled.
- **Pixel-level implementation details of the しおり OG portrait-image rendering pipeline**: left for the Executor to detail before kickoff.
- **An A2A server** (**backfilled from SD-25, → DD-10 frozen**, pending real enterprise-orchestration-side signal): this train only builds the Skill + a quick, coarse-grained MCP server; no A2A; third-party compliance certifications likewise get only a functional thin adapter.
- **Expanding BYOK beyond three provider families**: SD-11's first release explicitly scopes to three.
- **A sampled-scoring system for production sessions** (**→ DD-17 frozen**, triggered by ops bandwidth + session volume ≥500/week): not a work item for this train.
- **Refactoring the `greet_user`/`answer_question` pseudo-tools**: the quirk is recorded, not touched (a default, backfilled from SD-24's confirmed defaults).
- **An internal skill framework, an mcp-client (consuming third-party MCP)**: both already Finalized as non-goals via SD-24 (**→ DD-9/DD-8 frozen**), not pending-confirmation items.
- **Introducing subagent expansion into the product runtime**: D17 is Finalized, keeping zero subagents (aside from the translation subagent); an injection-isolation subagent → **DD-4 frozen** (an Iteration 7 evaluation).
- **Model tiering (D19)**: Finalized as a non-goal (per the C6c ruling, YAGNI reasoning: tool execution is code logic, not an LLM call).
- **Image-search layer 3 (whole-library cross-anime vector search), an ANN index, embedding contrastive fine-tuning** (**backfilled from SD-26, → DD-11/DD-12/DD-13 frozen**): this train only builds image-search phase 1 (Iteration 1) + phase 2 (Iteration 4); layer 3 and index optimization both await a triggering signal.

---

## ⑧ Design open items and defaults

### 8.1 The 2 items in `spec-route-detail.md` §9 flagged "needs user review"

| Item | Recommended default | Landing spot |
|---|---|---|
| The section-header total-walking-distance line | **Show it**: the header format "item count + total walking distance + span" is adopted directly per the existing copy, matching the target information density | S2.4 |
| Does the ★ target hook into Walk? | **Not wired in this iteration**: the details page's ★ marker only takes effect within that page; Walk's to-recreate composition list reuses the route's own scene-thumb data, with no cross-page state sync; add it to S3.4 if the user overturns this | S2.4 (not wired) / S3.4 (fallback) |

### 8.2 Q1-Q5 from `journey-走查.md` §4

| # | Question | Recommended default | Basis | Landing spot |
|---|---|---|---|---|
| Q1 | Where does the route's premise come from? | **Option A**: clarify once when it's missing (the C2t frame) | `ds-审计.md` already ruled "departure time + location are mandatory questions (skip if already stated)" | S1.3 |
| Q2 | A planning-stage vs. completed-trip しおり? | **Yes, both**: an on-a-weekday planning version (no checkmarks) and a completed-trip commemorative version (with checkmarks + a completion rate) | `spec-route-detail.md` §3 already has CTA copy evidence for this | S4.1/S4.2 |
| Q3 | Does A4 allow anonymous chat access? | Already **superseded by G7**, no longer open | G7 | S1.8 |
| Q4 | Are all three Walk-mode entry points built? | **Yes** — anything else directly conflicts with the Releasable "no dead-end UI" requirement | ④ | S1.5/S2.3/S5.5 |
| Q5 | Keep "search from a photo"? | **Superseded by SD-26**, which turns this "recommended default" into a Finalized two-phase architecture: phase 1 (Iteration 1, S1.3) is an LLM-vision coarse screen to identify the anime, free-riding on the LLM's world knowledge with zero index, falling back to clarify when unrecognized (not blocking the main flow; the old "D1 fallback copy" language folds into the clarify flow); phase 2 (Iteration 4) does precise shot-angle matching within the identified anime, embedding coarse screen [standard] + LLM-vision fine ranking as the workhorse. Three-layer reverse discovery (world knowledge → nearby GPS search → whole-library vector search, layer 3 → DD-11 frozen) | SD-26 (inputs §11); the generative-ui.md component catalog | S1.3 (phase 1), around S4.6 (phase 2, sharing a data pipeline with Iteration 4's 対比図) |

### 8.3 The C2t frame

**Formally adopted as spec**: `ds-审计.md` already ruled that "departure time + location are mandatory questions"; C2t is the concrete implementation of that ruling, not a standalone proposal. Lands in S1.3.

### 8.4 The graduation stage model

**Adopted**: a complete storyboard already exists (F0-F5, with durations/easing already specified). Lands in S3.1.

### 8.5-8.7 — All RESOLVED

The three uncertainties previously recorded here — D7's final ruling (SD-4), the user-domain data access path (SD-2), and the domain (SD-0) — have all been settled. **Backfill A's addition**: six items previously tagged "proposal under discussion" in the architecture supplement — the Generative UI core philosophy (SD-13), injection defense (SD-19), BYOK+SSRF (SD-20), GPS trace truncation (SD-21), subagent/mcp-client scope (SD-24), and the external release order (SD-25) — have all been walked through item-by-item in inputs §10 and promoted to Finalized; they no longer count as "needing user review" in this section's sense.

### 8.8 This spec's pending-confirmation list — NOW EMPTY (**cleared by the P3 patch, 2026-07-07**)

**Updated by the P3 patch (2026-07-07)**: the last two pending items — P6 (SSE disconnect semantics, in the security/privacy quick-reference table) and the message-length cap (env `MESSAGE_MAX_CHARS`, initial value 4000) — were confirmed by the user in the "spec 收口三件" ruling and are now **Finalized (finalized 2026-07-07)**, exactly as already written. **This spec now contains zero pending-confirmation items.** (History: the C6 ruling earlier promoted D16/D18/D19 and the Generative UI constitution's URL allowlist clause to Finalized; before that, Backfill A had also carried those on this list. All are now resolved.) The two just-finalized items were never "unanswered open design questions" (unlike the 8.1/8.2 scenario, where the Planner supplies a recommended default) — they were cases where **a complete plan already existed, but the process had skipped the user-discussion step**; that step is now complete, so the Coordinator may treat their ACs directly as merge-blocking gates.

---

## ⑨ Risk Register

| Risk | Impact | Mitigation | Story involved |
|---|---|---|---|
| `wrangler.toml [assets]` is broken + `worker/entry.ts` hardcodes `.open-next/worker.js` | Without a fix, the TanStack build can't deploy | S0.3 swaps in the `cloudflare-module` preset output, Hono routing unchanged | S0.3 |
| Zen Maru Gothic font missing | A font incident across an all-Japanese product | S0.5 vendors it + a CI assertion | S0.5 |
| 2 DS contrast FAILs | Falls short of WCAG AA | Add an a11y AC (≥4.5:1) to any component consuming these two tokens | S0.5, S1.*, S3.* |
| `animal-island-ui-tailwind` version drift | Upgrading may bring breaking component API/style changes | S0.2 pins 1.0.x and runs a visual regression pass | S0.2 |
| The MapLibre+Protomaps migration is pure net-new work (X1) | pmtiles generation/hosting could take longer than expected | S0.4 gets its own spike; if blocked, fall back to a static illustrated basemap through Iteration 1 | S0.4 → blocks S1.4/S1.5 |
| Container warm-keeping cost vs. the SLO (X2, hard requirement) | Always-warm instances = continuous billing; scheduled pings = still risk a cold start | Needs the user to confirm a budget ceiling | S1.2, owner = the user |
| The global daily-budget circuit-breaker threshold (X4) has no concrete number yet | Too low over-triggers, too high does nothing | Configurable via an env var, not hardcoded | S1.8, owner = the user |
| BYOK's leak surface spans three provider families (X3/SD-11) | Testing only one family risks missing the other two | S1.11's integration tests verify each of the three families separately | S1.11 |
| PR #206 not yet merged | Blocks Iteration 0's CI baseline | Listed as a global blocking prerequisite | Global blocker |
| The specific 5 smoke-eval cases (X8) | The Planner doesn't know the content of all 617 cases | The AC only locks the selection principle; the concrete cases are picked at execution time | S0.1 |
| `apps/web`'s coverage-floor starting point is unknown | Can't hardcode a specific percentage | Write it into the config comment once measured | S0.2 |
| **Catalog's first public exposure** | The new `/catalog/public/*` allowlist widens the attack surface | Strict read-only allowlist, eng-review sign-off | S5.4 |
| **The new R2 presign route lives in the edge Worker** | Needs protection against unauthorized presigning | The presign URL is scoped by the JWT `sub` prefix + a short TTL | S4.7 |
| **`workers/users` is an entirely new service**, zero existing baseline | Auth/CI/deploy all need building from scratch | Fully clone the pattern already proven in `workers/catalog` | S2.8 |
| **Regression risk from fixing SD-3①'s cross-database bug** | Fixing a bug can introduce a new one | A before/after data-shape snapshot comparison test around the fix | S1.7 |
| **SD-3④'s historical data migration** | A one-off script can still have small omissions | Row-count reconciliation + sampled content verification | S2.9, S3.9 |
| **SD-5: session state is best-effort, no transactional guarantee** | A known and accepted transitional risk | Naturally resolved once migrated to Neon | Recorded, not a blocker |
| **The gap between SD-9's current-state protocol and its final definition** (**corrected by Backfill A, the risk is resolved**: previously recorded as "the three-event naming doesn't quite match" and pending reconciliation; the revised SD-9 makes the AI SDK UI message stream/`VercelAIAdapter` the final definition itself, so the current state already is the final state, with no gap left) | The original risk description is now stale, kept on record for audit purposes | S1.1/S1.2's work shifts from "reconcile protocol ownership" to "confirm the existing `/v1/chat` implementation matches the revised SD-9's semantic mapping + fill in the custom data-parts schema + verify whether typed output can stream out progressively" | S1.1, S1.2 |
| **The `pydantic-ai-guardrails` dead dependency** | Declared but never imported, taking up dependency surface without providing real protection | S1.6/S1.12 make a binary call (wire it up or remove it) | S1.6, S1.12 |
| **A pending item mistakenly treated as Finalized and acted on** (**RESOLVED by the P3 patch, 2026-07-07**: no pending items remain — P6 and the message-length cap were Finalized on 2026-07-07, and D16/D18/D19 + the Generative UI constitution's URL allowlist clause were Finalized earlier by the C6 ruling) | Was: replaying the "moved forward without discussion" problem, wasting rework | No mitigation needed — the risk is retired now that the package carries zero pending-confirmation items; every AC may serve directly as a merge-blocking gate | — (risk retired) |
| **P6's "no resume on disconnect" being overturned** (**RESOLVED by the P3 patch, 2026-07-07**: the user confirmed the "no resume-on-disconnect" trade-off, so this is Finalized) | Was: the ACs in S1.1/S1.2/S1.6 around "no resume + fetch final state via GET messages" needing rework into a resume-capable alternative | No mitigation needed — the trade-off is user-confirmed and Finalized; the AI SDK UI message-stream portion stays Finalized regardless | — (risk retired) |

---

## ⑩ Dependencies (spec-level)

- **PR #206** must merge first.
- The initial `ANON_DAILY_COST_BUDGET_USD` threshold needs the user to supply a number (X4).
- The container warm-keeping budget ceiling needs user confirmation (X2).
- S1.4/S1.5/S2.2/S5.2's map ACs can't start until S0.4 (the map ADR + spike) is done.
- S5.4 (catalog's first public exposure) needs eng-review sign-off before it can merge.
- S0.9's `docs/ops/migrations.md` should land first; S2.8/S2.9/S3.7/S3.9's Neon migration workflows follow it.
- S2.8 (`workers/users`'s first build-out) is the foundation for S2.9/S3.7/S3.9/S4.5/S4.7.
- S1.1/S1.2 (the revised SD-9: confirm `VercelAIAdapter`'s current state matches the semantic mapping + fill in the data-parts schema) are the foundation for every generative component in S1.3-S1.7.
- **Updated by Backfill A**: the relevant ACs for S1.11 (BYOK/P8), S1.12 (guardrails/P2), and S3.3 (Walk/P9) have all been promoted to Finalized (SD-20/SD-19/SD-21) and are no longer pending items. **Updated by the P3 patch (2026-07-07)**: the last two items needing a user sign-off — S1.1/S1.2/S1.6 (P6) and S1.12 (the message-length cap) — are now Finalized; **no Coordinator-planned user-sign-off action remains outstanding**.

## ⑪ Verification Plan

- At the end of every iteration, the Coordinator: pull main → `supabase start` → `make serve` → build an `apps/web` preview → wait for `/healthz` to go green.
- The Tester walks a state-by-state screenshot comparison against the design source drafts each iteration.
- The Reviewer checks `ac_total == ac_with_test` and a Codecov patch ≥95%. (As of the P3 patch, 2026-07-07, there are no pending-confirmation ACs; every AC counts toward the mandatory gate.)
- After Iteration 5 ships, run the `claude-seo` plugin audit for a score.
- Iteration 7 depends on the X8 gate already existing: run a baseline, then judge the post-change result **not worse than baseline via a stratified bootstrap 95% CI + paired comparison** (per SD-30; overlapping CIs are flagged inconclusive rather than auto-blocking) — the old bare `score >= baseline - 10pp` threshold is retired.
- Once everything passes, the Tester tags the release and CI deploys to prod.

**Planner's verification note**: the coverage matrix was empirically verified against `docs/archive/design-sync/`'s top level, which has **24 `.html` files** (verified via `ls *.html | wc -l`), not matching the inputs file's stated "21" — all 24 have been individually attributed here. This spec has been through 8 rounds of added clarification; round 8 (inputs §8/§9) was at one point flagged by the main session as "not discussed with the user, downgraded to proposal under discussion." X15's landing spot has been corrected to S5.8 (matching its actual story attribution in `iter-5.md`).

**Backfill A's supplementary note (2026-07-06 evening, based on walking through inputs §10/§11 item by item)**: the content tagged "proposal under discussion" in §8/§9 has since been walked through round by round with the user across inputs §10 (Step 1-Step 8)/§11, and **the great majority of it has been promoted to Finalized**: SD-13 (the Generative UI philosophy + P10), SD-15 (memory refinement), SD-16 (the Animichi persona), SD-17 (prompt patches + length governance), SD-18 (the two new hooks, the old P3 rescinded), SD-19 (injection defense, the old P2), SD-20 (BYOK+P8), SD-21 (GPS truncation, the old P9), SD-22/23 (flywheel scheduling), SD-24 (subagent/mcp-client/skill-framework scope, including the old D17), SD-25 (the external release order: Skill→MCP→A2A deferred), SD-26 (image search, two phases), and SD-27 (SEO/GEO, landing package in `2026-07-06-seo-geo-plan.md`). **In the same period, SD-9 itself was overturned and re-discussed**: the three-event custom-SSE proposal has been superseded and finalized as the AI SDK UI message-stream protocol (via `VercelAIAdapter`) (§10 Step 2). After this backfill, **what remained pending confirmation (at that time) was only**: P6 (SSE disconnect-semantics details), the message-length cap, D16 (the model-switch gate), D18 (the BYOK-scope justification), D19 (no model tiering), and the Generative UI constitution's URL allowlist clause — none of these six were covered by any subsequent round in the inputs, so they still needed the Coordinator to walk the user through them (all six are now resolved — see the Patch A and Patch P3 notes below).

**Patch A's supplementary note (2026-07-06 evening, landing the C6 ruling from `2026-07-06-backfill-conflicts.md`'s "✅ ruling result" section)**: of the six items Backfill A left pending above, four are now resolved. Per the C6 ruling: the Generative UI constitution's URL allowlist clause is Finalized (C6a, grounded in SD-19's same-origin injection-defense requirement); D18 is Finalized (C6b, made explicit from what SD-20's D18-boundary regression AC already implied); D16 and D19 are confirmed as pre-existing finalized defaults and removed from the legacy pending-list framing (C6c); and SD-12's earlier "MCP/A2A" pairing is softened to "exposed via MCP; A2A → DD-10 frozen" (C6d). This pass also added one-line index entries for SD-28 (route-planning tiers), SD-29 (the retrieval-architecture overall stance), and SD-30 (the eval two-axis system) to the SD conclusions index in §2, and noted the SD-26 pipeline supplement (D1-D6) in that row. **After Patch A, what remained pending confirmation was down to exactly two items**: P6 (SSE disconnect-semantics details) and the message-length cap.

**Patch P3's supplementary note (2026-07-07, landing the user-approved "spec 收口三件" ruling from `2026-07-06-frontend-rebuild-inputs.md` §10, last row)**: the two items Patch A left pending are now both **Finalized (finalized 2026-07-07)**, exactly as already written — ① **P6** (SSE disconnect semantics: events carry `turn_id`+`seq`, no mid-stream resume, `GET messages` fallback after a disconnect, a D4 exception card with retry) and ② the **message-length cap** (env `MESSAGE_MAX_CHARS`, initial value 4000; initial value, executor may tune with evidence). **The spec package now contains zero pending-confirmation items** — every AC may serve directly as a merge-blocking gate. This same ruling also adopted the SD-28 dual-route unification (route ordering unified onto the TS catalog: the `selected_route` bypass switches from Python `route_optimizer.py` to `deps.catalog`, the ×1.3 detour coefficient lands in `workers/catalog/src/lib/route.ts`, and `route_optimizer.py` is retired — folded into iter-1 S1.5/S1.7) and scheduled the refactor findings (F1 + the hygiene batch → new iter-0 story S0.10; F7/F8 → debt cards in `docs/archive/plans/2026-07-07-refactor-backlog.md`).
