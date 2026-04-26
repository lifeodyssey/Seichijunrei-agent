"""Handler modules for ExecutorAgent tool dispatch."""

from __future__ import annotations

from backend.agents.handlers.answer_question import execute as execute_answer_question
from backend.agents.handlers.greet_user import execute as execute_greet_user
from backend.agents.handlers.plan_route import execute as execute_plan_route
from backend.agents.handlers.plan_selected import execute as execute_plan_selected
from backend.agents.handlers.resolve_anime import execute as execute_resolve_anime
from backend.agents.handlers.result import HandlerResult
from backend.agents.handlers.search_bangumi import execute as execute_search_bangumi
from backend.agents.handlers.search_nearby import execute as execute_search_nearby

__all__ = [
    "HandlerResult",
    "execute_answer_question",
    "execute_greet_user",
    "execute_plan_route",
    "execute_plan_selected",
    "execute_resolve_anime",
    "execute_search_bangumi",
    "execute_search_nearby",
]
