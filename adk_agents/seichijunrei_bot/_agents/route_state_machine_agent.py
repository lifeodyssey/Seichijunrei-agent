"""Deterministic state machine router for Seichijunrei Bot.

This agent replaces the LLM-only "router" prompt with a small set of
deterministic rules to:
  - decide whether to run Stage 1 (Bangumi search) or Stage 2 (route planning)
  - support basic reset / backtrack commands without wasting tool calls

Design goals:
  - deployment-first: keep `adk_agents/` as the deployable unit
  - avoid accidental Stage 2 routing when user starts a brand new query
  - keep behavior explicit and testable
"""

from __future__ import annotations

import re
from collections.abc import AsyncGenerator
from typing import Any

from google.adk.agents import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event, EventActions
from google.genai import types
from pydantic import ConfigDict

from utils.logger import LogContext, get_logger

from .._state import BANGUMI_CANDIDATES, EXTRACTION_RESULT
from ..skills import STAGE1_BANGUMI_SEARCH, STAGE2_ROUTE_PLANNING

logger = get_logger(__name__)


_RESET_PATTERNS = (
    r"^\s*(reset|restart|start\s*over|从头来|重来|重新开始|清空|reset一下|重新)\s*$",
)
_BACK_PATTERNS = (
    r"^\s*(back|go\s*back|返回|上一步|重新选|重新选择|再选一次|换一个)\s*$",
)
_MCP_PROBE_PATTERNS = (
    r"^\s*/mcp_probe\s*$",
    r"^\s*/probe_mcp\s*$",
    r"^\s*/mcp\s+probe\s*$",
)
_HELP_PATTERNS = (
    r"^\s*/help\s*$",
    r"^\s*help\s*$",
    r"^\s*/\?\s*$",
    r"^\s*\?\s*$",
    r"^\s*(帮助|帮助一下|怎么用|如何使用)\s*$",
)
_STATUS_PATTERNS = (
    r"^\s*/status\s*$",
    r"^\s*/state\s*$",
    r"^\s*(状态|当前状态)\s*$",
)
_SELECTION_PATTERNS = (
    # Digit-based selections and year-based descriptions (e.g. "1", "我选1", "2015年的那部").
    r"\d+",
    # English ordinals (often used in phrases like "the first one").
    r"\b(first|second|third|fourth|fifth)\b",
    # Chinese ordinals / seasons (e.g. "第一个", "第1部", "第一季", "第2期").
    r"第\s*(?:[一二三四五六七八九十]|\d+)\s*(?:个|部|季|期)?",
    # Explicit season wording.
    r"\bseason\b",
)


def _extract_user_text(user_content: types.Content | None) -> str:
    if user_content is None:
        return ""
    parts = user_content.parts or []
    texts: list[str] = []
    for part in parts:
        if getattr(part, "text", None):
            texts.append(part.text)
    return "\n".join(texts).strip()


def _matches_any(text: str, patterns: tuple[str, ...]) -> bool:
    if not text:
        return False
    return any(re.search(p, text, flags=re.IGNORECASE) for p in patterns)


def _state_get_user_language(state: dict[str, Any]) -> str:
    extraction = state.get(EXTRACTION_RESULT) or {}
    lang = extraction.get("user_language")
    if isinstance(lang, str) and lang:
        return lang
    return "zh-CN"


def _text_response(text: str) -> types.Content:
    return types.Content(role="model", parts=[types.Part(text=text)])


_NORMALIZE_RE = re.compile(r"[\s《》「」『』（）()\[\]【】<>\"'“”‘’`]+")


def _normalize_text(text: str) -> str:
    return _NORMALIZE_RE.sub("", text).strip().casefold()


def _looks_like_selection(user_text: str, state: dict[str, Any]) -> bool:
    if _matches_any(user_text, _SELECTION_PATTERNS):
        return True

    candidates_data = state.get(BANGUMI_CANDIDATES) or {}
    candidates = candidates_data.get("candidates") or []
    if not isinstance(candidates, list) or not candidates:
        return False

    normalized_user = _normalize_text(user_text)
    if len(normalized_user) < 2:
        return False

    for item in candidates:
        if not isinstance(item, dict):
            continue
        for key in ("title_cn", "title"):
            title = item.get(key)
            if not isinstance(title, str) or not title:
                continue
            normalized_title = _normalize_text(title)
            if len(normalized_title) < 2:
                continue
            if normalized_user in normalized_title or normalized_title in normalized_user:
                return True

    return False


class RouteStateMachineAgent(BaseAgent):
    """Deterministic router + basic backtrack/reset handling."""

    model_config = ConfigDict(extra="allow", arbitrary_types_allowed=True)

    async def _run_async_impl(
        self, ctx: InvocationContext
    ) -> AsyncGenerator[Event, None]:
        with LogContext(
            logger,
            invocation_id=ctx.invocation_id,
            session_id=ctx.session.id,
            user_id=ctx.session.user_id,
            app_name=ctx.session.app_name,
            agent_name=self.name,
        ):
            state: dict[str, Any] = ctx.session.state
            user_text = _extract_user_text(ctx.user_content)

            has_candidates = bool(state.get(BANGUMI_CANDIDATES))
            user_language = _state_get_user_language(state)

            if _matches_any(user_text, _MCP_PROBE_PATTERNS):
                async for event in self._mcp_probe().run_async(ctx):
                    yield event
                return

            if _matches_any(user_text, _HELP_PATTERNS):
                yield Event(
                    invocation_id=ctx.invocation_id,
                    author=self.name,
                    content=_text_response(self._help_prompt(user_language)),
                    actions=EventActions(),
                )
                return

            if _matches_any(user_text, _STATUS_PATTERNS):
                yield Event(
                    invocation_id=ctx.invocation_id,
                    author=self.name,
                    content=_text_response(self._status_prompt(state, user_language)),
                    actions=EventActions(),
                )
                return

            if _matches_any(user_text, _RESET_PATTERNS):
                self._reset_all(state)
                yield Event(
                    invocation_id=ctx.invocation_id,
                    author=self.name,
                    content=_text_response(self._reset_prompt(user_language)),
                    actions=EventActions(),
                )
                return

            if has_candidates and _matches_any(user_text, _BACK_PATTERNS):
                self._reset_to_candidates(state)
                yield Event(
                    invocation_id=ctx.invocation_id,
                    author=self.name,
                    content=_text_response(
                        self._candidates_prompt(state, user_language)
                    ),
                    actions=EventActions(),
                )
                return

            # Stage decision
            if not has_candidates:
                async for event in self._stage1().run_async(ctx):
                    yield event
                return

            # If we have candidates but user message does NOT look like a selection,
            # treat it as a brand new query and restart Stage 1.
            if not _looks_like_selection(user_text, state):
                self._reset_all(state)
                async for event in self._stage1().run_async(ctx):
                    yield event
                return

            async for event in self._stage2().run_async(ctx):
                yield event

    def _mcp_probe(self) -> BaseAgent:
        probe = self.find_sub_agent("McpProbeAgent")
        if probe is None:
            raise RuntimeError("McpProbeAgent not found")
        return probe

    def _stage1(self) -> BaseAgent:
        # Sub-agents are wired in agent.py; we find them by name for clarity.
        stage1 = self.find_sub_agent(STAGE1_BANGUMI_SEARCH.name)
        if stage1 is None:
            raise RuntimeError(
                f"Stage 1 workflow ({STAGE1_BANGUMI_SEARCH.name}) not found"
            )
        return stage1

    def _stage2(self) -> BaseAgent:
        stage2 = self.find_sub_agent(STAGE2_ROUTE_PLANNING.name)
        if stage2 is None:
            raise RuntimeError(
                f"Stage 2 workflow ({STAGE2_ROUTE_PLANNING.name}) not found"
            )
        return stage2

    @staticmethod
    def _reset_all(state: dict[str, Any]) -> None:
        for key in STAGE1_BANGUMI_SEARCH.reset_state_keys:
            state.pop(key, None)

    @staticmethod
    def _reset_to_candidates(state: dict[str, Any]) -> None:
        # Keep extraction_result + bangumi_candidates; clear Stage 2 outputs.
        for key in STAGE2_ROUTE_PLANNING.reset_state_keys:
            state.pop(key, None)

    @staticmethod
    def _reset_prompt(user_language: str) -> str:
        if user_language == "en":
            return "OK. State cleared. Please tell me the anime title (and optionally your starting location) to begin."
        if user_language == "ja":
            return "了解しました。状態をリセットしました。作品名（必要なら出発地）を教えてください。"
        return (
            "好的，已重置。请告诉我你想巡礼的动画作品名（也可以顺便给出出发地/车站）。"
        )

    @staticmethod
    def _candidates_prompt(state: dict[str, Any], user_language: str) -> str:
        candidates_data = state.get(BANGUMI_CANDIDATES) or {}
        candidates = candidates_data.get("candidates") or []
        query = candidates_data.get("query") or ""

        if not candidates:
            if user_language == "en":
                return "No candidates available in session. Please provide a new query to search again."
            if user_language == "ja":
                return (
                    "候補がセッションにありません。新しいキーワードで検索してください。"
                )
            return "当前会话里没有可用候选，请重新输入作品名进行搜索。"

        lines: list[str] = []
        if user_language == "en":
            lines.append(f"Here are the candidates for '{query}'. Please choose:")
        elif user_language == "ja":
            lines.append(f"「{query}」の候補です。選択してください：")
        else:
            lines.append(f"这是与「{query}」相关的候选作品，请选择：")

        for idx, item in enumerate(candidates, start=1):
            title = item.get("title_cn") or item.get("title") or ""
            jp = item.get("title") or ""
            air = item.get("air_date") or ""
            suffix = f"（{jp}，{air}）" if (jp or air) else ""
            lines.append(f"{idx}. {title}{suffix}")

        if user_language == "en":
            lines.append("Reply with a number (e.g. '1') to select.")
        elif user_language == "ja":
            lines.append("数字（例：'1'）で選択してください。")
        else:
            lines.append("请回复数字（如“1”）进行选择。")

        return "\n".join(lines)

    @staticmethod
    def _help_prompt(user_language: str) -> str:
        if user_language == "en":
            return "\n".join(
                [
                    "How to use Seichijunrei Bot:",
                    "- Send an anime title (optionally with a starting area/station).",
                    "- When candidates are shown, reply with a number (e.g. '1').",
                    "- Commands: `back` (re-pick), `reset` (start over).",
                    "- Diagnostics: `/status`, `/mcp_probe` (dev).",
                ]
            )
        if user_language == "ja":
            return "\n".join(
                [
                    "使い方:",
                    "- 作品名（必要なら出発地/駅）を送ってください。",
                    "- 候補が出たら数字（例：'1'）で選択します。",
                    "- コマンド：`back`（選び直し）、`reset`（最初から）。",
                    "- 診断：`/status`、`/mcp_probe`（開発用）。",
                ]
            )
        return "\n".join(
            [
                "使用方法：",
                "- 发送动画作品名（也可以加上出发地/车站）。",
                "- 出现候选后，回复数字（如“1”）进行选择。",
                "- 命令：`back`（重新选）、`reset`（从头开始）。",
                "- 诊断：`/status`、`/mcp_probe`（开发用）。",
            ]
        )

    @staticmethod
    def _status_prompt(state: dict[str, Any], user_language: str) -> str:
        has_candidates = bool(state.get(BANGUMI_CANDIDATES))
        stage = "stage2" if has_candidates else "stage1"
        keys = ", ".join(sorted(state.keys())) if state else "(empty)"

        if user_language == "en":
            return f"Status: {stage}\nState keys: {keys}"
        if user_language == "ja":
            return f"状態: {stage}\nState keys: {keys}"
        return f"当前状态: {stage}\nState keys: {keys}"
