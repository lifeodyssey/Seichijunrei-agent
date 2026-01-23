"""Skill registry for the Seichijunrei bot.

In this repo, a "skill" is a deploy-friendly ADK workflow (agent tree) with a
declared session-state contract (required/provided keys).

This gives us a Manus-style abstraction layer (planner/executor friendly) while
keeping the default routing deterministic and cheap.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from google.adk.agents import BaseAgent

from ._state import (
    ALL_STATE_KEYS,
    BANGUMI_CANDIDATES,
    STAGE1_STATE_KEYS,
    STAGE2_STATE_KEYS,
)
from ._workflows.bangumi_search_workflow import bangumi_search_workflow
from ._workflows.route_planning_workflow import route_planning_workflow


@dataclass(frozen=True, slots=True)
class Skill:
    skill_id: str
    agent: BaseAgent
    required_state_keys: frozenset[str]
    provided_state_keys: frozenset[str]
    reset_state_keys: frozenset[str]

    @property
    def name(self) -> str:
        return self.agent.name


STAGE1_BANGUMI_SEARCH: Final[Skill] = Skill(
    skill_id="bangumi_search",
    agent=bangumi_search_workflow,
    required_state_keys=frozenset(),
    provided_state_keys=frozenset(STAGE1_STATE_KEYS),
    reset_state_keys=frozenset(ALL_STATE_KEYS),
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
    STAGE2_ROUTE_PLANNING,
)

SKILLS_BY_NAME: Final[dict[str, Skill]] = {skill.name: skill for skill in SKILLS}

ROOT_SUB_AGENTS: Final[list[BaseAgent]] = [skill.agent for skill in SKILLS]
