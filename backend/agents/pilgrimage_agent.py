"""PydanticAI agent definition for the anime pilgrimage runtime.

This module defines ONLY the agent object and its instructions. Tools are
registered in ``pilgrimage_tools`` (imported lazily at run time).
The runner that executes the agent lives in ``pilgrimage_runner``.

Separation rationale:
- Agent def must exist before ``@agent.tool`` decorators run.
- Tools import the agent → tools module depends on this module.
- Runner imports both → runner depends on tools + agent.
- Keeping them apart avoids circular imports and keeps each file < 300 lines.
"""

from __future__ import annotations

from pydantic_ai import Agent, ModelRetry, RunContext
from pydantic_ai.output import ToolOutput

from backend.agents.base import resolve_model
from backend.agents.runtime_deps import RuntimeDeps
from backend.agents.runtime_models import (
    ClarifyResponseModel,
    GreetingResponseModel,
    QAResponseModel,
    RouteResponseModel,
    SearchResponseModel,
)

_INSTRUCTIONS = """\
You are the runtime agent for Seichijunrei (聖地巡礼), an anime pilgrimage search \
and route planning app. Users ask about real-world locations from anime.

## Your job
Call tools to fetch real data, then return exactly ONE typed response. \
Never fabricate locations, coordinates, or routes — always use tool outputs.

## Response types (pick exactly one)
- clarify_response — when you need more info from the user
- search_response — when returning pilgrimage point results
- route_response — when returning a planned walking route
- qa_response — when answering general questions about pilgrimage etiquette/tips
- greeting_response — when responding to greetings or "what can you do?"

## Workflow rules

### Anime search (most common)
1. Call resolve_anime(title) FIRST to get a bangumi_id
2. If resolve_anime returns "ambiguous": true with multiple candidates → \
you MUST call clarify() with those candidates. Do NOT guess.
3. If resolve_anime returns a single bangumi_id → call search_bangumi(bangumi_id)

### Location/nearby search
- Call search_nearby(location, radius) when the user mentions a place name
- Do NOT call resolve_anime for location queries

### Route planning
- When the user asks for a route/itinerary/walking plan:
  1. Call resolve_anime first
  2. Call search_bangumi to get points
  3. Call plan_route to create the optimized route
  ALL THREE steps are required. Do not stop after search.

### Greetings vs QA
- greet_user: "hi", "hello", "你好", "こんにちは", "你是谁", "what can you do?",
  "thanks", "ありがとう", "谢谢", "goodbye"
- general_qa: pilgrimage etiquette, tips, costs, travel advice, planning help
- If a greeting is followed by a real query (e.g., "你好，宇治站附近有什么？"), \
  treat it as the real query (search_nearby), NOT as a greeting.

## Translation & Web Search
- Use translate_anime_title when you need an anime title in a different language
- Use web_search to look up information you're unsure about
- ALWAYS respond in the user's locale (ja/zh/en) — use translation tools if needed
- When showing anime titles in clarify candidates, include both original and
  the user's language if they differ

## Examples

User: "凉宫" → resolve_anime("凉宫") → ambiguous (多部匹配) → clarify()
User: "君の名は の聖地" → resolve_anime("君の名は") → bangumi_id → search_bangumi()
User: "宇治站附近" → search_nearby("宇治駅")
User: "帮我规划響け路线" → resolve_anime → search_bangumi → plan_route()
User: "圣地巡礼注意事项" → general_qa()
User: "你好" → greet_user()
User: "你好，京都有什么圣地" → search_nearby("京都")  (NOT greet_user)
User: "haruhi spots" → web_search("Haruhi Suzumiya anime") → resolve_anime → search_bangumi()
"""


pilgrimage_agent = Agent(
    resolve_model(None),
    deps_type=RuntimeDeps,
    output_type=[
        ToolOutput(ClarifyResponseModel, name="clarify_response"),
        ToolOutput(SearchResponseModel, name="search_response"),
        ToolOutput(RouteResponseModel, name="route_response"),
        ToolOutput(QAResponseModel, name="qa_response"),
        ToolOutput(GreetingResponseModel, name="greeting_response"),
    ],
    instructions=_INSTRUCTIONS,
    retries=2,
)


@pilgrimage_agent.output_validator  # type: ignore[arg-type]
async def validate_output(
    ctx: RunContext[RuntimeDeps],
    output: (
        ClarifyResponseModel
        | SearchResponseModel
        | RouteResponseModel
        | QAResponseModel
        | GreetingResponseModel
    ),
) -> (
    ClarifyResponseModel
    | SearchResponseModel
    | RouteResponseModel
    | QAResponseModel
    | GreetingResponseModel
):
    """Reject fabricated responses that skip required tool calls.

    Only enforced when the agent actually executed steps (has step records).
    TestModel runs with no tools produce no steps, so the validator skips.
    """
    if not ctx.deps.steps:
        return output
    tool_state = ctx.deps.tool_state
    if isinstance(output, SearchResponseModel):
        tool_key = str(output.intent)
        if tool_key not in tool_state:
            raise ModelRetry(
                f"You returned a search response but never called {tool_key}. "
                "Call the search tool first, then return the response."
            )
    if isinstance(output, RouteResponseModel):
        if "plan_route" not in tool_state and "plan_selected" not in tool_state:
            raise ModelRetry(
                "You returned a route response but never called plan_route. "
                "Call plan_route first, then return the response."
            )
    return output
