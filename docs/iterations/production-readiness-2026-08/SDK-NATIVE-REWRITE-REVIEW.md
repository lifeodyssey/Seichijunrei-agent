# SDK-native rewrite review

Design candidate for #1536, 2026-09-09. The owner's latest instruction permits deleting and rewriting internal architecture and rejects retaining an adapter layer around the old engine. This review proposes corrections to the [accepted spec](../../specs/2026-09-09-agent-on-pi-harness-spec.md); it does not silently amend that spec, approve implementation, or authorize removal of product features. The revised [file disposition](AGENT-FILE-DISPOSITION.md) records the deletion consequences.

## Decision

Program directly against `AgentHarness`, `AgentLane`, `Session`, `SessionRepo`, `Storage`, `AgentHarnessTool`, `AgentToolResult`, `Context`, and SDK `Result`. Delete the old runtime interfaces and their implementations. A function may assemble the SDK objects and register tools/hooks; it must return SDK objects, not expose another `accept`/`drive` facade. Eval calls the same assembly and SDK methods directly.

**`ToolReply` is not a public pi 0.85.1 type.** The published tool callback returns `Promise<AgentToolResult<TDetails>>`, with `content`, `details`, optional `usage`, and optional `terminate`. Do not invent a replacement name or copy that interface. [P2]

## Exact evidence and limits

Pi evidence is fixed to published **0.85.1**, Git tag/npm head **`d981de1229ef899957bbe968bc8dcda02a21f477`**; the previously verified tarball and source are reused. The worktree baseline still installs pi **0.84.4**. This is a target design, not a claim that 0.85.1 already runs in production.

| Key | Public source and verified fact |
|---|---|
| P1 | [Harness/lane declarations](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/agent/src/harness/agent-harness.ts#L518-L622): async create/lane/accept/drive/watch, typed results and direct hooks. |
| P2 | [Tool callback](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/agent/src/harness/types.ts#L96-L123), [tool results](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/agent/src/types.ts#L367-L409): invocationId is the reserved result-entry id; TypeBox schema infers parameters; `replay` is explicit. |
| P3 | [Storage/SessionRepo](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/agent/src/harness/session/types.ts#L454-L610), [public exports](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/agent/src/harness/session/index.ts): reuse `StorageBackedSession`, commit validators, `createForkSnapshot`, and `classifyForkAddress`. |
| P4 | [Fork implementation](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/agent/src/harness/session/fork.ts#L6-L83): entries and scalar values only; no list snapshot. `forkSnapshotWrites` is not a public export. |
| P5 | [Models factories](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/ai/src/models.ts#L744-L775), [credential store](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/ai/src/auth/credential-store.ts), [auth helper](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/ai/src/auth/helpers.ts#L9-L34): concrete native model/auth implementations exist. |
| P6 | [Upstream non-goals](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/agent/docs/harness.md#L116-L124): host ownership, scheduling and exactly-once external effects are not supplied. |
| C1 | [Cloudflare Agent lifecycle](https://github.com/cloudflare/agents/blob/94485788607298d1bbbb31db6f21305a333f151e/packages/agents/src/index.ts#L3755-L3823), [official scheduling](https://developers.cloudflare.com/agents/runtime/execution/schedule-tasks/): `keepAliveWhile`, `schedule`, `scheduleEvery`. Also verified these methods in the integrity-checked **published agents 0.22.0** tarball, not merely current main. |
| L1 | Installed **oRPC 1.14.10**: `OpenAPILink` accepts a custom `fetch`; `ClientRetryPlugin` owns retry scheduling. Existing [web client assembly](../../../apps/web/src/api/clients.ts) already uses the same contract. Current website examples can describe v2: implementation must use the installed v1 declarations. |
| L2 | Installed **AI SDK 7.0.77**: `createUIMessageStream`, `createUIMessageStreamResponse`, `UIMessageChunk`, `JsonToSseTransformStream`; the last already emits `data: [DONE]`. Existing [web transport](../../../apps/web/src/features/chat/use-chat-session.ts) is `DefaultChatTransport`. |

Detailed source excerpts, package metadata, integrity checks and the exact file inventory are retained in `/private/tmp/animichi-release-inventory/agent-1536/native-review/`. No speculative library capability is used below as a completed gate.

## Minimum target call chain

```text
HTTP /v1/chat → existing edge identity + request validation
  → one Cloudflare Agent host for the owned session
  → ordinary SQL admission/quota transaction, stable client key → operationId
  → NeonSessionRepo.open(metadata, context) → SDK StorageBackedSession
  → AgentHarness.create({session, models, model, tools, toolContext, ...}, context)
  → harness.lane("main", context) → lane.accept({kind:"prompt", operationId, prompt}, context)
  → SDK host schedule callback → keepAliveWhile(() => lane.drive(..., context))
  → SDK committed entries + usage rows + immutable operation result
  → ordinary SQL settlement transaction

same lane.watch(context) → snapshot + HarnessEvent → UIMessageChunk
  → AI SDK stream writer/response → existing DefaultChatTransport

eval → same harness assembly + real Models/tools + repository-owned Session
  → lane.accept/drive/getResult/findEntries, with no HTTP or DO path
```

The host must durably schedule recovery before the first admission/selection intent or quota reservation, and create a wakeup before acknowledging admitted work. Scheduling metadata can hold session/operation identifiers, never credentials, messages or tool payloads. Scan pending/accepted admissions, unresolved selections and independent unsettled obligations; the post-accept index is only auxiliary. Use current `inspectExecution`/`getResult` witnesses; failed queries leave obligations unsettled. Reconcile selections before admissions and schedule `notBefore` for retry waits. The detailed authority is [spec §4.2.2 protocols 3/5/7/8](../../specs/2026-09-09-agent-on-pi-harness-spec.md). No lease table, custom run machine, persisted DO envelope or second model loop is needed.

`AgentHarness.create` returns `open` as an initial inventory, not a continuing source of truth. Public `inspectExecution` and `getResult` decide subsequent recovery and settlement. Do not use internal `restoreLane`, mutate reserved `pi.*` values, or copy the SDK reducer. [P1/P6]

## Neon: one SDK implementation, no intermediate store

Implement `Storage` directly over Neon Postgres and `SessionRepo` directly over session metadata. `SessionRepo.open/create` returns **the upstream `StorageBackedSession`**, which already owns branch operations, mutation serialization, identifiers and the Session interface. Delete `TurnStore`, `RunSteps`, `TurnRecords`, `EnvelopeStorage`, `SessionEnvelopeStore`, `QueueStorage` and their mocks. No `NeonTurnStore → SessionStore → PiStorage` chain is permitted. [P3]

`Storage.commit(Write[], Context)` translates the SDK's write union into one atomic SQL transaction, assigns ordered sequence numbers, validates entry/usage uniqueness and parent visibility, and returns SDK `CommitResult`/stats. Reuse public `prepareStorageCommit` and `validateCommittedWrites` where applicable; SQL constraints and snapshot isolation still need implementation. Reads return SDK `Entry`, `StoredValue`, `UsageRow`, and scan shapes directly. JSON/database serialization is necessary; a parallel application message schema is not.

Pi ships `MemorySessionRepo` and `JsonlSessionRepo`; it ships no Neon/Postgres backend in this version's public exports. Memory is not durable. JSONL uses filesystem semantics that do not implement the chosen Neon data plane or Worker persistence. Choosing either for production would change the persistence design, not eliminate its implementation. Neon remains a necessary direct implementation **because Neon is a selected product infrastructure requirement**, not because the old store exists.

Use public `createForkSnapshot`/`classifyForkAddress` and the upstream conformance suites. **Do not promise list-preserving forks:** 0.85.1's actual fork copies entries/scalars, not lists. The minimal domain design below needs no SDK lists. Full `Storage`/`SessionRepo` conformance is still required; unsupported list-fork semantics must not be invented, hidden behind a conversion layer or advertised as implemented. [P3/P4]

Reuse the exact-version [Memory conformance assembly](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/agent/test/harness/memory-conformance.test.ts) and [JSONL repository suite](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/agent/test/harness/jsonl-session-repo-conformance.test.ts), substituting a direct Neon fixture where appropriate. These are Node test examples, not Worker imports or proof of runtime compatibility. The independently executed public-root fork probe also confirms entry id/payload and scalar preservation, absent lists, and rejection of cross-repository Memory forks; raw output is `/private/tmp/animichi-release-inventory/eval-sdk-sources/pi-fork-probe.json`.

## Domain tools: remove the extra state carrier

Define each tool as `AgentHarnessTool<ContextData, typeof Parameters, DomainDetails>`, where ContextData is ordinary request data plus native SDK/library objects. No `Toolbox`, `TurnToolParts`, `CatalogToolSession`, `ToolPolicy` interface, or alternate tool-result family.

- Return compact model text in `content` and the typed full application payload in `details`. The SDK commits both as its `ToolResultMessage`; the UI can read `details`. This avoids serializing the full rows into model text.
- Use `invocation.invocationId` as the opaque result reference: it is the result entry's stable id. A later route tool reads that entry through `Session.getEntry` and validates its domain details and branch provenance. This deletes mint counters, ref registries, rehydration from run_steps, and duplicate payload stores. A ref from another session or branch must fail. [P2]
- Derive pending clarification, current anime and bounded trusted facts from committed branch entries using ordinary pure functions. Explicit preference changes can use SDK scalar `value<T>` addresses. Do not preserve a monolithic `SessionEnvelope`, a second transcript, or a mutable mirror of every tool result.
- Keep actual domain rules: exact offered-choice membership, stale clarification rejection, route origins, localized labels, provenance, no fabricated points, content sanitization, bounded memory and valid final response data. The old class structure and exact intermediate JSON shapes have no compatibility claim.
- The `respond` tool validates domain results and returns `terminate: true` only after a valid response. SDK termination is batch-wide (all finalized tools must terminate); test mixed batches. A normal failed execution throws as the SDK expects. Expected domain outcomes such as no match remain typed results.
- Replay authorization belongs in each actual tool `execute`; the SDK's safe-replay path bypasses `before_tool`. Use the stable invocation id for idempotent business effects. A generic policy engine is unnecessary. [P2/P6]

Frozen summaries remain a narrowly scoped `after_tool` details annotation and `transform_context` projection if the product requirement is retained. SDK compaction owns general context reduction; a summary, fact projection or status renderer is a plain function, not another memory runtime. Recompute status from committed facts, sanitize it, and keep it out of persisted messages. New-session details schemas need validation, but do not retain the old envelope codecs just to call them.

## Schema and model construction

**Model-facing tool parameters are native TypeBox 1.3.7 values**, such as `Type.Object({ title: Type.String({ pattern: "\\S" }) }, { additionalProperties: false })`. `Static<typeof Parameters>` is inferred by the SDK. This removes `ToolParameters<Params>`, its `~unsafe` brand, `toolParameters()`, and the generated agent-tool-schema pipeline. No schema conversion or handwritten type assertion is needed. Pi's public tool type expects `TSchema`; it does not accept arbitrary Zod/Standard Schema objects directly. [P2]

Catalog HTTP contracts remain their existing Zod/oRPC source. Agent input (`title`, `search_ref`, natural place) and catalog input (`query`, coordinates, point ids) represent different operations; direct tool code supplies the catalog client's typed inputs and the catalog validates them. Shared product bounds can be imported constants. Do not migrate the entire HTTP contract library merely to avoid a tool schema. Remove only agent-owned declarations/generation; move unrelated generated response-intent exports before removing the generator.

Use `createModels`, `createProvider`, native provider API modules and `InMemoryCredentialStore`. For BYOK, create an operation-scoped credential store, seed the caller key via `modify`, and use `envApiKeyAuth("caller key", [])`: the empty environment list rules out ambient fallback. Do not implement `Models`, `MutableModels`, or a second credential repository. Built-in `xiaomiProvider` exists; its lazy API import needs the Worker bundle spike because the old application measured a lazy-import failure. An eager `createProvider` assembly remains SDK-native. [P5]

One precise transport gap remains: `AgentHarnessStreamOptions` has no `fetch`; the provider request options do. `createProvider` also has no default-fetch option. Inject the guarded fetch at the public provider `stream`/`streamSimple` callbacks while preserving SDK options/signal; include deferred callbacks if enabled. This is a few application-owned request functions, **not a custom Models implementation**. Exact-host/redirect/credential stripping rules are application policy absent from pi. Missing BYOK credentials after eviction must not fall back to server billing; preserve the current safe refusal unless the owner chooses a resupply flow.

## Delete transport machinery supplied by libraries

Use `createORPCClient` plus `OpenAPILink(catalogContract, { fetch: request => binding.fetch(request), ... })`. Call the resulting contract client directly from tools. Delete hand-kept `CatalogClient`, route/body encoding, shallow `expect*` casts and the homemade retry loop in `service-binding-catalog`. Installed oRPC's `ClientRetryPlugin` supplies retry scheduling; configure bounded attempts and transient-status policy, and carry abort deadlines in request options. The link's static type is not proof of runtime response validation: use the declared contract's validator where that guarantee is required, not another handwritten DTO parser. [L1]

SD-9 is already AI SDK's UI message stream. Keep one pure `HarnessEvent → UIMessageChunk` projection with the existing message metadata/data types for domain `data-response`, tool visibility and server-origin metadata. Delete `TurnFrame`, `TurnOutput`, `SseTurnChannel`, custom JSON/SSE serialization, `[DONE]` handling and the subscriber state machine. `lane.watch` already supplies snapshot/live pairing; use `reduceLaneSnapshot` only where a consumer needs a maintained live view. Library streaming does not supply Animichi's result projection or guarantee durable task lifetime. [P1/L2]

AI SDK's writer does not expose SSE-comment heartbeat configuration in the inspected version. Preserve the required idle-connection behavior with a small response-stream heartbeat operation, or verify another public streaming helper; do not label this gap solved by `createUIMessageStreamResponse`. Disconnect unsubscribes the view; the separately scheduled drive continues. Keep snapshots as the reconnect source; no bespoke durable stream buffer is added.

## Cloudflare host: reuse the scheduler, not its chat engine

Prefer **`Agent` from published `agents`**, using `onStart`, `onRequest`, `schedule` and `keepAliveWhile`. Its stable scheduler multiplexes heartbeat and application schedules. Existing AgentSession is already a SQLite DO class. This removes homemade keepalive, alarm arbitration and schedule rows; the host callback merely calls pi. Use the existing authenticated gateway, not an accidentally public `/agents/*` router. [C1]

Do not introduce `AIChatAgent`, `Think`, Cloudflare session messages, `runFiber` checkpoints or Workflows for the same pi operation: they would add another conversation/execution authority. The independently published lifecycle composition APIs are marked experimental; the minimum proposal uses the stable Agent methods, not new framework plumbing. The 0.22.0 published export list also differs from current main, so unreleased `agents/streams` must not be assumed available.

This changes the old zero-DO-storage rule: **SDK scheduling metadata may use DO SQLite; agent entries, values, user data, usage and billing stay in Neon.** This is an infrastructure tradeoff to review, not a product protocol change. The Worker spike must prove cold attach, ≥130-second tools, client disconnect, alarm/keepalive coexistence, restart recovery, BYOK loss behavior, bounded memory and cost. If measured failures reject this dependency, document that evidence before writing a custom lifecycle implementation.

## Eval without a second host or repository converter

For new sessions use `MemorySessionRepo` directly. For recorded prefixes, record/open/fork within a **single `JsonlSessionRepo`** and run the same harness against that fork. `MemorySessionRepo.fork` does not import another repository's session; do not write a JSONL-to-memory adapter. Because references are entry ids and details live in entries, fork preserves their identity naturally. Mutable application state must use copied scalar values, not lists. [P3/P4]

Use SDK entries, tool-call arguments/results, `OperationResultRecord`, usage rows and optional `InMemoryTelemetryContext` as the evidence source. Delete `TrajectoryPrefix`, `PrefixToolCall`, synthetic message/run/step fixtures, staging seed HTTP and eval-specific TurnStore/ToolPolicy/SelectionRecords implementations. Dataset fixtures should contain real recorded SDK sessions and task inputs; assertions remain domain assertions. No live API key belongs in a corpus.

## Product compatibility decisions, with safe defaults

| Decision still needing explicit product direction | Default for this rewrite |
|---|---|
| Existing stored conversations: readable archive, migration, or retirement? | Preserve read access in an isolated legacy read path; do not migrate old rows into fabricated SDK history or delete user history. |
| Existing browser stream/history/request contract versus a coordinated new UI protocol? | Keep external fields, auth, ordering, 409 behavior and snapshot reconnect. Adopt library writers without changing the wire product. |
| Deterministic selected-item turns versus routing every selection through the model? | Preserve deterministic execution and no unnecessary model call. Use a correlated SDK custom entry; no fake assistant/tool transcript. |
| BYOK eviction: fail safely or request credential resupply? | Preserve safe failure and no platform-key fallback; keys remain heap-only. |
| Exact old memory/summary prompting versus outcome-based replacement? | Preserve observable facts, sanitization and bounded context; compare eval outcomes before changing user-facing behavior. Old prompt bytes and internal ledger classes are not automatically frozen. |

Deterministic selection exposes a real SDK gap: there is no non-model `OperationRequest` nor caller-supplied id for `appendCustomEntry`. Keep request-key deduplication in the same business submission ledger as HTTP admission. Under host exclusion, confirm lane idleness before execution and append; persist one correlated entry containing the key, domain steps, full typed result and server origin. A lost acknowledgement reattaches and claims the entry by key; failed queries leave the obligation unsettled. The successful result discharges only the matching clarification id/revision through domain projection, without a mandatory second write. Read-only catalog work may repeat before commit. Follow spec protocols 7/8; do not add SelectionRecords, a fake operation or an alternate append sequence.

## Required spec/card corrections before implementation

| Existing clause | Correction |
|---|---|
| W0-1 delete/adapter/keep and W0-3 mechanical relocation | Use the revised per-file delete/rewrite-domain/retain-domain inventory; remove old interfaces, not merely move them into packages/agent. |
| §4.1 three ports: SessionRepo + ToolPolicy + SelectionRecords | Keep native repository injection; tools contain policy rules, and deterministic selection uses SDK entries plus the existing admission business transaction. No two extra generic ports. |
| W1-1 Models adapter | Prefer concrete `createModels`/`createProvider`/credential store; test only the genuinely missing transport policy integration. |
| W1-2 zero `ctx.storage`, manual keepalive/alarm design | Permit SDK-owned host metadata; exercise published `Agent` scheduling around direct pi drive. Keep Neon as conversation/business authority. |
| W0-2/W1-4 application lists, CatalogToolSession and mint state | Prefer immutable tool details/entry ids; scalar values for explicit mutable preferences. Do not require list-preserving fork from 0.85.1. |
| W1-8 separate SelectionRecords implementations | Correlated custom entry and ordinary request-key reconciliation; no fake model run or duplicate storage interface. |
| W1-6 custom framing and fixed implementation-shape tests | Preserve SD-9 behavior through AI SDK writer; test semantic frames, secrets, reconnect, heartbeat and disconnect isolation. |
| E-1/E-2 memory-host/prefix import assumptions | Direct harness in-process; Memory for new sessions, same-repo JSONL forks for captured prefixes. No repository conversion. |

Neon atomicity/fork conformance, fault recovery, tool replay authorization, single ownership and external billing invariants remain requirements. Replace old wrapper-specific tests with tests through SDK interfaces and external product contracts. The fixed-base inventory audit proves complete consideration of the old tree; it must never become a permanent gate forbidding the rewrite.
