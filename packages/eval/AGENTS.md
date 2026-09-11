# packages/eval — AGENTS.md

Node-only native Pi tasks and Logfire evaluations. This package must never enter a Worker
bundle. Root rules: `../../AGENTS.md`; accepted target:
`../../docs/specs/2026-09-09-agent-on-pi-harness-spec.md`.

## Native task

`src/native/in-process-task.ts` creates a fresh native `MemorySessionRepo` and session for
each attempt. It calls production `createPilgrimageHarness` from `@animichi/agent/harness`
and returns the actual `LaneSnapshot`. Callers supply production model/tool configuration;
`Dataset.evaluate` owns repetition. Do not introduce a task executor facade, replacement
session model, HTTP transcript converter or staging seed adapter.

`src/native/attempt-observations.ts` records unchanged native `after_tool` arguments/results
and usage events as Logfire attributes. Missing usage remains explicitly unmeasured instead
of becoming fabricated zero spend. The task closes its harness and repository after success,
failure or cancellation; cleanup uses the native Context without the cancelled AbortSignal.

The task and tests use public Pi/Chord 0.85.1 and Logfire 0.22.5 APIs. Production composition
tests execute the real seven-tool harness with deterministic HTTP/provider fixtures. Tests
cover fresh attempts, model and paid-tool usage, rejected/failed/aborted/suspended outcomes,
native cancellation and resource closure. These are local behavioral controls, not evidence
of real-model quality or deployed authorization and quota behavior.

## Commands

- `pnpm test`: Node tests through tsx, then the Python fixture export/drift check.
- `pnpm run test:native`: the native task, production composition and resource tests.
- `pnpm run typecheck`: strict TypeScript 7, including dependency declarations.
- `pnpm run lint`: type-aware oxlint with warnings denied.
- `pnpm run test:fixture-drift`: regenerate Python oracle fixtures and compare committed bytes.

The old `eval:staging`, `eval:gate` and HTTP prefix-capture commands are retired with their
obsolete consumers. The native CLI/configuration, independent correctness/assertions and
pass^k layer, recorded same-repository prefixes, complete production suite rosters and
real-model baselines remain their owning Eval Stories (#1557–#1560). They are not supplied
by this minimum consumer closure. Never run paid evaluations without explicit authorization.

## Preserved inputs and oracles

`src/gate/` retains independent statistical utilities. The remaining pure `src/gate-run/`
modules retain their source behavior until an Eval Story replaces or retires them.
`fixtures/` retains Python-exported datasets and statistical oracle material. These files
are source inputs and expected values, not completed native suite rosters or successful runs.

Keep the original input-guard, injection and translation cases and their export sources.
Do not reduce coverage by relabeling a migrated subset as the full corpus. Source migration,
retirement decisions and their evidence belong to the full Eval work, separate from deletion
of the obsolete runtime consumers. Root type, coverage and test-quality rules still apply.
