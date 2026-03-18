"""A2A Server application using Starlette.

This server exposes the Seichijunrei bot via the A2A protocol,
allowing agent-to-agent communication.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from contracts.a2ui import InMemorySessionStore, SessionStore
from interfaces.a2ui_web.presenter import build_a2ui_response
from utils.logger import get_logger

from .types import (
    A2ARequest,
    A2AResponse,
    ErrorCode,
    Message,
    Task,
    TaskSendParams,
    TaskState,
    TaskStatus,
)

logger = get_logger(__name__)

AGENT_CARD = {
    "name": "seichijunrei_bot",
    "description": "AI-powered travel assistant for anime pilgrims",
    "version": "0.2.0",
    "protocol": "a2a",
    "capabilities": {
        "streaming": False,
        "pushNotifications": False,
        "a2ui": {
            "version": "v0.8",
            "surfaces": ["main"],
            "components": ["Text", "Button", "Card", "Row", "Column", "Image", "Divider"],
        },
    },
    "skills": [
        {"id": "bangumi_search", "name": "Bangumi Search", "description": "Search for anime titles and get pilgrimage location candidates"},
        {"id": "route_planning", "name": "Route Planning", "description": "Plan pilgrimage routes with optimized ordering"},
    ],
}


class A2AServer:
    """A2A protocol server.

    Agent execution will be wired in ITER-3 when the Pydantic AI chain is ready.
    The protocol skeleton (task lifecycle, A2UI response) is framework-agnostic.
    """

    def __init__(
        self,
        *,
        session_store: SessionStore | None = None,
        agent_name: str = "seichijunrei_bot",
    ) -> None:
        self._session_store = session_store or InMemorySessionStore()
        self._agent_name = agent_name
        self._tasks: dict[str, Task] = {}
        self._states: dict[str, dict[str, Any]] = {}

    async def handle_request(self, request: Request) -> JSONResponse:
        try:
            body = await request.json()
        except json.JSONDecodeError as e:
            return JSONResponse(
                A2AResponse.error_response(ErrorCode.PARSE_ERROR, f"Invalid JSON: {e}", None).to_dict(),
                status_code=400,
            )

        a2a_request = A2ARequest.from_dict(body)
        logger.info("A2A request received", method=a2a_request.method, request_id=a2a_request.id)

        handlers = {
            "tasks/send": self._handle_tasks_send,
            "tasks/get": self._handle_tasks_get,
            "tasks/cancel": self._handle_tasks_cancel,
        }
        handler = handlers.get(a2a_request.method)
        if handler is None:
            return JSONResponse(
                A2AResponse.error_response(ErrorCode.METHOD_NOT_FOUND, f"Method not found: {a2a_request.method}", a2a_request.id).to_dict(),
                status_code=404,
            )

        try:
            response = await handler(a2a_request)
            return JSONResponse(response.to_dict())
        except Exception as e:
            logger.error("A2A handler error", error=str(e), exc_info=True)
            return JSONResponse(
                A2AResponse.error_response(ErrorCode.INTERNAL_ERROR, str(e), a2a_request.id).to_dict(),
                status_code=500,
            )

    async def _handle_tasks_send(self, request: A2ARequest) -> A2AResponse:
        params = TaskSendParams.from_dict(request.params)
        session_id = params.session_id or str(uuid.uuid4())
        await self._session_store.get_or_create(
            context_id=session_id, user_id="a2a-client", app_name=self._agent_name,
        )

        task_id = params.id or str(uuid.uuid4())
        task = Task(
            id=task_id, session_id=session_id,
            status=TaskStatus(state=TaskState.WORKING), history=[params.message],
        )
        self._tasks[task_id] = task

        user_text = ""
        for part in params.message.parts:
            if "text" in part:
                user_text = part["text"]
                break

        # TODO(ITER-3): wire to Pydantic AI agent chain
        logger.info("Processing A2A task", task_id=task_id, session_id=session_id)

        state = self._states.get(session_id, {})
        assistant_text, a2ui_messages = build_a2ui_response(state)

        agent_message = Message.agent_text(assistant_text)
        task.history.append(agent_message)
        task.status = TaskStatus(
            state=TaskState.COMPLETED, message=agent_message,
            timestamp=datetime.now(UTC).isoformat(),
        )
        task.a2ui_messages = a2ui_messages
        return A2AResponse.success(task.to_dict(), request.id)

    async def _handle_tasks_get(self, request: A2ARequest) -> A2AResponse:
        task_id = request.params.get("id")
        if not task_id:
            return A2AResponse.error_response(ErrorCode.INVALID_PARAMS, "Missing required parameter: id", request.id)
        task = self._tasks.get(task_id)
        if not task:
            return A2AResponse.error_response(ErrorCode.TASK_NOT_FOUND, f"Task not found: {task_id}", request.id)
        return A2AResponse.success(task.to_dict(), request.id)

    async def _handle_tasks_cancel(self, request: A2ARequest) -> A2AResponse:
        task_id = request.params.get("id")
        if not task_id:
            return A2AResponse.error_response(ErrorCode.INVALID_PARAMS, "Missing required parameter: id", request.id)
        task = self._tasks.get(task_id)
        if not task:
            return A2AResponse.error_response(ErrorCode.TASK_NOT_FOUND, f"Task not found: {task_id}", request.id)
        task.status = TaskStatus(state=TaskState.CANCELED, timestamp=datetime.now(UTC).isoformat())
        return A2AResponse.success(task.to_dict(), request.id)


def create_app(server: A2AServer | None = None) -> Starlette:
    if server is None:
        server = A2AServer()

    async def a2a_endpoint(request: Request) -> JSONResponse:
        return await server.handle_request(request)

    async def health_endpoint(request: Request) -> JSONResponse:
        return JSONResponse({"status": "healthy", "service": "a2a-server"})

    async def agent_card_endpoint(request: Request) -> JSONResponse:
        return JSONResponse(AGENT_CARD)

    return Starlette(routes=[
        Route("/", a2a_endpoint, methods=["POST"]),
        Route("/a2a", a2a_endpoint, methods=["POST"]),
        Route("/health", health_endpoint, methods=["GET"]),
        Route("/.well-known/agent.json", agent_card_endpoint, methods=["GET"]),
    ])


app = create_app()
