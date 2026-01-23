"""Unit tests for tool result types."""


from adk_agents.seichijunrei_bot.tools.result import (
    ErrorCodes,
    ToolResult,
    error_result,
    success_result,
)


class TestToolResult:
    """Tests for ToolResult dataclass."""

    def test_success_result_creation(self):
        """Test creating a successful result."""
        result = ToolResult(success=True, data={"key": "value"})
        assert result.success is True
        assert result.data == {"key": "value"}
        assert result.error is None

    def test_error_result_creation(self):
        """Test creating an error result."""
        result = ToolResult(
            success=False,
            error="Something went wrong",
            error_code=ErrorCodes.INTERNAL_ERROR,
        )
        assert result.success is False
        assert result.data is None
        assert result.error == "Something went wrong"
        assert result.error_code == ErrorCodes.INTERNAL_ERROR

    def test_to_dict_with_data(self):
        """Test to_dict merges dict data into result."""
        result = ToolResult(success=True, data={"keyword": "test", "results": []})
        d = result.to_dict()
        assert d["success"] is True
        assert d["keyword"] == "test"
        assert d["results"] == []
        assert d["error"] is None

    def test_to_dict_with_non_dict_data(self):
        """Test to_dict wraps non-dict data."""
        result = ToolResult(success=True, data=[1, 2, 3])
        d = result.to_dict()
        assert d["data"] == [1, 2, 3]

    def test_to_dict_includes_error_code(self):
        """Test to_dict includes error_code when present."""
        result = ToolResult(
            success=False, error="Error", error_code=ErrorCodes.TIMEOUT
        )
        d = result.to_dict()
        assert d["error_code"] == ErrorCodes.TIMEOUT

    def test_to_dict_includes_metadata(self):
        """Test to_dict includes metadata when present."""
        result = ToolResult(success=True, data={}, metadata={"duration_ms": 100})
        d = result.to_dict()
        assert d["metadata"]["duration_ms"] == 100


class TestSuccessResult:
    """Tests for success_result helper."""

    def test_creates_success_result(self):
        """Test success_result creates correct ToolResult."""
        result = success_result({"items": [1, 2, 3]})
        assert result.success is True
        assert result.data == {"items": [1, 2, 3]}

    def test_includes_metadata(self):
        """Test success_result includes metadata kwargs."""
        result = success_result({}, source="api", cached=True)
        assert result.metadata["source"] == "api"
        assert result.metadata["cached"] is True


class TestErrorResult:
    """Tests for error_result helper."""

    def test_creates_error_result_from_string(self):
        """Test error_result from string message."""
        result = error_result("Connection failed")
        assert result.success is False
        assert result.error == "Connection failed"
        assert result.data is None

    def test_creates_error_result_from_exception(self):
        """Test error_result from exception."""
        exc = ValueError("Invalid value")
        result = error_result(exc)
        assert result.error == "Invalid value"

    def test_includes_error_code(self):
        """Test error_result includes error_code."""
        result = error_result("Not found", error_code=ErrorCodes.NOT_FOUND)
        assert result.error_code == ErrorCodes.NOT_FOUND

    def test_includes_metadata(self):
        """Test error_result includes metadata kwargs."""
        result = error_result("Error", endpoint="/api/test", status_code=500)
        assert result.metadata["endpoint"] == "/api/test"
        assert result.metadata["status_code"] == 500


class TestErrorCodes:
    """Tests for ErrorCodes constants."""

    def test_error_codes_are_strings(self):
        """Verify error codes are string constants."""
        assert isinstance(ErrorCodes.EXTERNAL_SERVICE_ERROR, str)
        assert isinstance(ErrorCodes.NOT_FOUND, str)
        assert isinstance(ErrorCodes.INTERNAL_ERROR, str)
