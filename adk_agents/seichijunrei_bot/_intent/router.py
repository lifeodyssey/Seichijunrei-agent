"""IntentRouter for fast/slow path routing.

This agent implements a hybrid routing strategy:
- Fast path: Deterministic regex patterns for clear commands (0 token cost)
- Slow path: LLM classifier for ambiguous inputs (uses planner_model)

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

from .._state import (
    BANGUMI_CANDIDATES,
    EXTRACTION_RESULT,
    LOCATION_PROMPT_SHOWN,
    SELECTED_BANGUMI,
    USER_COORDINATES,
)
from ..skills import (
    STAGE1_BANGUMI_SEARCH,
    STAGE1_5_LOCATION_COLLECTION,
    STAGE2_ROUTE_PLANNING,
    Skill,
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

# Greeting patterns for fast path
_GREETING_PATTERNS = (
    r"^\s*(hi|hello|hey|yo)\s*[!.?]*\s*$",
    r"^\s*(你好|您好|嗨|哈喽|哈罗)\s*[!.?]*\s*$",
    r"^\s*(こんにちは|こんばんは|おはよう|やあ|ハロー)\s*[!.?]*\s*$",
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


_NORMALIZE_RE = re.compile(r"[\s《》「」『』（）()\[\]【】<>\"'" "''`]+")


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


def _needs_location_collection(state: dict[str, Any]) -> bool:
    """Check if we need to collect location from user (Stage 1.5).

    Returns True when:
    - User has made a selection (selected_bangumi exists)
    - No location was provided in the original query
    - Location prompt has not been shown yet
    - User coordinates have not been collected yet
    """
    # Check if user has made a selection
    selected_bangumi = state.get(SELECTED_BANGUMI)
    if not selected_bangumi:
        return False

    # Check if location was already provided
    extraction = state.get(EXTRACTION_RESULT) or {}
    location = extraction.get("location", "")
    if location and location.strip():
        return False

    # Check if we already have user coordinates
    if state.get(USER_COORDINATES):
        return False

    # Check if location prompt was already shown
    if state.get(LOCATION_PROMPT_SHOWN):
        return False

    return True


class IntentRouter(BaseAgent):
    """Intent router with fast/slow path routing.

    Fast path (0 token cost):
    - welcome for new sessions
    - greeting/reset/back/help/status commands via regex
    - Selection detection when candidates exist

    Slow path (uses planner_model):
    - Ambiguous inputs routed to IntentClassifier
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

            # Fast path: New session welcome
            if not state:
                logger.debug("Fast path: new session, sending welcome")
                yield self._create_event(
                    ctx,
                    self._welcome_prompt(user_language),
                    state_delta={"_session_initialized": True},
                )
                return

            # Fast path: Greeting
            if _matches_any(user_text, _GREETING_PATTERNS):
                logger.debug("Fast path: greeting detected")
                yield self._create_event(ctx, self._greeting_prompt(user_language))
                return

            # Fast path: Help command
            if _matches_any(user_text, _HELP_PATTERNS):
                logger.debug("Fast path: help command")
                yield self._create_event(ctx, self._help_prompt(user_language))
                return

            # Fast path: Status command
            if _matches_any(user_text, _STATUS_PATTERNS):
                logger.debug("Fast path: status command")
                yield self._create_event(ctx, self._status_prompt(state, user_language))
                return

            # Fast path: Reset command
            if _matches_any(user_text, _RESET_PATTERNS):
                logger.debug("Fast path: reset command")
                self._reset_all(state)
                yield self._create_event(ctx, self._reset_prompt(user_language))
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

            # Fast path: Check if we need location collection (Stage 1.5)
            if _needs_location_collection(state):
                logger.debug("Fast path: needs location, running Stage 1.5")
                async for event in self._run_skill(STAGE1_5_LOCATION_COLLECTION, ctx):
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

    def _create_event(
        self,
        ctx: InvocationContext,
        text: str,
        state_delta: dict[str, Any] | None = None,
    ) -> Event:
        """Create a text response event with optional state update."""
        return Event(
            invocation_id=ctx.invocation_id,
            author=self.name,
            content=_text_response(text),
            actions=EventActions(state_delta=state_delta or {}),
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

    @staticmethod
    def _welcome_prompt(user_language: str) -> str:
        """Get welcome prompt for new sessions."""
        if user_language == "en":
            return (
                "Welcome to Seichijunrei Bot! 🎌\n\n"
                "I can help you plan anime pilgrimage routes.\n\n"
                "**How to use:**\n"
                '- Tell me an anime title (e.g., "Your Name")\n'
                "- I'll find pilgrimage locations for you\n"
                "- Select one and I'll plan a route\n\n"
                "What anime would you like to explore?"
            )
        if user_language == "ja":
            return (
                "聖地巡礼ボットへようこそ！🎌\n\n"
                "アニメの聖地巡礼ルートを計画するお手伝いをします。\n\n"
                "**使い方:**\n"
                "- 作品名を教えてください（例：「君の名は」）\n"
                "- 聖地を検索します\n"
                "- 選択するとルートを計画します\n\n"
                "どの作品の聖地を探しますか？"
            )
        return (
            "欢迎使用圣地巡礼机器人！🎌\n\n"
            "我可以帮你规划动漫圣地巡礼路线。\n\n"
            "**使用方法:**\n"
            "- 告诉我动画作品名（如「你的名字」）\n"
            "- 我会搜索相关圣地\n"
            "- 选择后为你规划路线\n\n"
            "你想探索哪部作品的圣地？"
        )

    @staticmethod
    def _greeting_prompt(user_language: str) -> str:
        """Get greeting response."""
        if user_language == "en":
            return (
                "Hello! 👋 I'm the Seichijunrei Bot.\n\n"
                "Tell me an anime title and I'll help you plan a pilgrimage route!"
            )
        if user_language == "ja":
            return (
                "こんにちは！👋 聖地巡礼ボットです。\n\n"
                "作品名を教えてください。聖地巡礼ルートを計画します！"
            )
        return (
            "你好！👋 我是圣地巡礼机器人。\n\n"
            "告诉我动画作品名，我来帮你规划巡礼路线！"
        )

    @staticmethod
    def _help_prompt(user_language: str) -> str:
        """Get help prompt."""
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
                "- 出现候选后，回复数字（如'1'）进行选择。",
                "- 命令：`back`（重新选）、`reset`（从头开始）。",
                "- 诊断：`/status`、`/mcp_probe`（开发用）。",
            ]
        )

    @staticmethod
    def _status_prompt(state: dict[str, Any], user_language: str) -> str:
        """Get status prompt."""
        has_candidates = bool(state.get(BANGUMI_CANDIDATES))
        stage = "stage2" if has_candidates else "stage1"
        keys = ", ".join(sorted(state.keys())) if state else "(empty)"

        if user_language == "en":
            return f"Status: {stage}\nState keys: {keys}"
        if user_language == "ja":
            return f"状態: {stage}\nState keys: {keys}"
        return f"当前状态: {stage}\nState keys: {keys}"

    @staticmethod
    def _candidates_prompt(state: dict[str, Any], user_language: str) -> str:
        """Get candidates prompt for back command."""
        candidates_data = state.get(BANGUMI_CANDIDATES) or {}
        candidates = candidates_data.get("candidates") or []
        query = candidates_data.get("query") or ""

        if not candidates:
            if user_language == "en":
                return "No candidates available. Please provide a new query."
            if user_language == "ja":
                return "候補がありません。新しいキーワードで検索してください。"
            return "当前没有候选，请重新输入作品名进行搜索。"

        lines: list[str] = []
        if user_language == "en":
            lines.append(f"Candidates for '{query}'. Please choose:")
        elif user_language == "ja":
            lines.append(f"「{query}」の候補です。選択してください：")
        else:
            lines.append(f"「{query}」的候选作品，请选择：")

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
            lines.append("请回复数字（如'1'）进行选择。")

        return "\n".join(lines)
