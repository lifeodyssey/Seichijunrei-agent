"""Shadow mode for planner comparison analysis.

This module provides functionality to run the LLM planner in parallel
with deterministic routing, logging comparison results for analysis
without affecting the actual routing decision.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from utils.logger import get_logger

from ._schemas import PlannerDecision
from .planner_agent import format_planner_prompt, planner_agent

logger = get_logger(__name__)


@dataclass
class ShadowModeResult:
    """Result of shadow mode comparison.

    Attributes:
        timestamp: When the comparison was made
        user_text: The user's input text
        deterministic_skill: Skill chosen by deterministic routing
        planner_decision: Decision from LLM planner (if successful)
        planner_error: Error message if planner failed
        match: Whether deterministic and planner agree
        planner_latency_ms: Time taken by planner in milliseconds
    """

    timestamp: datetime = field(default_factory=datetime.utcnow)
    user_text: str = ""
    deterministic_skill: str = ""
    planner_decision: PlannerDecision | None = None
    planner_error: str | None = None
    match: bool = False
    planner_latency_ms: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for logging/storage."""
        return {
            "timestamp": self.timestamp.isoformat(),
            "user_text": self.user_text[:100],
            "deterministic_skill": self.deterministic_skill,
            "planner_skill": (
                self.planner_decision.skill_id if self.planner_decision else None
            ),
            "planner_confidence": (
                self.planner_decision.confidence if self.planner_decision else None
            ),
            "planner_reasoning": (
                self.planner_decision.reasoning[:100] if self.planner_decision else None
            ),
            "planner_error": self.planner_error,
            "match": self.match,
            "planner_latency_ms": self.planner_latency_ms,
        }


async def run_planner_shadow(
    user_text: str,
    state: dict[str, Any],
    deterministic_skill: str,
    user_language: str = "zh-CN",
) -> ShadowModeResult:
    """Run planner in shadow mode and compare with deterministic result.

    Args:
        user_text: The user's input text
        state: Current session state
        deterministic_skill: Skill chosen by deterministic routing
        user_language: Detected user language

    Returns:
        ShadowModeResult with comparison data
    """
    result = ShadowModeResult(
        user_text=user_text,
        deterministic_skill=deterministic_skill,
    )

    start_time = asyncio.get_event_loop().time()

    try:
        # Format prompt for potential logging/debugging
        _ = format_planner_prompt(user_text, state, user_language)

        # Note: In actual implementation, this would need proper context
        # For now, we simulate the planner call structure
        decision: PlannerDecision | None = None

        # Run planner agent (simplified - actual impl needs InvocationContext)
        async for event in planner_agent.run_async(None):  # type: ignore
            if event.content and event.content.parts:
                for part in event.content.parts:
                    if hasattr(part, "text") and part.text:
                        try:
                            decision = PlannerDecision.model_validate_json(part.text)
                            break
                        except Exception:
                            continue

        result.planner_decision = decision
        if decision:
            result.match = decision.skill_id == deterministic_skill

    except Exception as e:
        result.planner_error = str(e)

    end_time = asyncio.get_event_loop().time()
    result.planner_latency_ms = (end_time - start_time) * 1000

    # Log the comparison result
    log_shadow_result(result)

    return result


def log_shadow_result(result: ShadowModeResult) -> None:
    """Log shadow mode comparison result for analysis.

    Args:
        result: The shadow mode comparison result
    """
    if result.planner_error:
        logger.warning(
            "Shadow mode planner error",
            error=result.planner_error,
            deterministic_skill=result.deterministic_skill,
        )
        return

    if result.match:
        logger.debug(
            "Shadow mode: planner agrees with deterministic",
            skill=result.deterministic_skill,
            confidence=(
                result.planner_decision.confidence if result.planner_decision else None
            ),
            latency_ms=result.planner_latency_ms,
        )
    else:
        logger.info(
            "Shadow mode: planner disagrees with deterministic",
            deterministic=result.deterministic_skill,
            planner=(
                result.planner_decision.skill_id if result.planner_decision else None
            ),
            confidence=(
                result.planner_decision.confidence if result.planner_decision else None
            ),
            reasoning=(
                result.planner_decision.reasoning[:50]
                if result.planner_decision
                else None
            ),
            latency_ms=result.planner_latency_ms,
        )


class ShadowModeCollector:
    """Collector for shadow mode results for batch analysis."""

    def __init__(self, max_results: int = 1000) -> None:
        """Initialize collector with max results limit."""
        self._results: list[ShadowModeResult] = []
        self._max_results = max_results

    def add(self, result: ShadowModeResult) -> None:
        """Add a result to the collector."""
        self._results.append(result)
        if len(self._results) > self._max_results:
            self._results = self._results[-self._max_results :]

    def get_stats(self) -> dict[str, Any]:
        """Get statistics from collected results."""
        if not self._results:
            return {"total": 0}

        matches = sum(1 for r in self._results if r.match)
        errors = sum(1 for r in self._results if r.planner_error)
        total = len(self._results)

        return {
            "total": total,
            "matches": matches,
            "errors": errors,
            "match_rate": matches / total if total > 0 else 0,
            "error_rate": errors / total if total > 0 else 0,
        }

    def clear(self) -> None:
        """Clear all collected results."""
        self._results.clear()


# Global collector instance
shadow_collector = ShadowModeCollector()
