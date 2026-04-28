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
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ToolReturnPart,
    UserPromptPart,
)
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

COMPACT_THRESHOLD = 10
_KEEP_RECENT = 4

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
2. resolve_anime always returns a "candidates" list of matching anime works.
   Evaluate whether the user's query is specific enough:
   - If "ambiguous": true → call clarify() with the candidates. Do NOT guess.
   - If a single bangumi_id is returned BUT the user's query is vague/short
     (e.g. "凉宫", "fate", "響け") AND candidates contains multiple works →
     call clarify() to let the user pick. A 2-character query is almost
     certainly ambiguous even if the system found a "best match".
   - If the query is specific (e.g. "涼宮ハルヒの憂鬱", "Your Name",
     "響け！ユーフォニアム") → proceed with search_bangumi(bangumi_id).
3. When in doubt, clarify. It's better to ask than to show wrong results.

### Location/nearby search
- When the user mentions a place name without a specific anime title
  (e.g., "宇治附近", "spots near Kamakura", "京都有什么圣地"):
  1. Call web_search("<location> anime pilgrimage 聖地巡礼 アニメ") to find
     which anime are set near that location
  2. Compile anime list from web results + your knowledge
  3. Call clarify() with the anime options
  4. After user picks → resolve_anime → search_bangumi
- Exception: query has both anime AND location → resolve anime directly
- Do NOT call search_nearby for bare location queries — clarify first

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
  treat it as the real query (location/anime search), NOT as a greeting.

## Translation & Web Search
- Use translate_anime_title when you need an anime title in a different language
- Use web_search to look up information you're unsure about
- ALWAYS respond in the user's locale (ja/zh/en) — use translation tools if needed
- When showing anime titles in clarify candidates, include both original and
  the user's language if they differ

## Examples

User: "凉宫" → resolve_anime("凉宫") → ambiguous (多部匹配) → clarify()
User: "君の名は の聖地" → resolve_anime("君の名は") → bangumi_id → search_bangumi()
User: "宇治站附近" → web_search("宇治 anime 聖地巡礼") → clarify(ユーフォ、etc.)
User: "帮我规划響け路线" → resolve_anime → search_bangumi → plan_route()
User: "圣地巡礼注意事项" → general_qa()
User: "你好" → greet_user()
User: "你好，京都有什么圣地" → web_search("京都 アニメ 聖地巡礼") → clarify(...)  (NOT greet_user)
User: "haruhi spots" → web_search("Haruhi Suzumiya anime") → resolve_anime → search_bangumi()

### Data freshness
- Our database may be incomplete or outdated. Consider calling web_search when:
  - DB returned very few points (≤2) for a popular anime
  - The user is asking about a recent anime (2024+)
  - You are uncertain whether the DB data is comprehensive
- Enrich your response: mention if web search found additional spots not in DB

### Conversation context
You have access to the conversation history from previous turns. Use it to:
- Understand references like "that anime", "show me a route", "换一个"
- Avoid re-clarifying when the user already selected an option
- Continue multi-step workflows (search → route) without re-asking
Do NOT repeat information the user has already seen.
"""


def _compact_tool_results(messages: list[ModelMessage]) -> list[ModelMessage]:
    """Compress old tool return content, keep latest turns intact."""
    if len(messages) <= COMPACT_THRESHOLD:
        return messages
    cutoff = len(messages) - _KEEP_RECENT
    result: list[ModelMessage] = []
    for i, msg in enumerate(messages):
        if i >= cutoff or not isinstance(msg, ModelRequest):
            result.append(msg)
            continue
        result.append(_compress_request(msg))
    return result


def _compress_request(msg: ModelRequest) -> ModelRequest:
    """Replace large ToolReturnParts with compact placeholders."""
    new_parts = [
        _compress_tool_return(p) if isinstance(p, ToolReturnPart) else p
        for p in msg.parts
    ]
    return ModelRequest(parts=new_parts, instructions=msg.instructions)


def _compress_tool_return(part: ToolReturnPart) -> ToolReturnPart:
    if len(str(part.content)) <= 200:
        return part
    return ToolReturnPart(
        tool_name=part.tool_name,
        content=f"[{part.tool_name}: completed]",
        tool_call_id=part.tool_call_id,
    )


def _sliding_window(messages: list[ModelMessage]) -> list[ModelMessage]:
    """Keep last ~COMPACT_THRESHOLD messages, slicing on turn boundaries."""
    if len(messages) <= COMPACT_THRESHOLD:
        return messages
    turn_starts = _find_turn_starts(messages)
    if not turn_starts:
        return messages[-COMPACT_THRESHOLD:]
    return messages[_pick_keep_from(turn_starts, len(messages)) :]


def _find_turn_starts(messages: list[ModelMessage]) -> list[int]:
    """Return indices of messages containing a UserPromptPart."""
    return [
        i
        for i, msg in enumerate(messages)
        if isinstance(msg, ModelRequest)
        and any(isinstance(p, UserPromptPart) for p in msg.parts)
    ]


def _pick_keep_from(turn_starts: list[int], total: int) -> int:
    """Find the earliest turn start within COMPACT_THRESHOLD of the end."""
    keep_from = turn_starts[-1]
    for start in reversed(turn_starts):
        if total - start <= COMPACT_THRESHOLD:
            keep_from = start
        else:
            break
    return keep_from


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
    history_processors=[_compact_tool_results, _sliding_window],
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
