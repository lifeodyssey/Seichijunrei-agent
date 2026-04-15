# Repo Structure Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce root-folder complexity by moving operational and iteration artifacts into clearer subdirectories, documenting placement rules, and keeping runtime entrypoints and product code easy to scan.

**Architecture:** This is a repository-structure/documentation cleanup, not a behavioral feature. The key rule is to move docs and execution artifacts without breaking runtime paths, CI paths, or deploy paths.

**Tech Stack:** Repository structure, Markdown docs, GitHub Actions references, Claude planning artifacts.

---

## Context

Current root has a lot of mixed concerns:

- runtime code (`backend/`, `frontend/`, `worker/`)
- infra files (`wrangler.toml`, `Dockerfile`, `Makefile`)
- docs (`DEPLOYMENT.md`, `README*`, `docs/`)
- execution artifacts (`docs/superpowers/plans/`, `docs/progress.md`, `docs/findings.md`, `docs/task_plan.md`)
- local tooling directories (`.claude/`, `.gstack/`, `.worktrees/`, `.venv/`, etc.)

The main issue is not hidden dot-directories; it is that long-lived docs, iteration plans, and operational runbooks are not clearly grouped. The cleanup should improve scanability without moving runtime-critical files like `Dockerfile`, `wrangler.toml`, or `pyproject.toml` away from the root.

## File Map

| File | Action | Responsibility |
|---|---|---|
| `docs/task_plan.md` | Move/Rewrite | Iteration tracker should live under an ops/iterations area |
| `docs/progress.md` | Move/Rewrite | Session progress log |
| `docs/findings.md` | Move/Rewrite | Discovery log |
| `docs/superpowers/plans/` | Keep but document | Implementation plans remain here |
| `DEPLOYMENT.md` | Move or cross-link | Could become `docs/ops/deployment.md` with root stub |
| `README.md` | Modify | Add repository map |
| `CLAUDE.md` | Modify if needed | Add file placement conventions |
| `docs/ops/` | Create | Operational docs home |
| `docs/iterations/` | Create | Iteration-specific plans/progress/findings |

---

### Task 1: Define target structure

**Files:**

- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add repository map to README**

Document top-level purpose of:

- `backend/`
- `frontend/`
- `worker/`
- `supabase/`
- `docs/`
- root runtime files (`Dockerfile`, `Makefile`, `pyproject.toml`, `wrangler.toml`)

- [ ] **Step 2: Add placement rules to CLAUDE.md**

Rules such as:

- runtime entrypoints stay at root or under `backend/interfaces/`
- operational docs go under `docs/ops/`
- iteration artifacts go under `docs/iterations/`
- implementation plans stay under `docs/superpowers/plans/`

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs(repo): add repository map and file placement rules"
```

---

### Task 2: Create ops and iteration doc homes

**Files:**

- Create: `docs/ops/README.md`
- Create: `docs/iterations/README.md`

- [ ] **Step 1: Create `docs/ops/README.md`**

Describe what belongs there:

- deployment
- Cloudflare hardening
- rollback notes
- observability runbooks

- [ ] **Step 2: Create `docs/iterations/README.md`**

Describe what belongs there:

- iteration task plans
- progress logs
- findings
- retrospective notes

- [ ] **Step 3: Commit**

```bash
git add docs/ops/README.md docs/iterations/README.md
git commit -m "docs(repo): create ops and iterations doc homes"
```

---

### Task 3: Move current iteration artifacts

**Files:**

- Move: `docs/task_plan.md`
- Move: `docs/progress.md`
- Move: `docs/findings.md`

- [ ] **Step 1: Move files under `docs/iterations/iter5/`**

Target structure:

- `docs/iterations/iter5/task_plan.md`
- `docs/iterations/iter5/progress.md`
- `docs/iterations/iter5/findings.md`

- [ ] **Step 2: Leave compatibility stubs if needed**

If any tooling still expects old paths, leave short stubs or update references first.

Example stub content:
```md
This file moved to `docs/iterations/iter5/task_plan.md`.
```

- [ ] **Step 3: Update references**

Search and update references in:

- `CLAUDE.md`
- `README.md`
- plan files if they mention old paths

- [ ] **Step 4: Commit**

```bash
git add docs/task_plan.md docs/progress.md docs/findings.md docs/iterations/iter5/
git commit -m "chore(repo): move iter5 execution artifacts under docs/iterations"
```

---

### Task 4: Normalize deployment docs placement

**Files:**

- Move or cross-link: `DEPLOYMENT.md`
- Create/Modify: `docs/ops/deployment.md`

- [ ] **Step 1: Move long-form deployment doc under docs/ops**

Preferred target:

- `docs/ops/deployment.md`

- [ ] **Step 2: Keep root `DEPLOYMENT.md` as a short pointer**

```md
Deployment documentation moved to `docs/ops/deployment.md`.
```

- [ ] **Step 3: Commit**

```bash
git add DEPLOYMENT.md docs/ops/deployment.md
git commit -m "docs(repo): move deployment runbook under docs/ops"
```

---

### Task 5: Verify nothing runtime-critical moved incorrectly

**Files:**

- Verify only

- [ ] **Step 1: Confirm root runtime files remain in place**

Must remain at root:

- `Dockerfile`
- `Makefile`
- `pyproject.toml`
- `wrangler.toml`
- `package.json` (if used for root tooling)

- [ ] **Step 2: Run documentation/reference search**

Ensure no broken internal paths remain.

- [ ] **Step 3: Commit verification note**

```bash
git commit --allow-empty -m "test(repo): verify structure cleanup leaves runtime entrypoints intact"
```
