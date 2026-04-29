"""Handler modules for ExecutorAgent tool dispatch.

Trivial handlers (greet_user, answer_question, search_bangumi, search_nearby)
were collapsed into inline logic in ``pilgrimage_tools.py``.  Only complex
handlers with genuine logic (resolve_anime, plan_route, plan_selected) remain.
"""

from __future__ import annotations

from backend.agents.handlers.plan_route import execute as execute_plan_route
from backend.agents.handlers.plan_selected import execute as execute_plan_selected
from backend.agents.handlers.resolve_anime import execute as execute_resolve_anime
from backend.agents.handlers.result import HandlerResult

__all__ = [
    "HandlerResult",
    "execute_plan_route",
    "execute_plan_selected",
    "execute_resolve_anime",
]
