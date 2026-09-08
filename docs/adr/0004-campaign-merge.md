# One close-out campaign: repo-restructure-spec × skeleton-refactor GOAL

Two documents written the same day (2026-08-06) describe overlapping end-states: `docs/archive/specs/2026-08-06-repo-restructure-spec.md` (W0–W6: root cleanup, docs/ reorg, edge ownership, workspace, src-layout, history rewrite) and `docs/iterations/refactor-skeleton-2026-08/GOAL.md` (W0–W8: vertical slices, DB roles, migration history). During execution the GOAL absorbed parts of the restructure spec (#853 config-sink implemented spec W2a/W4). Tracking them separately duplicated gates and masked gaps (the restructure W1 docs/ reorg and W3–W6 were never started).

## Decision

One merged campaign — the **repo close-out** — with a single definition of done: GOAL W0–W8 checkboxes all `[x]` **and** restructure spec §5 verification all green **and** issues #829/#845 closed. Waves are re-ordered by dependency, not by either document's numbering; every wave keeps the common gates (local hooks → PR → two-path comment gate → squash-merge).

## Why

- Both contracts target the same repository end-state; one merge order, one acceptance list, one closing ceremony.
- The restructure spec's own premise — "no parallel branches" — is only satisfiable under a single coordinated plan.

## Consequences

- Execution order: P0 gates → P1 docs+docs-reorg → P2 edge ownership → P3 workspace/config → P4 secrets re-architecture → P5 meta-gate + prod DSN → P6 production domain/SEO → P7 history-rewrite window (restructure W6 + GOAL W8 fused) → P8 close-out.
- The 2026-08-08 close-out spec (`docs/specs/2026-08-08-repo-closeout-spec.md`) is the single tracking artifact; GOAL.md checkboxes and restructure §5 checks are updated from it.
- Deferrals are recorded in the GOAL change log, not silently dropped (Harness rebuild #827; landing go-live).
