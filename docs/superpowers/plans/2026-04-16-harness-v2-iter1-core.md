# Harness v2 Iteration 1: Core Scaffold + Single-Agent UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get a working Gradio UI that can open a real ClaudeSDKClient session, stream tool calls to the chat, support interrupt/resume, and switch between agent modes. This is the vertical slice that validates the entire architecture.

**Architecture:** `harness/app.py` (Gradio) calls `harness/stream.py` (SDK proxy) which wraps `ClaudeSDKClient`. State in `harness/state.py`. Agent configs in `harness/agents.py`.

**Tech Stack:** Python 3.13, Gradio 6.x, claude-agent-sdk, asyncio

**Design doc:** `~/.gstack/projects/harness-engineering/lumimamini-unknown-design-20260416-094121.md`

**Depends on:** SDK spike results confirmed in `harness-engineering/mockups/spike_session.py`

---

## File Structure

```
harness/
  __init__.py           # Package marker
  state.py              # Phase enum, SprintState, AgentSession dataclass
  agents.py             # Agent configs (name, model, tools, system_prompt)
  stream.py             # ClaudeSDKClient -> async generator stream proxy
  app.py                # Gradio UI entry point
harness/tests/
  __init__.py
  test_state.py         # Phase transitions, serialization
  test_agents.py        # Config validation
  test_stream.py        # Mock SDK client, stream formatting
  conftest.py           # Shared fixtures
```

---

### Task 1: Project Setup

**Files:**
- Create: `harness/__init__.py`
- Create: `harness/tests/__init__.py`
- Create: `harness/tests/conftest.py`
- Modify: `pyproject.toml` (add deps)

- [ ] **Step 1: Create harness package**

```bash
mkdir -p harness/tests
touch harness/__init__.py harness/tests/__init__.py
```

- [ ] **Step 2: Add dependencies to pyproject.toml**

Add to `[project.dependencies]`:
```toml
    # Harness
    "claude-agent-sdk>=0.1.0",
    "gradio>=6.12.0",
```

- [ ] **Step 3: Install dependencies**

```bash
uv sync
```

Expected: resolves and installs claude-agent-sdk + gradio. May need `uv pip install "httpx[socks]"` if SOCKS proxy is configured.

- [ ] **Step 4: Create conftest with shared fixtures**

```python
# harness/tests/conftest.py
import pytest
from unittest.mock import AsyncMock, MagicMock
from claude_agent_sdk import (
    AssistantMessage, ResultMessage, TextBlock, ToolUseBlock, ToolResultBlock,
    ThinkingBlock, SystemMessage, UserMessage,
)


@pytest.fixture
def mock_text_message():
    """AssistantMessage with a single TextBlock."""
    def _make(text: str) -> AssistantMessage:
        msg = MagicMock(spec=AssistantMessage)
        block = MagicMock(spec=TextBlock)
        block.text = text
        msg.content = [block]
        return msg
    return _make


@pytest.fixture
def mock_tool_message():
    """AssistantMessage with a ToolUseBlock."""
    def _make(name: str, input_data: dict) -> AssistantMessage:
        msg = MagicMock(spec=AssistantMessage)
        block = MagicMock(spec=ToolUseBlock)
        block.name = name
        block.input = input_data
        block.id = "toolu_test123"
        msg.content = [block]
        return msg
    return _make


@pytest.fixture
def mock_result_message():
    """ResultMessage indicating completion."""
    def _make(subtype: str = "success", duration_ms: int = 5000, num_turns: int = 3) -> ResultMessage:
        msg = MagicMock(spec=ResultMessage)
        msg.subtype = subtype
        msg.duration_ms = duration_ms
        msg.num_turns = num_turns
        msg.is_error = "error" in subtype
        return msg
    return _make


@pytest.fixture
def mock_tool_result():
    """UserMessage with ToolResultBlock."""
    def _make(content: str, is_error: bool = False) -> UserMessage:
        msg = MagicMock(spec=UserMessage)
        block = MagicMock(spec=ToolResultBlock)
        block.content = content
        block.is_error = is_error
        msg.content = [block]
        return msg
    return _make
```

- [ ] **Step 5: Verify test setup**

```bash
cd /Users/lumimamini/Documents/Seichijunrei-agent
uv run pytest harness/tests/ -v --co
```

Expected: `no tests ran` (collected 0, no errors)

- [ ] **Step 6: Commit**

```bash
git add harness/ pyproject.toml
git commit -m "feat(harness): init package with test fixtures"
```

---

### Task 2: State Module

**Files:**
- Create: `harness/state.py`
- Create: `harness/tests/test_state.py`

- [ ] **Step 1: Write failing tests for Phase enum and AgentSession**

```python
# harness/tests/test_state.py
from harness.state import Phase, AgentSession


class TestPhase:
    def test_all_phases_exist(self):
        expected = {
            "idle", "planning", "spec_approval", "designing",
            "card_approval", "executing", "verifying", "routing",
            "reviewing", "testing", "merging", "escalated", "complete",
        }
        actual = {p.value for p in Phase}
        assert actual == expected

    def test_phase_is_terminal(self):
        assert Phase.COMPLETE.is_terminal is True
        assert Phase.ESCALATED.is_terminal is True
        assert Phase.EXECUTING.is_terminal is False
        assert Phase.IDLE.is_terminal is False


class TestAgentSession:
    def test_create_session(self):
        session = AgentSession(name="executor-fix-route", agent_type="Executor")
        assert session.name == "executor-fix-route"
        assert session.agent_type == "Executor"
        assert session.status == "idle"
        assert session.chat_history == []
        assert session.client is None

    def test_record_event(self):
        session = AgentSession(name="test", agent_type="Executor")
        session.record("query", "implement the feature")
        assert len(session.log) == 1
        assert session.log[0]["action"] == "query"
        assert session.last_activity != "-"

    def test_log_max_length(self):
        session = AgentSession(name="test", agent_type="Executor")
        for i in range(150):
            session.record("event", f"detail {i}")
        assert len(session.log) == 100  # capped at 100
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run pytest harness/tests/test_state.py -v
```

Expected: `ModuleNotFoundError: No module named 'harness.state'`

- [ ] **Step 3: Implement state.py**

```python
# harness/state.py
"""Harness state machine: Phase enum, AgentSession, SprintState."""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any


class Phase(Enum):
    IDLE = "idle"
    PLANNING = "planning"
    AWAITING_SPEC_APPROVAL = "spec_approval"
    DESIGNING = "designing"
    AWAITING_CARD_APPROVAL = "card_approval"
    EXECUTING = "executing"
    VERIFYING = "verifying"
    ROUTING = "routing"
    REVIEWING = "reviewing"
    TESTING = "testing"
    MERGING = "merging"
    ESCALATED = "escalated"
    COMPLETE = "complete"

    @property
    def is_terminal(self) -> bool:
        return self in (Phase.COMPLETE, Phase.ESCALATED)


@dataclass
class AgentSession:
    """Tracks one agent's session state, chat history, and activity log."""
    name: str
    agent_type: str
    client: Any = None  # ClaudeSDKClient instance, if open
    status: str = "idle"
    last_tool: str = "-"
    last_activity: str = "-"
    message_count: int = 0
    chat_history: list = field(default_factory=list)
    log: list = field(default_factory=list)
    is_streaming: bool = False

    def record(self, action: str, detail: str = ""):
        ts = datetime.now().strftime("%H:%M:%S")
        self.last_activity = f"{ts} {action}"
        self.log.append({"ts": ts, "action": action, "detail": detail[:150]})
        if len(self.log) > 100:
            self.log = self.log[-100:]
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
uv run pytest harness/tests/test_state.py -v
```

Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add harness/state.py harness/tests/test_state.py
git commit -m "feat(harness): state module with Phase enum and AgentSession"
```

---

### Task 3: Agent Configs

**Files:**
- Create: `harness/agents.py`
- Create: `harness/tests/test_agents.py`

- [ ] **Step 1: Write failing tests**

```python
# harness/tests/test_agents.py
from harness.agents import AGENT_CONFIGS, get_agent_options


class TestAgentConfigs:
    def test_all_agents_defined(self):
        expected = {"Executor", "Reviewer", "Tester", "Planner", "Designer", "Router", "Verifier"}
        assert set(AGENT_CONFIGS.keys()) == expected

    def test_executor_has_write_tools(self):
        config = AGENT_CONFIGS["Executor"]
        assert "Write" in config["tools"]
        assert "Edit" in config["tools"]
        assert "Bash" in config["tools"]

    def test_reviewer_is_readonly(self):
        config = AGENT_CONFIGS["Reviewer"]
        assert "Write" not in config["tools"]
        assert "Edit" not in config["tools"]

    def test_tester_has_no_read(self):
        config = AGENT_CONFIGS["Tester"]
        assert "Read" not in config["tools"]

    def test_get_agent_options_returns_valid(self):
        opts = get_agent_options("Executor")
        assert opts is not None
        assert opts.system_prompt is not None
        assert opts.allowed_tools is not None

    def test_system_prompts_have_linus(self):
        """Executor and Reviewer prompts start with 'You are Linus'."""
        for name in ("Executor", "Reviewer"):
            config = AGENT_CONFIGS[name]
            assert config["system_prompt"].startswith("You are Linus")
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run pytest harness/tests/test_agents.py -v
```

Expected: `ModuleNotFoundError`

- [ ] **Step 3: Implement agents.py**

```python
# harness/agents.py
"""Agent definitions: configs, system prompts, tool sets, options factory."""

from claude_agent_sdk import ClaudeAgentOptions


AGENT_CONFIGS: dict[str, dict] = {
    "Executor": {
        "system_prompt": (
            "You are Linus, the Executor agent in a harness orchestrator. "
            "You implement features using TDD: write failing test first, then implement, then verify. "
            "Use clean code principles. Methods under 10 lines. No hardcoded return values. "
            "After implementation, run tests, create a PR, and read bot comments to fix issues."
        ),
        "tools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "LSP"],
        "model": "sonnet",
        "icon": "⚡",
        "transport": "session",
    },
    "Reviewer": {
        "system_prompt": (
            "You are Linus, the Reviewer agent in a harness orchestrator. "
            "You review code for SOLID principles, clean code, naming, and security. "
            "You are READ-ONLY. Never write or edit files. "
            "Post findings as PR comments with priority (P0/P1/P2), file, line, issue, and fix. "
            "Check Codecov patch coverage: require 95%+ or flag as P1."
        ),
        "tools": ["Read", "Glob", "Grep", "Bash"],
        "model": "sonnet",
        "icon": "🔍",
        "transport": "session",
    },
    "Tester": {
        "system_prompt": (
            "You are the Tester agent. Test via browser and API ONLY. "
            "You CANNOT read source code. Test each acceptance criterion. "
            "Collect evidence (API responses, screenshots). "
            "Report verdict: approve or request_changes with blocking findings."
        ),
        "tools": ["Bash"],
        "model": "sonnet",
        "icon": "🧪",
        "transport": "session",
    },
    "Planner": {
        "system_prompt": (
            "You are the Planner agent. Read codebase and GitHub issues to produce a sprint spec: "
            "task breakdown, acceptance criteria, wave graph, and design flags."
        ),
        "tools": ["Read", "Glob", "Grep", "WebFetch"],
        "model": "sonnet",
        "icon": "📋",
        "transport": "session",
    },
    "Designer": {
        "system_prompt": (
            "You are the Designer agent. Generate HTML mockup variants for frontend tasks. "
            "Use the project's design tokens from .impeccable.md if it exists."
        ),
        "tools": ["Read", "Bash", "Glob", "Grep", "WebFetch"],
        "model": "sonnet",
        "icon": "🎨",
        "transport": "session",
    },
    "Router": {
        "system_prompt": (
            "You are the Router agent. Given current state, last agent result, and attempt count, "
            "decide the next action. Output JSON only: "
            '{"decision": "proceed_to_review|proceed_to_test|re_execute|re_execute_with_findings|skip|escalate_to_human|merge", '
            '"reason": "one line explanation"}'
        ),
        "tools": [],
        "model": "sonnet",
        "icon": "🔀",
        "transport": "oneshot",
    },
    "Verifier": {
        "system_prompt": (
            "You are the Verifier agent. Check if the agent's output meets the card's acceptance criteria. "
            "You receive: card ACs, git diff, agent summary, test results. "
            "Output JSON only: "
            '{"approved": true/false, "ac_results": [{"ac": "...", "met": true/false, "evidence": "..."}], '
            '"issues": ["..."]}'
        ),
        "tools": ["Read"],
        "model": "sonnet",
        "icon": "✓",
        "transport": "oneshot",
    },
}


def get_agent_options(agent_type: str) -> ClaudeAgentOptions:
    """Create ClaudeAgentOptions for a given agent type."""
    config = AGENT_CONFIGS[agent_type]
    return ClaudeAgentOptions(
        system_prompt=config["system_prompt"],
        allowed_tools=config["tools"] if config["tools"] else [],
        permission_mode="acceptEdits",
        max_turns=30,
    )
```

- [ ] **Step 4: Run tests**

```bash
uv run pytest harness/tests/test_agents.py -v
```

Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add harness/agents.py harness/tests/test_agents.py
git commit -m "feat(harness): agent configs with Linus persona and permission boundaries"
```

---

### Task 4: Stream Proxy

**Files:**
- Create: `harness/stream.py`
- Create: `harness/tests/test_stream.py`

This is the hardest module. It wraps ClaudeSDKClient into an async generator that Gradio can consume.

- [ ] **Step 1: Write failing tests for message formatting**

```python
# harness/tests/test_stream.py
import json
import pytest
from unittest.mock import MagicMock, AsyncMock
from claude_agent_sdk import (
    AssistantMessage, ResultMessage, SystemMessage,
    UserMessage, TextBlock, ToolUseBlock, ToolResultBlock, ThinkingBlock,
)
from harness.stream import format_sdk_message


class TestFormatMessage:
    def test_format_text_block(self, mock_text_message):
        msg = mock_text_message("Hello from the agent")
        result = format_sdk_message(msg, "test-agent")
        assert result is not None
        assert "Hello from the agent" in result

    def test_format_tool_use_block(self, mock_tool_message):
        msg = mock_tool_message("Read", {"file_path": "src/main.py"})
        result = format_sdk_message(msg, "test-agent")
        assert result is not None
        assert "Read" in result
        assert "main.py" in result

    def test_format_tool_result(self, mock_tool_result):
        msg = mock_tool_result("file contents here")
        result = format_sdk_message(msg, "test-agent")
        assert result is not None
        assert "file contents" in result

    def test_format_tool_result_error(self, mock_tool_result):
        msg = mock_tool_result("permission denied", is_error=True)
        result = format_sdk_message(msg, "test-agent")
        assert "❌" in result

    def test_format_result_success(self, mock_result_message):
        msg = mock_result_message("success", duration_ms=5000, num_turns=3)
        result = format_sdk_message(msg, "test-agent")
        assert "✅" in result
        assert "5.0s" in result

    def test_format_result_error(self, mock_result_message):
        msg = mock_result_message("error_during_execution")
        result = format_sdk_message(msg, "test-agent")
        assert "⚠️" in result

    def test_format_system_init(self):
        msg = MagicMock(spec=SystemMessage)
        msg.subtype = "init"
        msg.data = {"cwd": "/path/to/project"}
        result = format_sdk_message(msg, "test-agent")
        assert "Session started" in result

    def test_format_system_hook_returns_none(self):
        msg = MagicMock(spec=SystemMessage)
        msg.subtype = "hook_started"
        result = format_sdk_message(msg, "test-agent")
        assert result is None

    def test_format_thinking_block(self):
        msg = MagicMock(spec=AssistantMessage)
        block = MagicMock(spec=ThinkingBlock)
        block.thinking = "Let me analyze this..."
        msg.content = [block]
        result = format_sdk_message(msg, "test-agent")
        assert "💭" in result
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run pytest harness/tests/test_stream.py -v
```

Expected: `ModuleNotFoundError`

- [ ] **Step 3: Implement stream.py**

```python
# harness/stream.py
"""Stream proxy: formats ClaudeSDKClient messages for Gradio display."""

import json
from claude_agent_sdk import (
    AssistantMessage, ResultMessage, SystemMessage,
    UserMessage, TextBlock, ToolUseBlock, ToolResultBlock,
    ThinkingBlock, RateLimitEvent,
)


def format_sdk_message(msg, agent_name: str) -> str | None:
    """Format a single SDK stream message for Gradio chat display.

    Returns formatted string or None (skip this message).
    """
    if isinstance(msg, AssistantMessage):
        parts = []
        for block in msg.content:
            if isinstance(block, ThinkingBlock):
                text = block.thinking[:300]
                suffix = "..." if len(block.thinking) > 300 else ""
                parts.append(f"💭 *{text}{suffix}*")
            elif isinstance(block, TextBlock):
                parts.append(block.text)
            elif isinstance(block, ToolUseBlock):
                input_str = json.dumps(block.input, ensure_ascii=False)
                if len(input_str) > 150:
                    input_str = input_str[:147] + "..."
                parts.append(f"🔧 **{block.name}**\n```json\n{input_str}\n```")
        return "\n\n".join(parts) if parts else None

    if isinstance(msg, UserMessage):
        for block in msg.content:
            if isinstance(block, ToolResultBlock):
                content = str(block.content)[:500]
                if block.is_error:
                    return f"❌ **Error:**\n```\n{content}\n```"
                return f"```\n{content}\n```"
        return None

    if isinstance(msg, ResultMessage):
        duration = f" ({msg.duration_ms / 1000:.1f}s)" if msg.duration_ms else ""
        turns = f", {msg.num_turns} turns" if msg.num_turns else ""
        if msg.is_error:
            return f"⚠️ **Ended:** `{msg.subtype}`{duration}{turns}"
        return f"✅ **Done**{duration}{turns}"

    if isinstance(msg, SystemMessage):
        if msg.subtype == "init":
            return "📂 Session started"
        return None  # skip hooks, api_retry, etc.

    if isinstance(msg, RateLimitEvent):
        return None

    return None
```

- [ ] **Step 4: Run tests**

```bash
uv run pytest harness/tests/test_stream.py -v
```

Expected: 9 passed

- [ ] **Step 5: Commit**

```bash
git add harness/stream.py harness/tests/test_stream.py
git commit -m "feat(harness): stream proxy with SDK message formatting"
```

---

### Task 5: Gradio App (Single-Agent Mode)

**Files:**
- Create: `harness/app.py`

This task creates the Gradio UI with dynamic nav rail and real SDK streaming. No orchestrator logic yet — just direct agent chat with mode switching.

- [ ] **Step 1: Create app.py with full Gradio UI**

```python
# harness/app.py
"""Seichijunrei Harness v2 — Gradio UI with real ClaudeSDKClient sessions."""

import gradio as gr
import asyncio
import json
from datetime import datetime

from harness.state import AgentSession
from harness.agents import AGENT_CONFIGS, get_agent_options
from harness.stream import format_sdk_message

from claude_agent_sdk import (
    ClaudeSDKClient, AssistantMessage, ResultMessage,
    SystemMessage, UserMessage,
)


# ── Global State ──

sessions: dict[str, AgentSession] = {}
global_log: list[dict] = []
focused: str = "Orchestrator"


def log_event(agent: str, action: str, detail: str = ""):
    ts = datetime.now().strftime("%H:%M:%S")
    global_log.append({"ts": ts, "agent": agent, "action": action, "detail": detail[:150]})
    if len(global_log) > 200:
        global_log[:] = global_log[-200:]
    if agent in sessions:
        sessions[agent].record(action, detail)


# ── Session Management ──

async def ensure_session(name: str, agent_type: str) -> AgentSession:
    """Open or return existing session."""
    if name in sessions and sessions[name].client is not None:
        return sessions[name]

    session = AgentSession(name=name, agent_type=agent_type)
    opts = get_agent_options(agent_type)
    client = ClaudeSDKClient(options=opts)
    await client.__aenter__()
    session.client = client
    session.status = "ready"
    sessions[name] = session
    log_event(name, "session_open", f"type={agent_type}")
    return session


async def close_session(name: str):
    if name in sessions and sessions[name].client:
        try:
            await sessions[name].client.__aexit__(None, None, None)
        except Exception:
            pass
        sessions[name].client = None
        sessions[name].status = "closed"
        sessions[name].is_streaming = False
        log_event(name, "session_closed")


# ── Renderers ──

def render_status():
    if not sessions:
        return "No active sessions."
    lines = ["| | Agent | Type | Status | Last Tool | Messages |",
             "|---|-------|------|--------|-----------|----------|"]
    for name, s in sessions.items():
        icon = AGENT_CONFIGS.get(s.agent_type, {}).get("icon", "❓")
        focus_mark = "→ " if name == focused else ""
        lines.append(f"| {focus_mark}{icon} | {name} | {s.agent_type} | {s.status} | {s.last_tool} | {s.message_count} |")
    return "\n".join(lines)


def render_timeline():
    if not global_log:
        return "*No events.*"
    lines = []
    for e in global_log[-40:]:
        detail = f" — {e['detail']}" if e['detail'] else ""
        lines.append(f"`{e['ts']}` **{e['agent']}** {e['action']}{detail}")
    return "\n".join(lines)


def get_nav_choices():
    choices = ["Orchestrator"]
    for name in sessions:
        if name not in choices:
            choices.append(name)
    # Add default agent types if no sessions exist
    if len(choices) == 1:
        choices.extend(list(AGENT_CONFIGS.keys()))
    return choices


# ── Chat Handler ──

async def chat_stream(message: str, history: list, nav_choice: str):
    global focused
    if not message.strip():
        yield history
        return

    focused = nav_choice
    history = history + [{"role": "user", "content": message}]
    yield history

    # Determine agent type and session name
    if nav_choice in AGENT_CONFIGS:
        agent_type = nav_choice
        session_name = nav_choice
    elif nav_choice in sessions:
        session_name = nav_choice
        agent_type = sessions[nav_choice].agent_type
    else:
        agent_type = "Executor"
        session_name = nav_choice

    # Open session
    try:
        session = await ensure_session(session_name, agent_type)
    except Exception as e:
        history = history + [{"role": "assistant", "content": f"❌ Session failed: {e}"}]
        yield history
        return

    # Stream query
    session.is_streaming = True
    session.status = "streaming"
    session.message_count += 1
    log_event(session_name, "query", message[:100])

    try:
        await session.client.query(message)
        current_content = ""

        async for msg in session.client.receive_response():
            formatted = format_sdk_message(msg, session_name)
            if not formatted:
                continue

            # Update agent last_tool for ToolUseBlock
            if isinstance(msg, AssistantMessage):
                from claude_agent_sdk import ToolUseBlock
                for block in msg.content:
                    if isinstance(block, ToolUseBlock):
                        session.last_tool = f"🔧 {block.name}"
                        session.status = f"🔧 {block.name}..."

            if current_content:
                current_content += "\n\n" + formatted
            else:
                current_content = formatted

            # Stream to Gradio
            if history and history[-1]["role"] == "assistant" and history[-1].get("_live"):
                history[-1] = {"role": "assistant", "content": current_content, "_live": True}
            else:
                history = history + [{"role": "assistant", "content": current_content, "_live": True}]

            session.chat_history = [h for h in history if not h.get("_live", False) or h == history[-1]]
            yield history

        # Clean up live flag
        if history and history[-1].get("_live"):
            history[-1] = {"role": "assistant", "content": history[-1]["content"]}
            session.chat_history = history

        session.status = "ready"
        session.is_streaming = False
        log_event(session_name, "done")
        yield history

    except Exception as e:
        history = history + [{"role": "assistant", "content": f"❌ {e}"}]
        session.status = "error"
        session.is_streaming = False
        log_event(session_name, "error", str(e)[:100])
        yield history


async def do_interrupt():
    if focused in sessions:
        s = sessions[focused]
        if s.client and s.is_streaming:
            try:
                await s.client.interrupt()
                s.status = "interrupted"
                s.is_streaming = False
                log_event(s.name, "interrupted")
            except Exception:
                pass
    return render_status()


async def do_close():
    await close_session(focused)
    return [], render_status(), render_timeline()


async def do_close_all():
    for name in list(sessions.keys()):
        await close_session(name)
    sessions.clear()
    global_log.clear()
    return [], render_status(), render_timeline(), gr.update(choices=get_nav_choices(), value="Orchestrator")


def do_switch(nav_choice: str):
    global focused
    focused = nav_choice
    if nav_choice in sessions:
        return sessions[nav_choice].chat_history, render_status()
    return [], render_status()


# ── Gradio UI ──

with gr.Blocks(title="Seichijunrei Harness v2") as demo:
    gr.Markdown("# 🎯 Seichijunrei Harness v2")

    status_panel = gr.Markdown(render_status())

    with gr.Row():
        nav = gr.Dropdown(
            choices=get_nav_choices(), value="Orchestrator",
            label="Agent", scale=2,
            info="Select agent — each has its own session and chat history",
        )
        interrupt_btn = gr.Button("⏹ Interrupt", variant="stop", scale=1)
        close_btn = gr.Button("🔚 Close", scale=1)
        close_all_btn = gr.Button("🗑 Reset", variant="secondary", scale=1)

    with gr.Row():
        with gr.Column(scale=3):
            chatbot = gr.Chatbot(height=500, placeholder="Send a message to start a real agent session.")
            msg = gr.Textbox(placeholder="Message to agent...", show_label=False, container=False)

        with gr.Column(scale=1):
            timeline = gr.Markdown(render_timeline())
            gr.Button("🔄 Refresh", size="sm").click(render_timeline, outputs=[timeline])

    def post_chat():
        return "", render_status(), render_timeline(), gr.update(choices=get_nav_choices())

    msg.submit(chat_stream, [msg, chatbot, nav], [chatbot]).then(
        post_chat, outputs=[msg, status_panel, timeline, nav]
    )
    nav.change(do_switch, [nav], [chatbot, status_panel])
    interrupt_btn.click(do_interrupt, outputs=[status_panel])
    close_btn.click(do_close, outputs=[chatbot, status_panel, timeline])
    close_all_btn.click(do_close_all, outputs=[chatbot, status_panel, timeline, nav])


if __name__ == "__main__":
    demo.launch(
        server_port=7860, share=False,
        theme=gr.themes.Base(
            primary_hue=gr.themes.colors.blue,
            secondary_hue=gr.themes.colors.slate,
            neutral_hue=gr.themes.colors.gray,
            font=gr.themes.GoogleFont("IBM Plex Sans"),
            font_mono=gr.themes.GoogleFont("JetBrains Mono"),
        ),
    )
```

- [ ] **Step 2: Manual test — launch and verify**

```bash
cd /Users/lumimamini/Documents/Seichijunrei-agent
uv run python harness/app.py
```

Open http://localhost:7860. Test:
1. Select "Executor", send "List all Python files in backend/"
2. Watch tool calls stream in real-time
3. Send a follow-up message (context preserved)
4. Switch to "Reviewer", send "Review backend/agents/base.py"
5. Switch back to "Executor" — previous chat history restored
6. Click Interrupt during a long task
7. Click Close, then Reset

- [ ] **Step 3: Commit**

```bash
git add harness/app.py
git commit -m "feat(harness): Gradio UI with real SDK streaming and multi-agent nav"
```

---

### Task 6: Integration Smoke Test

- [ ] **Step 1: Run all harness tests**

```bash
uv run pytest harness/tests/ -v
```

Expected: all tests pass (state + agents + stream)

- [ ] **Step 2: Run existing project tests to verify no regression**

```bash
uv run pytest backend/tests/ -x --timeout=30
```

Expected: existing tests still pass

- [ ] **Step 3: Commit any fixes**

If any tests needed adjustment:
```bash
git add -A
git commit -m "fix(harness): integration fixes from smoke test"
```

---

## Iteration 1 Deliverables

After completing all 6 tasks:
- `harness/` package with state, agents, stream, app modules
- Real ClaudeSDKClient streaming to Gradio
- Multi-agent mode switching with preserved chat history
- Interrupt support
- 20 unit tests covering state, agents, stream formatting
- Ready for Iteration 2: orchestrator + router + verifier + hooks
