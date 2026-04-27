"""Runtime execution routes (sync and SSE stream)."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from contextlib import suppress
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse

from backend.interfaces.public_api import PublicAPIRequest
from backend.interfaces.routes._deps import (
    TrustedAuthContext,
    _get_runtime_api,
    _get_trusted_auth_context,
    _public_api_response,
)

logger = structlog.get_logger(__name__)


def _user_facing_error(raw: str) -> str:
    """Convert raw exception text to a user-friendly message."""
    lower = raw.lower()
    if "timeout" in lower:
        return "The request took too long. Please try again with a simpler query."
    if "validation" in lower:
        return "There was a data processing error. Please try a different query."
    if "rate" in lower and "limit" in lower:
        return "The service is busy. Please wait a moment and try again."
    return "Something went wrong. Please try again."


router = APIRouter(prefix="/v1", tags=["runtime"])


@router.post("/runtime")
async def handle_runtime(
    request: Request,
    api_request: PublicAPIRequest,
    auth: Annotated[TrustedAuthContext, Depends(_get_trusted_auth_context)],
) -> JSONResponse:
    runtime_api = _get_runtime_api(request)
    response = await runtime_api.handle(api_request, user_id=auth.user_id)
    return _public_api_response(response)


@router.post("/runtime/stream")
async def handle_runtime_stream(
    request: Request,
    api_request: PublicAPIRequest,
    auth: Annotated[TrustedAuthContext, Depends(_get_trusted_auth_context)],
) -> StreamingResponse:
    runtime_api = _get_runtime_api(request)
    queue: asyncio.Queue[str | None] = asyncio.Queue()

    async def emit(event: str, data: dict[str, object]) -> None:
        payload = json.dumps({"event": event, **data}, ensure_ascii=False)
        await queue.put(f"event: {event}\ndata: {payload}\n\n")

    async def on_step(
        tool: str,
        status: str,
        data: dict[str, object],
        thought: str = "",
        observation: str = "",
    ) -> None:
        await emit(
            "step",
            {
                "tool": tool,
                "status": status,
                "thought": thought,
                "observation": observation,
                "data": data,
            },
        )

    async def run_pipeline_task() -> None:
        try:
            response = await runtime_api.handle(
                api_request,
                user_id=auth.user_id,
                on_step=on_step,
            )
            await emit("done", response.model_dump(mode="json"))
        except Exception as exc:
            error_message = str(exc)
            logger.exception("sse_pipeline_error", error=error_message)
            await emit(
                "error",
                {
                    "code": "internal_error",
                    "message": _user_facing_error(error_message),
                    "detail": error_message[:500],
                },
            )
        finally:
            await queue.put(None)

    async def event_generator() -> AsyncIterator[str]:
        task = asyncio.create_task(run_pipeline_task())
        planning_payload = json.dumps(
            {"event": "planning", "status": "running"},
            ensure_ascii=False,
        )
        try:
            yield f"event: planning\ndata: {planning_payload}\n\n"
            while True:
                item = await queue.get()
                if item is None:
                    break
                if await request.is_disconnected():
                    break
                yield item
        finally:
            if not task.done():
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
            else:
                await task

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
