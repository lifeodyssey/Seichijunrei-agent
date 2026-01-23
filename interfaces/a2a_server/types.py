"""A2A Protocol types and contracts.

Based on Google's Agent-to-Agent (A2A) protocol specification.
See: https://google.github.io/A2A/
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class TaskState(str, Enum):
    """Task lifecycle states per A2A spec."""

    SUBMITTED = "submitted"
    WORKING = "working"
    INPUT_REQUIRED = "input-required"
    COMPLETED = "completed"
    CANCELED = "canceled"
    FAILED = "failed"


@dataclass
class Message:
    """A2A message (user or agent)."""

    role: str  # "user" or "agent"
    parts: list[dict[str, Any]]

    @classmethod
    def user_text(cls, text: str) -> Message:
        return cls(role="user", parts=[{"text": text}])

    @classmethod
    def agent_text(cls, text: str) -> Message:
        return cls(role="agent", parts=[{"text": text}])

    def to_dict(self) -> dict[str, Any]:
        return {"role": self.role, "parts": self.parts}


@dataclass
class TaskSendParams:
    """Parameters for tasks/send method."""

    id: str
    message: Message
    session_id: str | None = None
    push_notification: dict[str, Any] | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TaskSendParams:
        message_data = data.get("message", {})
        return cls(
            id=data.get("id", ""),
            message=Message(
                role=message_data.get("role", "user"),
                parts=message_data.get("parts", []),
            ),
            session_id=data.get("sessionId"),
            push_notification=data.get("pushNotification"),
        )


@dataclass
class TaskStatus:
    """Task status update."""

    state: TaskState
    message: Message | None = None
    timestamp: str | None = None

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {"state": self.state.value}
        if self.message:
            result["message"] = self.message.to_dict()
        if self.timestamp:
            result["timestamp"] = self.timestamp
        return result


@dataclass
class Task:
    """A2A Task object."""

    id: str
    session_id: str
    status: TaskStatus
    history: list[Message] = field(default_factory=list)
    artifacts: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "sessionId": self.session_id,
            "status": self.status.to_dict(),
            "history": [m.to_dict() for m in self.history],
            "artifacts": self.artifacts,
        }


@dataclass
class A2ARequest:
    """JSON-RPC 2.0 request wrapper."""

    jsonrpc: str
    method: str
    params: dict[str, Any]
    id: str | int | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> A2ARequest:
        return cls(
            jsonrpc=data.get("jsonrpc", "2.0"),
            method=data.get("method", ""),
            params=data.get("params", {}),
            id=data.get("id"),
        )


@dataclass
class A2AResponse:
    """JSON-RPC 2.0 response wrapper."""

    jsonrpc: str = "2.0"
    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None
    id: str | int | None = None

    def to_dict(self) -> dict[str, Any]:
        response: dict[str, Any] = {"jsonrpc": self.jsonrpc}
        if self.result is not None:
            response["result"] = self.result
        if self.error is not None:
            response["error"] = self.error
        if self.id is not None:
            response["id"] = self.id
        return response

    @classmethod
    def success(
        cls, result: dict[str, Any], request_id: str | int | None
    ) -> A2AResponse:
        return cls(result=result, id=request_id)

    @classmethod
    def error_response(
        cls,
        code: int,
        message: str,
        request_id: str | int | None,
        data: dict[str, Any] | None = None,
    ) -> A2AResponse:
        error: dict[str, Any] = {"code": code, "message": message}
        if data:
            error["data"] = data
        return cls(error=error, id=request_id)


# Standard JSON-RPC error codes
class ErrorCode:
    PARSE_ERROR = -32700
    INVALID_REQUEST = -32600
    METHOD_NOT_FOUND = -32601
    INVALID_PARAMS = -32602
    INTERNAL_ERROR = -32603
    # A2A-specific error codes (application-defined, -32000 to -32099)
    TASK_NOT_FOUND = -32001
    SESSION_NOT_FOUND = -32002
    AGENT_ERROR = -32010
