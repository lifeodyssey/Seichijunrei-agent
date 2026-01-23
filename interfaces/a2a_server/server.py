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


class A2AServer:
    """A2A protocol server wrapping an ADK agent."""

    def __init__(
        self,
        *,
        session_store: SessionStore | None = None,
        agent_name: str = "seichijunrei_bot",
    ) -> None:
        self._session_store = session_store or InMemorySessionStore()
        self._agent_name = agent_name
        self._tasks: dict[str, Task] = {}

    async def handle_request(self, request: Request) -> JSONResponse:
        """Handle incoming A2A JSON-RPC request."""
        try:
            body = await request.json()
        except json.JSONDecodeError as e:
            response = A2AResponse.error_response(
                ErrorCode.PARSE_ERROR,
                f"Invalid JSON: {e}",
                None,
            )
            return JSONResponse(response.to_dict(), status_code=400)

        a2a_request = A2ARequest.from_dict(body)
        logger.info(
            "A2A request received",
            method=a2a_request.method,
            request_id=a2a_request.id,
        )

        # Route to appropriate handler
        handlers = {
            "tasks/send": self._handle_tasks_send,
            "tasks/get": self._handle_tasks_get,
            "tasks/cancel": self._handle_tasks_cancel,
        }

        handler = handlers.get(a2a_request.method)
        if handler is None:
            response = A2AResponse.error_response(
                ErrorCode.METHOD_NOT_FOUND,
                f"Method not found: {a2a_request.method}",
                a2a_request.id,
            )
            return JSONResponse(response.to_dict(), status_code=404)

        try:
            response = await handler(a2a_request)
            return JSONResponse(response.to_dict())
        except Exception as e:
            logger.error("A2A handler error", error=str(e), exc_info=True)
            response = A2AResponse.error_response(
                ErrorCode.INTERNAL_ERROR,
                str(e),
                a2a_request.id,
            )
            return JSONResponse(response.to_dict(), status_code=500)

    async def _handle_tasks_send(self, request: A2ARequest) -> A2AResponse:
        """Handle tasks/send method - send a message to the agent."""
        params = TaskSendParams.from_dict(request.params)

        # Get or create session
        session_id = params.session_id or str(uuid.uuid4())
        session = await self._session_store.get_or_create(
            context_id=session_id,
            user_id="a2a-client",
            app_name=self._agent_name,
        )

        # Create task
        task_id = params.id or str(uuid.uuid4())
        task = Task(
            id=task_id,
            session_id=session.context_id,
            status=TaskStatus(state=TaskState.WORKING),
            history=[params.message],
        )
        self._tasks[task_id] = task

        # Extract user text from message
        user_text = ""
        for part in params.message.parts:
            if "text" in part:
                user_text = part["text"]
                break

        logger.info(
            "Processing A2A task",
            task_id=task_id,
            session_id=session.context_id,
            user_text=user_text[:100] if user_text else "",
        )

        # TODO: Run the actual ADK agent here
        # For now, return a placeholder response
        agent_response = await self._run_agent(user_text, session.state)

        # Update task with response
        agent_message = Message.agent_text(agent_response)
        task.history.append(agent_message)
        task.status = TaskStatus(
            state=TaskState.COMPLETED,
            message=agent_message,
            timestamp=datetime.now(UTC).isoformat(),
        )

        return A2AResponse.success(task.to_dict(), request.id)

    async def _handle_tasks_get(self, request: A2ARequest) -> A2AResponse:
        """Handle tasks/get method - retrieve task status."""
        task_id = request.params.get("id")
        if not task_id:
            return A2AResponse.error_response(
                ErrorCode.INVALID_PARAMS,
                "Missing required parameter: id",
                request.id,
            )

        task = self._tasks.get(task_id)
        if not task:
            return A2AResponse.error_response(
                ErrorCode.TASK_NOT_FOUND,
                f"Task not found: {task_id}",
                request.id,
            )

        return A2AResponse.success(task.to_dict(), request.id)

    async def _handle_tasks_cancel(self, request: A2ARequest) -> A2AResponse:
        """Handle tasks/cancel method - cancel a running task."""
        task_id = request.params.get("id")
        if not task_id:
            return A2AResponse.error_response(
                ErrorCode.INVALID_PARAMS,
                "Missing required parameter: id",
                request.id,
            )

        task = self._tasks.get(task_id)
        if not task:
            return A2AResponse.error_response(
                ErrorCode.TASK_NOT_FOUND,
                f"Task not found: {task_id}",
                request.id,
            )

        # Update task status to canceled
        task.status = TaskStatus(
            state=TaskState.CANCELED,
            timestamp=datetime.now(UTC).isoformat(),
        )

        return A2AResponse.success(task.to_dict(), request.id)

    async def _run_agent(self, user_text: str, state: dict[str, Any]) -> str:
        """Run the ADK agent with user input.

        This is a placeholder that will be connected to the actual agent.
        """
        # TODO: Connect to actual ADK agent
        # For now, return a placeholder
        return f"[A2A Server] Received: {user_text}"


def create_app(server: A2AServer | None = None) -> Starlette:
    """Create the A2A server Starlette application."""
    if server is None:
        server = A2AServer()

    async def a2a_endpoint(request: Request) -> JSONResponse:
        return await server.handle_request(request)

    routes = [
        Route("/", a2a_endpoint, methods=["POST"]),
        Route("/a2a", a2a_endpoint, methods=["POST"]),
    ]

    app = Starlette(routes=routes)
    return app


# Default application instance
app = create_app()
