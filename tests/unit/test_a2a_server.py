"""Unit tests for A2A server."""

import pytest
from starlette.testclient import TestClient

from interfaces.a2a_server.server import A2AServer, create_app
from interfaces.a2a_server.types import ErrorCode, TaskState


@pytest.fixture
def client():
    """Create test client for A2A server."""
    app = create_app()
    return TestClient(app)


@pytest.fixture
def server():
    """Create A2A server instance."""
    return A2AServer()


class TestA2ATypes:
    """Tests for A2A protocol types."""

    def test_task_state_values(self):
        """Verify task state enum values match A2A spec."""
        assert TaskState.SUBMITTED.value == "submitted"
        assert TaskState.WORKING.value == "working"
        assert TaskState.COMPLETED.value == "completed"
        assert TaskState.FAILED.value == "failed"


class TestA2AServer:
    """Tests for A2A server endpoints."""

    def test_invalid_json_returns_parse_error(self, client):
        """Invalid JSON should return parse error."""
        response = client.post(
            "/a2a",
            content="not valid json",
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 400
        data = response.json()
        assert data["error"]["code"] == ErrorCode.PARSE_ERROR

    def test_unknown_method_returns_method_not_found(self, client):
        """Unknown method should return method not found error."""
        response = client.post(
            "/a2a",
            json={
                "jsonrpc": "2.0",
                "method": "unknown/method",
                "params": {},
                "id": "1",
            },
        )
        assert response.status_code == 404
        data = response.json()
        assert data["error"]["code"] == ErrorCode.METHOD_NOT_FOUND

    def test_tasks_send_creates_task(self, client):
        """tasks/send should create and process a task."""
        response = client.post(
            "/a2a",
            json={
                "jsonrpc": "2.0",
                "method": "tasks/send",
                "params": {
                    "id": "test-task-1",
                    "message": {
                        "role": "user",
                        "parts": [{"text": "Hello, agent!"}],
                    },
                },
                "id": "req-1",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["jsonrpc"] == "2.0"
        assert data["id"] == "req-1"
        assert "result" in data
        assert data["result"]["id"] == "test-task-1"
        assert data["result"]["status"]["state"] == "completed"

    def test_tasks_send_with_session_id(self, client):
        """tasks/send should use provided session ID."""
        response = client.post(
            "/a2a",
            json={
                "jsonrpc": "2.0",
                "method": "tasks/send",
                "params": {
                    "id": "test-task-2",
                    "sessionId": "custom-session-123",
                    "message": {
                        "role": "user",
                        "parts": [{"text": "Test message"}],
                    },
                },
                "id": "req-2",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["result"]["sessionId"] == "custom-session-123"

    def test_tasks_get_returns_task(self, client):
        """tasks/get should return existing task."""
        # First create a task
        client.post(
            "/a2a",
            json={
                "jsonrpc": "2.0",
                "method": "tasks/send",
                "params": {
                    "id": "task-to-get",
                    "message": {"role": "user", "parts": [{"text": "Hello"}]},
                },
                "id": "1",
            },
        )

        # Then get it
        response = client.post(
            "/a2a",
            json={
                "jsonrpc": "2.0",
                "method": "tasks/get",
                "params": {"id": "task-to-get"},
                "id": "2",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["result"]["id"] == "task-to-get"

    def test_tasks_get_not_found(self, client):
        """tasks/get should return error for unknown task."""
        response = client.post(
            "/a2a",
            json={
                "jsonrpc": "2.0",
                "method": "tasks/get",
                "params": {"id": "nonexistent"},
                "id": "1",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["error"]["code"] == ErrorCode.TASK_NOT_FOUND

    def test_tasks_cancel(self, client):
        """tasks/cancel should cancel a running task."""
        # Create a task
        client.post(
            "/a2a",
            json={
                "jsonrpc": "2.0",
                "method": "tasks/send",
                "params": {
                    "id": "task-to-cancel",
                    "message": {"role": "user", "parts": [{"text": "Hello"}]},
                },
                "id": "1",
            },
        )

        # Cancel it
        response = client.post(
            "/a2a",
            json={
                "jsonrpc": "2.0",
                "method": "tasks/cancel",
                "params": {"id": "task-to-cancel"},
                "id": "2",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["result"]["status"]["state"] == "canceled"

    def test_root_endpoint_works(self, client):
        """Root endpoint should accept A2A requests."""
        response = client.post(
            "/",
            json={
                "jsonrpc": "2.0",
                "method": "tasks/send",
                "params": {
                    "id": "root-test",
                    "message": {"role": "user", "parts": [{"text": "Test"}]},
                },
                "id": "1",
            },
        )
        assert response.status_code == 200
