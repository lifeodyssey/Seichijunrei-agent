"""HybridRouterAgent for fast/slow path routing.

This agent implements a hybrid routing strategy:
- Fast path: Deterministic regex patterns for clear commands (0 token cost)
- Slow path: LLM planner for ambiguous inputs (uses planner_model)

The goal is to handle 80%+ of requests via fast path while maintaining
flexibility for complex/ambiguous inputs.
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

from config import get_settings
from utils.logger import LogContext, get_logger

from .._state import BANGUMI_CANDIDATES, EXTRACTION_RESULT, PLANNER_DECISION
from ..skills import (
    STAGE1_BANGUMI_SEARCH,
    STAGE2_ROUTE_PLANNING,
    Skill,
    StateContractError,
)

logger = get_logger(__name__)

# Fast path regex patterns (copied from route_state_machine_agent for consistency)
_RESET_PATTERNS = (
    r"^\s*(reset|restart|start\s*over|从头来|重来|重新开始|清空|reset一下|重新)\s*$",
)
_BACK_PATTERNS = (
    r"^\s*(back|go\s*back|返回|上一步|重新选|重新选择|再选一次|换一个)\s*$",
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
    r"\d+",
    r"\b(first|second|third|fourth|fifth)\b",
    r"第\s*(?:[一二三四五六七八九十]|\d+)\s*(?:个|部|季|期)?",
    r"\bseason\b",
)


def _extract_user_text(user_content: types.Content | None) -> str:
    """Extract text from user content."""
    if user_content is None:
        return ""
    parts = user_content.parts or []
    texts: list[str] = []
    for part in parts:
        if getattr(part, "text", None):
            texts.append(part.text)
    return "\n".join(texts).strip()


def _matches_any(text: str, patterns: tuple[str, ...]) -> bool:
    """Check if text matches any of the patterns."""
    if not text:
        return False
    return any(re.search(p, text, flags=re.IGNORECASE) for p in patterns)


def _state_get_user_language(state: dict[str, Any]) -> str:
    """Get user language from state."""
    extraction = state.get(EXTRACTION_RESULT) or {}
    lang = extraction.get("user_language")
    if isinstance(lang, str) and lang:
        return lang
    return "zh-CN"


def _text_response(text: str) -> types.Content:
    """Create a text response content."""
    return types.Content(role="model", parts=[types.Part(text=text)])


_NORMALIZE_RE = re.compile(r"[\s《》「」『』（）()\[\]【】<>\"'""''`]+")


def _normalize_text(text: str) -> str:
    """Normalize text for comparison."""
    return _NORMALIZE_RE.sub("", text).strip().casefold()


def _looks_like_selection(user_text: str, state: dict[str, Any]) -> bool:
    """Check if user text looks like a selection from candidates."""
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
            if (
                normalized_user in normalized_title
                or normalized_title in normalized_user
            ):
                return True

    return False


class HybridRouterAgent(BaseAgent):
    """Hybrid router with fast/slow path routing.

    Fast path (0 token cost):
    - reset/back/help/status commands via regex
    - Selection detection when candidates exist

    Slow path (uses planner_model):
    - Ambiguous inputs routed to PlannerAgent
    - Controlled by enable_llm_planner flag
    """

    model_config = ConfigDict(extra="allow", arbitrary_types_allowed=True)

    async def _run_async_impl(
        self, ctx: InvocationContext
    ) -> AsyncGenerator[Event, None]:
        """Route user input via fast or slow path."""
        with LogContext(
            logger,
            invocation_id=ctx.invocation_id,
            session_id=ctx.session.id,
            agent_name=self.name,
        ):
            settings = get_settings()
            state: dict[str, Any] = ctx.session.state
            user_text = _extract_user_text(ctx.user_content)
            has_candidates = bool(state.get(BANGUMI_CANDIDATES))
            user_language = _state_get_user_language(state)

            # Fast path: Help command
            if _matches_any(user_text, _HELP_PATTERNS):
                logger.debug("Fast path: help command")
                yield self._create_event(
                    ctx, self._help_prompt(user_language)
                )
                return

            # Fast path: Status command
            if _matches_any(user_text, _STATUS_PATTERNS):
                logger.debug("Fast path: status command")
                yield self._create_event(
                    ctx, self._status_prompt(state, user_language)
                )
                return

            # Fast path: Reset command
            if _matches_any(user_text, _RESET_PATTERNS):
                logger.debug("Fast path: reset command")
                self._reset_all(state)
                yield self._create_event(
                    ctx, self._reset_prompt(user_language)
                )
                return

            # Fast path: Back command (only when candidates exist)
            if has_candidates and _matches_any(user_text, _BACK_PATTERNS):
                logger.debug("Fast path: back command")
                self._reset_to_candidates(state)
                yield self._create_event(
                    ctx, self._candidates_prompt(state, user_language)
                )
                return

            # Fast path: No candidates -> Stage 1
            if not has_candidates:
                logger.debug("Fast path: no candidates, running Stage 1")
                async for event in self._run_skill(STAGE1_BANGUMI_SEARCH, ctx):
                    yield event
                return

            # Fast path: Has candidates and looks like selection -> Stage 2
            if _looks_like_selection(user_text, state):
                logger.debug("Fast path: selection detected, running Stage 2")
                async for event in self._run_skill(STAGE2_ROUTE_PLANNING, ctx):
                    yield event
                return

            # Slow path: Ambiguous input with candidates
            # If planner is disabled, treat as new query
            if not settings.enable_llm_planner:
                logger.debug("Planner disabled, treating as new query")
                self._reset_all(state)
                async for event in self._run_skill(STAGE1_BANGUMI_SEARCH, ctx):
                    yield event
                return

            # Slow path: Use planner for ambiguous input
            logger.debug("Slow path: invoking planner")
            # For now, fall back to Stage 1 (planner integration in future)
            self._reset_all(state)
            async for event in self._run_skill(STAGE1_BANGUMI_SEARCH, ctx):
                yield event

    def _create_event(self, ctx: InvocationContext, text: str) -> Event:
        """Create a text response event."""
        return Event(
            invocation_id=ctx.invocation_id,
            author=self.name,
            content=_text_response(text),
            actions=EventActions(),
        )

    async def _run_skill(
        self, skill: Skill, ctx: InvocationContext
    ) -> AsyncGenerator[Event, None]:
        """Run a skill's agent."""
        agent = self.find_sub_agent(skill.name)
        if agent is None:
            raise RuntimeError(f"Skill agent ({skill.name}) not found")
        async for event in agent.run_async(ctx):
            yield event

    @staticmethod
    def _reset_all(state: dict[str, Any]) -> None:
        """Reset all state keys."""
        for key in STAGE1_BANGUMI_SEARCH.reset_state_keys:
            state.pop(key, None)

    @staticmethod
    def _reset_to_candidates(state: dict[str, Any]) -> None:
        """Reset to candidates state (clear Stage 2 keys)."""
        for key in STAGE2_ROUTE_PLANNING.reset_state_keys:
            state.pop(key, None)

    @staticmethod
    def _reset_prompt(user_language: str) -> str:
        """Get reset confirmation prompt."""
        if user_language == "en":
            return "OK. State cleared. Please tell me the anime title."
        if user_language == "ja":
            return "了解しました。状態をリセットしました。作品名を教えてください。"
        return "好的，已重置。请告诉我你想巡礼的动画作品名。"
