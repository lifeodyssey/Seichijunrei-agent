"""Skill registry for the Seichijunrei bot.

In this repo, a "skill" is a deploy-friendly ADK workflow (agent tree) with a
declared session-state contract (required/provided keys).

This gives us a Manus-style abstraction layer (planner/executor friendly) while
keeping the default routing deterministic and cheap.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Final

from google.adk.agents import BaseAgent

from utils.logger import get_logger

from ._state import (
    ALL_STATE_KEYS,
    BANGUMI_CANDIDATES,
    SELECTED_BANGUMI,
    STAGE1_5_STATE_KEYS,
    STAGE1_STATE_KEYS,
    STAGE2_STATE_KEYS,
)
from ._workflows.bangumi_search_workflow import bangumi_search_workflow
from ._workflows.location_collection_workflow import location_collection_workflow
from ._workflows.route_planning_workflow import route_planning_workflow

logger = get_logger(__name__)


class StateContractError(Exception):
    """Raised when state contract validation fails."""

    def __init__(self, skill_id: str, message: str) -> None:
        self.skill_id = skill_id
        super().__init__(f"State contract error in skill '{skill_id}': {message}")


@dataclass(frozen=True, slots=True)
class Skill:
    """A skill with declared state contract.

    Attributes:
        skill_id: Unique identifier for the skill
        agent: The ADK BaseAgent that implements this skill
        required_state_keys: Keys that MUST exist in state before execution
        provided_state_keys: Keys that this skill will set in state
        reset_state_keys: Keys that this skill will clear/reset
    """

    skill_id: str
    agent: BaseAgent
    required_state_keys: frozenset[str]
    provided_state_keys: frozenset[str]
    reset_state_keys: frozenset[str]

    @property
    def name(self) -> str:
        return self.agent.name

    def validate_preconditions(self, state: dict[str, Any]) -> None:
        """Validate that required state keys exist before skill execution.

        Args:
            state: Current session state

        Raises:
            StateContractError: If required keys are missing
        """
        missing_keys = self.required_state_keys - set(state.keys())
        if missing_keys:
            raise StateContractError(
                self.skill_id,
                f"Missing required state keys: {sorted(missing_keys)}",
            )
        logger.debug(
            "State contract preconditions validated",
            skill_id=self.skill_id,
            required_keys=sorted(self.required_state_keys),
        )

    def validate_postconditions(self, state: dict[str, Any]) -> None:
        """Validate that provided state keys exist after skill execution.

        Args:
            state: Session state after execution

        Raises:
            StateContractError: If provided keys are missing
        """
        missing_keys = self.provided_state_keys - set(state.keys())
        if missing_keys:
            logger.warning(
                "State contract postcondition warning: expected keys not set",
                skill_id=self.skill_id,
                missing_keys=sorted(missing_keys),
            )
        else:
            logger.debug(
                "State contract postconditions validated",
                skill_id=self.skill_id,
                provided_keys=sorted(self.provided_state_keys),
            )

    def apply_reset(self, state: dict[str, Any]) -> None:
        """Reset state keys defined in reset_state_keys.

        Args:
            state: Session state to modify in-place
        """
        for key in self.reset_state_keys:
            if key in state:
                del state[key]
        logger.debug(
            "State keys reset",
            skill_id=self.skill_id,
            reset_keys=sorted(self.reset_state_keys),
        )


STAGE1_BANGUMI_SEARCH: Final[Skill] = Skill(
    skill_id="bangumi_search",
    agent=bangumi_search_workflow,
    required_state_keys=frozenset(),
    provided_state_keys=frozenset(STAGE1_STATE_KEYS),
    reset_state_keys=frozenset(ALL_STATE_KEYS),
)

STAGE1_5_LOCATION_COLLECTION: Final[Skill] = Skill(
    skill_id="location_collection",
    agent=location_collection_workflow,
    required_state_keys=frozenset({SELECTED_BANGUMI}),
    provided_state_keys=frozenset(STAGE1_5_STATE_KEYS),
    reset_state_keys=frozenset(STAGE1_5_STATE_KEYS),
)

STAGE2_ROUTE_PLANNING: Final[Skill] = Skill(
    skill_id="route_planning",
    agent=route_planning_workflow,
    required_state_keys=frozenset({BANGUMI_CANDIDATES}),
    provided_state_keys=frozenset(STAGE2_STATE_KEYS),
    reset_state_keys=frozenset(STAGE2_STATE_KEYS),
)

SKILLS: Final[tuple[Skill, ...]] = (
    STAGE1_BANGUMI_SEARCH,
    STAGE1_5_LOCATION_COLLECTION,
    STAGE2_ROUTE_PLANNING,
)

SKILLS_BY_NAME: Final[dict[str, Skill]] = {skill.name: skill for skill in SKILLS}
SKILLS_BY_ID: Final[dict[str, Skill]] = {skill.skill_id: skill for skill in SKILLS}

ROOT_SUB_AGENTS: Final[list[BaseAgent]] = [skill.agent for skill in SKILLS]


def get_skill_for_state(state: dict[str, Any]) -> Skill | None:
    """Determine which skill should run based on current state.

    Args:
        state: Current session state

    Returns:
        The appropriate skill, or None if no skill matches
    """
    # If we have candidates but no selection, we're in stage 1 complete
    # If we have selection, we should run stage 2
    if BANGUMI_CANDIDATES in state and state.get(BANGUMI_CANDIDATES):
        return STAGE2_ROUTE_PLANNING
    return STAGE1_BANGUMI_SEARCH


def validate_skill_contract(
    skill: Skill, state: dict[str, Any], *, phase: str = "pre"
) -> None:
    """Validate skill state contract.

    Args:
        skill: The skill to validate
        state: Current session state
        phase: "pre" for preconditions, "post" for postconditions

    Raises:
        StateContractError: If validation fails
    """
    if phase == "pre":
        skill.validate_preconditions(state)
    elif phase == "post":
        skill.validate_postconditions(state)
    else:
        raise ValueError(f"Invalid phase: {phase}. Must be 'pre' or 'post'")
