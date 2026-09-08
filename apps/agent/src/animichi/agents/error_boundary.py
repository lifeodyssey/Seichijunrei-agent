"""SD-18 error-boundary hook: the 5th agent-composition hook.

Uniformly maps tool-execution exceptions and agent-loop exceptions onto one
typed, localized payload (``ErrorResponseModel``) instead of each call site
erroring ad hoc. Reuses ``error_messages.build_error_message`` for
localization rather than duplicating the catalog-error -> string mapping.

Composes alongside the four existing hooks (compaction / output_validator /
@instructions / Logfire) — it does not modify any of them. ``UsageLimitExceeded``,
``UnexpectedModelBehavior``, ``ContentFilterError``, ``ModelHTTPError``,
``FallbackExceptionGroup``, and ``httpx.HTTPError`` already get specific,
tailored handling in ``animichi_runner`` / ``interfaces.public_api``, so this
hook re-raises them unchanged and only converts genuinely unclassified failures.
"""

from __future__ import annotations

from traceback import format_exception

import httpx
import structlog
from pydantic_ai import RunContext
from pydantic_ai.agent import AgentRunResult
from pydantic_ai.capabilities import Hooks
from pydantic_ai.exceptions import (
    ContentFilterError,
    FallbackExceptionGroup,
    ModelHTTPError,
    UnexpectedModelBehavior,
    UsageLimitExceeded,
)
from pydantic_ai.messages import ToolCallPart
from pydantic_ai.tools import ToolDefinition

from animichi.agents.error_messages import build_error_message
from animichi.agents.runtime_deps import RuntimeDeps
from animichi.agents.runtime_models import ErrorResponseModel
from animichi.agents.tool_event_bridge import register_recovered_tool_exception

logger = structlog.get_logger(__name__)

_GENERIC_FALLBACK = {
    "en": "Something went wrong on our side. Please try again later.",
    "ja": "サーバー側で問題が発生しました。しばらくしてからもう一度お試しください。",
    "zh": "我们这边出了点问题，请稍后再试。",
}

_ALREADY_HANDLED_ELSEWHERE: tuple[type[BaseException], ...] = (
    UsageLimitExceeded,
    UnexpectedModelBehavior,
    ContentFilterError,
    ModelHTTPError,
    FallbackExceptionGroup,
    httpx.HTTPError,
)


def map_exception_to_error_response(
    error: Exception, locale: str
) -> ErrorResponseModel:
    """The one function every tool and agent-loop exception flows through."""
    fallback = _GENERIC_FALLBACK.get(locale, _GENERIC_FALLBACK["en"])
    message = build_error_message(error, locale, fallback=fallback)
    return ErrorResponseModel(message=message)


async def _on_tool_execute_error(
    ctx: RunContext[RuntimeDeps],
    *,
    call: ToolCallPart,
    tool_def: ToolDefinition,
    args: object,
    error: Exception,
) -> ErrorResponseModel:
    """Convert an unhandled tool exception into a result the model can react to."""
    del tool_def, args
    register_recovered_tool_exception(ctx, call.tool_call_id)
    logger.warning(
        "animichi_tool_execute_error",
        tool=call.tool_name,
        error_type=type(error).__name__,
        error=str(error),
    )
    return map_exception_to_error_response(error, ctx.deps.locale)


async def _on_run_error(
    ctx: RunContext[RuntimeDeps], *, error: BaseException
) -> AgentRunResult[ErrorResponseModel]:
    """Convert a genuinely unclassified agent-loop exception into a clean result."""
    if isinstance(error, _ALREADY_HANDLED_ELSEWHERE) or not isinstance(
        error, Exception
    ):
        raise error
    # pydantic-ai calls this hook after the exception state is cleared, so
    # `logger.exception` renders no traceback. `exc_info=` would restore it but
    # structlog is unconfigured here, so its rich renderer walks the agent-run
    # frames: measured at ~32 s per logged error. Format the frames ourselves.
    logger.error(
        "animichi_run_error",
        error_type=type(error).__name__,
        traceback="".join(format_exception(error)),
    )
    payload = map_exception_to_error_response(error, ctx.deps.locale)
    return AgentRunResult(output=payload)


def error_boundary_hooks() -> Hooks[RuntimeDeps]:
    """Build the 5th agent-composition hook, additive alongside the other four."""
    hooks = Hooks[RuntimeDeps]()
    hooks.on.tool_execute_error(_on_tool_execute_error)
    hooks.on.run_error(_on_run_error)
    return hooks


def is_byok_credential_rejection(exc: object) -> bool:
    """A provider-reported auth failure for a BYOK-supplied credential.

    Only `ModelHTTPError` carries a structured `status_code`; a 401/403 here
    means the caller's own key/base_url was rejected, never the server's.
    """
    return isinstance(exc, ModelHTTPError) and exc.status_code in (401, 403)


_TRANSIENT_HTTP_STATUSES = frozenset({429, 502, 503})


def is_provider_error(exc: object) -> bool:
    """Detect transient provider errors by exception type, not string scanning."""
    if isinstance(exc, ModelHTTPError):
        return exc.status_code in _TRANSIENT_HTTP_STATUSES
    if isinstance(exc, FallbackExceptionGroup):
        return True
    if isinstance(exc, httpx.TransportError):
        return True
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in _TRANSIENT_HTTP_STATUSES
    return False
