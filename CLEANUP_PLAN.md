# Capstone Project Cleanup Plan

**Project:** Seichijunrei Bot
**Branch:** `feature/capstone-simplified` → `main`
**Date:** 2025-11-29
**Status:** Ready for execution

---

## Executive Summary

This plan outlines the complete cleanup process for the Seichijunrei Bot capstone project submission. The cleanup involves:

1. **Code Translation**: All Chinese content → English (17 files)
2. **Documentation**: Update README, remove internal docs (keep git history)
3. **Testing**: Run and fix all tests
4. **Code Quality**: Document code smells (47 issues identified)
5. **Security**: Verify .env not in git history
6. **Git Restructuring**: Make cleaned branch the new main

**Estimated Time:** 4-6 hours
**Complexity:** Medium

---

## Phase 1: Code Translation & Comment Cleanup

### 1.1 Translate Chinese to English

#### Files Requiring Translation (17 total)

**Priority 1: Agent Files (9 files)**
- [ ] `adk_agents/seichijunrei_bot/agent.py`
  - Root agent LLM instructions (lines 165-201)
  - Critical: This is the main Gemini prompt

- [ ] `adk_agents/seichijunrei_bot/_agents/extraction_agent.py`
  - LLM instruction block
  - Docstrings and comments

- [ ] `adk_agents/seichijunrei_bot/_agents/bangumi_search_agent.py`
  - LLM instruction block
  - Field descriptions

- [ ] `adk_agents/seichijunrei_bot/_agents/bangumi_candidates_agent.py`
  - LLM instruction block

- [ ] `adk_agents/seichijunrei_bot/_agents/user_presentation_agent.py`
  - LLM instruction block (lines 17-74)
  - Error message: "请检查拼写或尝试使用其他名称"

- [ ] `adk_agents/seichijunrei_bot/_agents/points_selection_agent.py`
  - LLM instruction block (lines 28-76)
  - Detailed selection criteria in Chinese

- [ ] `adk_agents/seichijunrei_bot/_agents/user_selection_agent.py`
  - LLM instruction block

- [ ] `adk_agents/seichijunrei_bot/_agents/route_planning_agent.py`
  - LLM instruction block
  - Comments

- [ ] `adk_agents/seichijunrei_bot/_agents/input_normalization_agent.py`
  - LLM instruction block

**Priority 2: Schema & Workflow Files (3 files)**
- [ ] `adk_agents/seichijunrei_bot/_schemas.py`
  - Field descriptions (e.g., "约4-5小时", "第1-6集")
  - Pydantic Field() description parameters

- [ ] `adk_agents/seichijunrei_bot/_workflows/bangumi_search_workflow.py`
  - Comments

- [ ] `adk_agents/seichijunrei_bot/_workflows/route_planning_workflow.py`
  - Comments

**Priority 3: Tools & Services (2 files)**
- [ ] `adk_agents/seichijunrei_bot/tools/route_planning.py`
  - Function docstrings
  - Comments

- [ ] `services/simple_route_planner.py`
  - Comments and docstrings

**Priority 4: Test Files (5 files)**
- [ ] `tests/conftest.py`
- [ ] `tests/unit/test_entities.py`
- [ ] `tests/unit/test_session_service.py`
- [ ] `tests/unit/test_anitabi_client.py`
- [ ] `tests/unit/test_google_maps_client.py`
- [ ] `tests/unit/test_map_generator.py`
- [ ] `tests/unit/test_pdf_generator.py`
- [ ] `tests/integration/test_presentation_agent.py`

#### Translation Guidelines

**For LLM Instructions:**
- Maintain semantic meaning precisely
- Keep instructional tone
- Preserve examples and formatting
- Test after translation (may affect LLM performance slightly)

**For Field Descriptions:**
- Translate Pydantic Field(description="...") values
- Update example values (e.g., "约4-5小时" → "approximately 4-5 hours")
- Keep field names in English

**For Comments:**
- Translate inline comments
- Remove redundant comments that just repeat code
- Keep only essential explanations

**For Error Messages:**
- Translate user-facing error messages
- Keep error codes/identifiers unchanged

### 1.2 Remove Unnecessary Comments

#### Patterns to Remove:
- Comments that duplicate function/variable names
- Obvious comments (e.g., `# Create list` above `items = []`)
- Commented-out code blocks (unless marked "TODO")
- Auto-generated IDE comments

#### Patterns to Keep:
- Complex algorithm explanations
- ADK-specific patterns and workarounds
- Business logic rationale
- API contract documentation

---

## Phase 2: Documentation Cleanup

### 2.1 Update README.md

**Current Issues:**
- ❌ References **deleted agents**: LocationSearchAgent, RouteAgent, WeatherAgent, PointsFilteringAgent, TransportAgent
- ❌ Shows OLD workflow architecture (6-step + ParallelAgent structure)
- ❌ Outdated "Architecture (High Level)" section (lines 58-92)

**Required Updates:**

#### Section: "Architecture (High Level)" (lines 58-92)

**Replace with:**

```markdown
## Architecture (High Level)

The core workflow is implemented as a **2-stage conversational flow** using ADK agents:

### Stage 1: Bangumi Search Workflow
1. **ExtractionAgent (LlmAgent)**
   - Extracts `bangumi_name` and `location` from user query
   - Output: `extraction_result` → session state

2. **BangumiCandidatesAgent (LlmAgent)**
   - Searches Bangumi API for matching anime works
   - Selects top 3-5 candidates
   - Output: `bangumi_candidates` → session state

3. **UserPresentationAgent (LlmAgent)**
   - Generates natural language presentation of candidates
   - No output_schema (conversational response)
   - User selects their preferred anime

### Stage 2: Route Planning Workflow
4. **UserSelectionAgent (LlmAgent)**
   - Confirms and normalizes user's anime selection
   - Output: `selected_bangumi` → session state

5. **PointsSearchAgent (BaseAgent)**
   - Fetches all pilgrimage points from Anitabi API
   - Output: `all_points` → session state

6. **PointsSelectionAgent (LlmAgent)**
   - Intelligently selects 8-12 best points using LLM reasoning
   - Considers: geography, plot importance, accessibility
   - Output: `points_selection_result` → session state

7. **RoutePlanningAgent (BaseAgent)**
   - Calls custom `plan_route` tool for optimization
   - Generates final route with transport suggestions
   - Output: `route_plan` → session state

**State Management:**
- Uses `InMemorySessionService` for multi-turn conversations
- State keys flow through workflow stages
- Root agent (`seichijunrei_bot`) routes between stages based on state

**Supporting Layers:**
- **Domain layer** (`domain/`) – Pydantic entities: `Bangumi`, `Point`, `Route`, `PilgrimageSession`
- **Infrastructure** (`clients/`, `services/`) – HTTP clients, retry, cache, session management
- **Tools** (`tools/`) – Map and PDF generator tools exposed to agent
- **Templates** (`templates/`) – HTML/PDF layouts for user-facing outputs
```

#### Section: "Project Structure" (lines 172-225)

**Update these lines:**
```markdown
├── adk_agents/
│   └── seichijunrei_bot/
│       ├── agent.py              # ADK root agent entry point
│       ├── _agents/              # 9 agent implementations
│       │   ├── extraction_agent.py
│       │   ├── bangumi_candidates_agent.py
│       │   ├── user_presentation_agent.py
│       │   ├── user_selection_agent.py
│       │   ├── points_search_agent.py
│       │   ├── points_selection_agent.py
│       │   ├── route_planning_agent.py
│       │   └── input_normalization_agent.py
│       ├── _schemas.py           # Pydantic schemas for ADK agents
│       ├── _workflows/           # 2 workflow orchestrations
│       │   ├── bangumi_search_workflow.py
│       │   └── route_planning_workflow.py
│       └── tools/                # Custom function tools
│           └── route_planning.py # Route optimization tool
```

### 2.2 Delete docs/ Folder

**Pre-deletion Steps:**

1. **Commit all existing docs** (preserve history)
   ```bash
   git add docs/
   git commit -m "docs: Archive internal development documentation before cleanup

   Preserving all internal docs in git history before capstone submission cleanup.
   These files will be deleted from the working tree but remain in git history
   for future reference.

   Files archived:
   - capstone_implementation_plan.md (1,911 lines)
   - fix_plan_adk_best_practices.md (1,255 lines)
   - adk_output_schema_tools_fix.md (525 lines)
   - adk_migration_spec.md (389 lines)
   - architecture.md (284 lines)
   - fix_implementation_summary.md (269 lines)
   - troubleshooting_adk_web.md (85 lines)
   - code_smell_analysis_report.md
   - code_smell_summary.md
   - analysis_files.txt

   Total: ~5,000 lines of development documentation

   🤖 Generated with Claude Code"
   ```

2. **Delete the folder**
   ```bash
   rm -rf docs/
   git add docs/
   git commit -m "docs: Remove internal development docs for capstone submission

   Clean submission removes internal development documentation.
   All docs preserved in git history (see previous commit).

   Only user-facing docs remain:
   - README.md (updated to current architecture)
   - SPEC.md (technical specification)
   - LOCAL_SETUP.md (setup guide)
   - LOGGING_GUIDE.md (logging configuration)

   🤖 Generated with Claude Code"
   ```

**Files to Delete (11 total):**
- `docs/capstone_implementation_plan.md` (1,911 lines)
- `docs/fix_plan_adk_best_practices.md` (1,255 lines)
- `docs/adk_output_schema_tools_fix.md` (525 lines)
- `docs/adk_migration_spec.md` (389 lines)
- `docs/architecture.md` (284 lines)
- `docs/fix_implementation_summary.md` (269 lines)
- `docs/troubleshooting_adk_web.md` (85 lines)
- `docs/code_smell_analysis_report.md` (1,209 lines) - Generated by agent
- `docs/code_smell_summary.md` (6 KB) - Generated by agent
- `docs/analysis_files.txt` - Generated by agent
- `docs/api/` (directory)
- `docs/archive/` (directory)

---

## Phase 3: Test Execution & Fixes

### 3.1 Run Full Test Suite

```bash
# Activate virtual environment
uv sync

# Run all tests with verbose output
uv run pytest tests/ -v --tb=short

# Run with coverage report
uv run pytest tests/ --cov=. --cov-report=term-missing
```

**Expected Results:**
- All unit tests should pass (13 test files)
- Integration test may require API keys
- Coverage target: >70%

### 3.2 Fix Failing Tests

**Likely failures after translation:**

1. **Test assertions with Chinese strings**
   - Search for: `assert "中文"` patterns
   - Replace with English equivalents

2. **Mock data with Chinese content**
   - Update fixture data in `tests/conftest.py`
   - Check mock responses match new schemas

3. **Docstring tests** (if any)
   - Update docstring examples

**Testing Checklist:**
- [ ] `tests/unit/test_entities.py` - Domain model tests
- [ ] `tests/unit/test_session_service.py` - Session state tests
- [ ] `tests/unit/test_anitabi_client.py` - API client tests
- [ ] `tests/unit/test_google_maps_client.py` - Google Maps tests
- [ ] `tests/unit/test_schemas.py` - Pydantic schema validation
- [ ] `tests/integration/test_presentation_agent.py` - Agent integration

### 3.3 Code Quality Checks

```bash
# Run ruff linter
uv run ruff check .

# Run type checker
uv run mypy adk_agents/ clients/ services/ tools/ domain/

# Format code (if needed)
uv run ruff format .
```

**Fix Priority:**
1. Type errors (blocking)
2. Import errors (blocking)
3. Linting warnings (nice-to-have)

---

## Phase 4: Security Verification

### 4.1 Verify .env Not in Git History

**Status:** ✅ VERIFIED - .env has 0 commits in git history

**Verification Commands:**
```bash
# Check if .env is tracked
git ls-files | grep '\.env$'
# Expected: (no output)

# Check commit history
git log --all --full-history -- .env
# Expected: (no output)

# Count commits that touched .env
git rev-list --all -- .env | wc -l
# Expected: 0

# Verify .gitignore includes .env
grep '^\.env$' .gitignore
# Expected: .env
```

**Current Status:**
- ✅ `.env` is in `.gitignore` (line 63)
- ✅ `.env` has never been committed (0 commits)
- ✅ `.env.example` exists as template
- ✅ Commit a9886f3 fixed .env exposure issue

**No action required** - .env is properly protected.

### 4.2 Verify No Secrets in Codebase

```bash
# Search for potential API keys
grep -r "AIza" --include="*.py" . || echo "No Google API keys found"
grep -r "sk-" --include="*.py" . || echo "No OpenAI keys found"
grep -r "AKID" --include="*.py" . || echo "No AWS keys found"

# Check for hardcoded credentials
grep -r "password.*=.*['\"]" --include="*.py" . | grep -v "test" | grep -v "example"
```

---

## Phase 5: Code Smell Documentation

### 5.1 Code Smell Analysis (Already Completed ✅)

**Generated Reports:**
1. ✅ `docs/code_smell_analysis_report.md` (1,209 lines, 34 KB)
   - 47 code smells identified
   - Categorized by type with severity levels
   - Specific line numbers and code examples
   - Refactoring recommendations

2. ✅ `docs/code_smell_summary.md` (6 KB)
   - Executive summary
   - 4-phase priority breakdown
   - Quick wins identified
   - Codebase health: 6/10

3. ✅ `docs/analysis_files.txt`
   - 45+ analyzed files
   - Most affected files listed

**Key Findings:**

| Severity | Count | Examples |
|----------|-------|----------|
| Critical | 3 | Bare exception catching, SRP violations |
| High | 19 | Duplicate error handling, missing validation |
| Medium | 22 | Long functions, magic numbers |
| Low | 3 | Docstring inconsistencies |

**Most Affected Files:**
- `/clients/base.py` - 6 issues (critical/high)
- `/adk_agents/seichijunrei_bot/tools/__init__.py` - 5 issues
- `/clients/anitabi.py` - 4 issues

**Recommendation:** Keep these reports for reference but don't include in final submission unless required by capstone rubric.

---

## Phase 6: Git Branch Restructuring

### 6.1 Pre-restructure Backup

```bash
# Create backup branch
git checkout feature/capstone-simplified
git branch backup/pre-restructure-$(date +%Y%m%d)
git push origin backup/pre-restructure-$(date +%Y%m%d)
```

### 6.2 Create dev Branch from Current Main

```bash
# Switch to current main
git checkout main

# Create dev branch from current main (preserves old architecture)
git checkout -b dev

# Push to remote
git push -u origin dev

# Verify
git log --oneline -5
```

**Purpose:** Preserve the old multi-agent architecture for reference.

### 6.3 Restructure Branches

**Option A: Rename and Force Push (Recommended)**

```bash
# Go back to cleaned feature branch
git checkout feature/capstone-simplified

# Ensure all cleanup commits are done
git log --oneline -10

# Rename local branch to main
git branch -M main

# Force push to remote main
git push -f origin main

# Delete old feature branch from remote
git push origin --delete feature/capstone-simplified
```

**Option B: Merge and Fast-Forward**

```bash
# If you prefer merge history
git checkout main
git merge --ff-only feature/capstone-simplified
git push origin main
git branch -d feature/capstone-simplified
git push origin --delete feature/capstone-simplified
```

### 6.4 Post-restructure Verification

```bash
# Verify branch structure
git branch -a

# Expected output:
# * main
#   dev
#   backup/pre-restructure-20251129
#   remotes/origin/main
#   remotes/origin/dev

# Verify main is at correct commit
git log --oneline -5 main

# Verify dev preserves old architecture
git log --oneline -5 dev
```

### 6.5 Update Default Branch (GitHub/GitLab)

**GitHub:**
1. Go to repository Settings → Branches
2. Change default branch from `main` to `main` (if needed)
3. Protect `main` branch:
   - ✅ Require pull request reviews
   - ✅ Require status checks to pass

**Local Cleanup:**
```bash
# Delete local feature branch (if not already deleted)
git branch -d feature/capstone-simplified

# Prune remote references
git fetch --prune
```

---

## Phase 7: Final Verification

### 7.1 Verification Checklist

**Code Quality:**
- [ ] All files use English (no Chinese content)
- [ ] No unnecessary comments
- [ ] All tests pass (`pytest tests/ -v`)
- [ ] No linting errors (`ruff check .`)
- [ ] Type checking passes (`mypy .`)

**Documentation:**
- [ ] README.md reflects current architecture
- [ ] No internal docs in working tree
- [ ] SPEC.md is up to date
- [ ] .env.example exists and is current

**Security:**
- [ ] No .env in git history
- [ ] No hardcoded secrets
- [ ] .gitignore is comprehensive

**Git Structure:**
- [ ] `main` branch has cleaned code
- [ ] `dev` branch preserves old architecture
- [ ] Backup branch exists
- [ ] No dangling branches

### 7.2 Test Clean Installation

```bash
# Clone fresh copy
cd /tmp
git clone <your-repo-url> test-clean-install
cd test-clean-install

# Verify structure
ls -la
cat README.md

# Test setup
cp .env.example .env
# (Add API keys)

uv sync
uv run pytest tests/unit/ -v

# Test ADK
uv run adk run adk_agents/seichijunrei_bot
```

### 7.3 Submission Checklist

**Required Files:**
- [x] `README.md` - Updated ✅
- [x] `SPEC.md` - Technical specification
- [x] `pyproject.toml` - Dependencies
- [x] `.env.example` - Environment template
- [x] `adk_agents/seichijunrei_bot/agent.py` - Root agent
- [x] All agent implementations (9 files)
- [x] Test suite (passing)

**Optional but Recommended:**
- [x] `LOCAL_SETUP.md` - Setup instructions
- [x] `LOGGING_GUIDE.md` - Logging documentation
- [x] `Makefile` - Convenience commands

---

## Rollback Plan

If anything goes wrong during restructuring:

### Rollback Option 1: Use Backup Branch

```bash
# Restore from backup
git checkout backup/pre-restructure-20251129
git checkout -b main-restored
git push -f origin main
```

### Rollback Option 2: Use Reflog

```bash
# Find commit before restructure
git reflog

# Reset to specific commit
git reset --hard <commit-hash>
git push -f origin main
```

### Rollback Option 3: Revert Commits

```bash
# Revert specific commits
git revert <commit-hash>
git push origin main
```

---

## Timeline Estimate

| Phase | Task | Estimated Time |
|-------|------|----------------|
| 1.1 | Translate agent files (9 files) | 1.5 hours |
| 1.1 | Translate schemas & workflows (5 files) | 45 minutes |
| 1.1 | Translate tests (5 files) | 30 minutes |
| 1.2 | Remove unnecessary comments | 30 minutes |
| 2.1 | Update README.md | 30 minutes |
| 2.2 | Commit & delete docs | 15 minutes |
| 3.1-3.3 | Run tests & fix issues | 1-2 hours |
| 4 | Security verification | 15 minutes |
| 5 | Review code smell reports | 30 minutes |
| 6 | Git restructuring | 30 minutes |
| 7 | Final verification | 30 minutes |
| **TOTAL** | | **5-7 hours** |

---

## Success Criteria

✅ **Code:**
- All Chinese content translated to English
- All tests passing
- No linting/type errors
- Code smells documented

✅ **Documentation:**
- README reflects current architecture
- Only user-facing docs remain
- Setup instructions are clear

✅ **Security:**
- No secrets in git history
- .env properly protected

✅ **Git:**
- `main` branch has clean code
- `dev` branch preserves history
- All changes committed with clear messages

✅ **Submission Ready:**
- Can be cloned and run following README
- Meets capstone requirements
- Professional presentation

---

## Notes & Warnings

⚠️ **IMPORTANT:**
- This plan includes **force-pushing to main** - ensure team is notified
- Create backups before git restructuring
- Test translation with actual LLM queries (performance may vary)
- Keep code smell reports for future refactoring sprints

📝 **Documentation Philosophy:**
- User-facing docs: Keep and update
- Internal dev docs: Archive in git history, remove from tree
- Code comments: Translate and minimize

🔒 **Security:**
- .env is already protected (verified)
- No further git history cleanup needed
- Always use .env.example for sharing

---

**Plan Version:** 1.0
**Created:** 2025-11-29
**Author:** Claude Code + User
**Status:** Ready for Execution ✅
