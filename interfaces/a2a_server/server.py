"""A2A Server application using Starlette.

This server exposes the Seichijunrei bot via the A2A protocol,
allowing agent-to-agent communication.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from google.genai import types
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

if TYPE_CHECKING:
    from google.adk.agents import BaseAgent

logger = get_logger(__name__)

# Agent card metadata for /.well-known/agent.json
AGENT_CARD = {
    "name": "seichijunrei_bot",
    "description": "AI-powered travel assistant for anime pilgrims",
    "version": "0.1.0",
    "protocol": "a2a",
    "capabilities": {
        "streaming": False,
        "pushNotifications": False,
        "a2ui": {
            "version": "v0.8",
            "surfaces": ["main"],
            "components": [
                "Text",
                "Button",
                "Card",
                "Row",
                "Column",
                "Image",
                "Divider",
            ],
        },
    },
    "skills": [
        {
            "id": "bangumi_search",
            "name": "Bangumi Search",
            "description": "Search for anime titles and get pilgrimage location candidates",
        },
        {
            "id": "route_planning",
            "name": "Route Planning",
            "description": "Plan pilgrimage routes with optimized ordering",
        },
    ],
}


class A2AServer:
    """A2A protocol server wrapping an ADK agent."""

    def __init__(
        self,
        *,
        session_store: SessionStore | None = None,
        agent_name: str = "seichijunrei_bot",
        agent: BaseAgent | None = None,
    ) -> None:
        self._session_store = session_store or InMemorySessionStore()
        self._agent_name = agent_name
        self._tasks: dict[str, Task] = {}
        self._states: dict[str, dict[str, Any]] = {}

        # Lazy-load agent if not provided
        self._agent = agent
        self._session_service: Any = None

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

        # Run the ADK agent
        await self._run_agent(user_text, session.context_id)

        # Generate A2UI response from session state (deterministic UI generation)
        state = self._states.get(session.context_id, {})
        assistant_text, a2ui_messages = build_a2ui_response(state)

        # Update task with A2UI-generated response
        agent_message = Message.agent_text(assistant_text)
        task.history.append(agent_message)
        task.status = TaskStatus(
            state=TaskState.COMPLETED,
            message=agent_message,
            timestamp=datetime.now(UTC).isoformat(),
        )
        task.a2ui_messages = a2ui_messages

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

    async def _run_agent(self, user_text: str, session_id: str) -> str:
        """Run the ADK agent with user input.

        Args:
            user_text: The user's message text
            session_id: The session identifier for state management

        Returns:
            The agent's response text
        """
        agent = self._get_agent()
        session_service = self._get_session_service()
        state = self._states.setdefault(session_id, {})

        from google.adk.agents.invocation_context import InvocationContext
        from google.adk.agents.run_config import RunConfig
        from google.adk.sessions.session import Session

        session = Session(
            id=session_id,
            app_name=self._agent_name,
            user_id="a2a-client",
            state=state,
        )
        run_config = RunConfig(response_modalities=["TEXT"])
        ctx = InvocationContext(
            session_service=session_service,
            invocation_id=f"a2a-{os.urandom(8).hex()}",
            agent=agent,
            user_content=types.Content(role="user", parts=[types.Part(text=user_text)]),
            session=session,
            run_config=run_config,
        )

        last_model_text: str | None = None
        async for event in agent.run_async(ctx):
            content = getattr(event, "content", None)
            parts = getattr(content, "parts", None) if content else None
            if not parts:
                continue
            if getattr(content, "role", None) not in {None, "model", "assistant"}:
                continue
            texts = [p.text for p in parts if getattr(p, "text", None)]
            if texts:
                last_model_text = "\n".join(texts).strip() or last_model_text

        return last_model_text or "[No response from agent]"

    def _get_agent(self) -> BaseAgent:
        """Get or lazy-load the ADK agent."""
        if self._agent is None:
            from adk_agents.seichijunrei_bot.agent import root_agent

            self._agent = root_agent
        return self._agent

    def _get_session_service(self) -> Any:
        """Get or create the session service."""
        if self._session_service is None:
            from google.adk.sessions import InMemorySessionService

            self._session_service = InMemorySessionService()
        return self._session_service


def create_app(server: A2AServer | None = None) -> Starlette:
    """Create the A2A server Starlette application."""
    if server is None:
        server = A2AServer()

    async def a2a_endpoint(request: Request) -> JSONResponse:
        return await server.handle_request(request)

    async def health_endpoint(request: Request) -> JSONResponse:
        """Health check endpoint."""
        return JSONResponse({"status": "healthy", "service": "a2a-server"})

    async def agent_card_endpoint(request: Request) -> JSONResponse:
        """Agent card endpoint for A2A discovery."""
        return JSONResponse(AGENT_CARD)

    routes = [
        Route("/", a2a_endpoint, methods=["POST"]),
        Route("/a2a", a2a_endpoint, methods=["POST"]),
        Route("/health", health_endpoint, methods=["GET"]),
        Route("/.well-known/agent.json", agent_card_endpoint, methods=["GET"]),
    ]

    app = Starlette(routes=routes)
    return app


# Default application instance
app = create_app()
