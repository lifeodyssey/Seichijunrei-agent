---
paths:
  - "**/*"
---
# Git commit + .claude tracking

- The historical failure mode was commit-on-agent-stop plus separate PRs for review/CI repairs; do
  not repeat it under cleaner wording.
- A commit represents one independently reviewable outcome. Do not use commits as agent checkpoints,
  handoffs, review replies, formatter passes, or CI retries; keep related repairs in the same PR and
  amend before its first push when possible.
- Commit subjects and PR titles follow `<type>(<scope>): <short outcome>` and the repository validator
  in `commitlint.config.js` (the commit-msg hook locally, the `commits` job in CI). Never append
  Claude/Anthropic/Codex/OpenAI co-author or generated-by attribution. Do not use `--no-verify`.
- The git hooks run **more than ruff/mypy**. Every commit runs the fast gate — ruff + ruff-format +
  oxlint + **gitleaks (secret scan)** + whitespace/EOF fixers; commit-msg validates history hygiene;
  pre-push runs the affected packages' own gates. Any *fixer* hook (`ruff --fix`, `ruff-format`,
  `end-of-file-fixer`) can modify files and **abort the commit**.
- **After any failed commit, assume hooks modified/staged files**: `git status --short`, inspect,
  re-stage the intentional hook fixes, and retry.
- `.claude/` is **gitignored but selectively tracked** — some agents/skills/rules are force-added,
  others aren't. Before relying on a `.claude/` agent/hook/rule as repo-shared context, verify with
  `git ls-files`; new tracked additions under `.claude/` need an explicit `git add -f`.
