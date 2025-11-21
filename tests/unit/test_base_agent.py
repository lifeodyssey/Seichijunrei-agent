"""Unit tests for base agent architecture following TDD principles."""

import pytest
import asyncio
from abc import ABC
from typing import Optional, Dict, Any
from datetime import datetime
from unittest.mock import Mock, patch, AsyncMock
from pydantic import BaseModel, Field, ValidationError


# Import statements that will exist after implementation
# These will fail initially (RED phase of TDD)
from agents.base import (
    AbstractBaseAgent,
    AgentInput,
    AgentOutput,
    AgentState,
    AgentError,
    AgentExecutionError,
    AgentValidationError,
)


class TestAgentInput:
    """Test AgentInput Pydantic model."""

    def test_create_agent_input(self):
        """Test creating valid agent input."""
        input_data = AgentInput(
            session_id="test-session-123",
            data={"query": "Find anime locations near Tokyo Station"},
            metadata={"source": "user", "timestamp": "2025-11-20T10:00:00"},
        )

        assert input_data.session_id == "test-session-123"
        assert input_data.data["query"] == "Find anime locations near Tokyo Station"
        assert input_data.metadata["source"] == "user"

    def test_agent_input_validation(self):
        """Test agent input validation."""
        # Session ID is required
        with pytest.raises(ValidationError):
            AgentInput(data={"query": "test"})

        # Data must be a dictionary
        with pytest.raises(ValidationError):
            AgentInput(session_id="test", data="not a dict")

    def test_agent_input_empty_data(self):
        """Test agent input with empty data dictionary."""
        input_data = AgentInput(session_id="test", data={})
        assert input_data.data == {}
        assert input_data.metadata == {}


class TestAgentOutput:
    """Test AgentOutput Pydantic model."""

    def test_create_agent_output(self):
        """Test creating valid agent output."""
        output = AgentOutput(
            success=True,
            data={"locations": ["Location 1", "Location 2"]},
            error=None,
            metadata={"processing_time": 1.5},
        )

        assert output.success is True
        assert len(output.data["locations"]) == 2
        assert output.error is None
        assert output.metadata["processing_time"] == 1.5

    def test_agent_output_with_error(self):
        """Test agent output with error."""
        output = AgentOutput(
            success=False,
            data={},
            error="API request failed",
            metadata={"retry_count": 3},
        )

        assert output.success is False
        assert output.data == {}
        assert output.error == "API request failed"

    def test_agent_output_validation(self):
        """Test agent output validation."""
        # Success is required
        with pytest.raises(ValidationError):
            AgentOutput(data={"test": "data"})

        # Data must be a dictionary
        with pytest.raises(ValidationError):
            AgentOutput(success=True, data="not a dict")


class TestAgentState:
    """Test AgentState enum."""

    def test_agent_states(self):
        """Test all agent states are defined."""
        assert AgentState.IDLE == "idle"
        assert AgentState.INITIALIZING == "initializing"
        assert AgentState.EXECUTING == "executing"
        assert AgentState.COMPLETED == "completed"
        assert AgentState.FAILED == "failed"

    def test_state_transitions(self):
        """Test that state values are strings for serialization."""
        states = [AgentState.IDLE, AgentState.EXECUTING, AgentState.COMPLETED]
        for state in states:
            assert isinstance(state.value, str)


class TestAbstractBaseAgent:
    """Test AbstractBaseAgent abstract base class."""

    @pytest.fixture
    def concrete_agent_class(self):
        """Create a concrete implementation of AbstractBaseAgent for testing."""

        class ConcreteAgent(AbstractBaseAgent):
            """Concrete agent for testing."""

            def __init__(self):
                super().__init__(name="TestAgent", description="Test agent for unit tests")

            async def _execute_logic(self, input_data: AgentInput) -> Dict[str, Any]:
                """Concrete implementation of execute logic."""
                # Simple echo implementation
                return {"echo": input_data.data}

            def _validate_input(self, input_data: AgentInput) -> bool:
                """Validate input for this specific agent."""
                return "query" in input_data.data

        return ConcreteAgent

    @pytest.mark.asyncio
    async def test_agent_initialization(self, concrete_agent_class):
        """Test agent initialization."""
        agent = concrete_agent_class()

        assert agent.name == "TestAgent"
        assert agent.description == "Test agent for unit tests"
        assert agent.state == AgentState.IDLE
        assert agent.logger is not None

    @pytest.mark.asyncio
    async def test_agent_execute_success(self, concrete_agent_class):
        """Test successful agent execution."""
        agent = concrete_agent_class()
        input_data = AgentInput(
            session_id="test-session",
            data={"query": "test query"},
        )

        output = await agent.execute(input_data)

        assert output.success is True
        assert output.data["echo"]["query"] == "test query"
        assert output.error is None
        assert agent.state == AgentState.COMPLETED

    @pytest.mark.asyncio
    async def test_agent_execute_validation_failure(self, concrete_agent_class):
        """Test agent execution with validation failure."""
        agent = concrete_agent_class()
        input_data = AgentInput(
            session_id="test-session",
            data={"invalid": "no query field"},
        )

        output = await agent.execute(input_data)

        assert output.success is False
        assert output.error is not None
        assert "validation" in output.error.lower()
        assert agent.state == AgentState.FAILED

    @pytest.mark.asyncio
    async def test_agent_execute_with_exception(self, concrete_agent_class):
        """Test agent execution with exception handling."""
        agent = concrete_agent_class()

        # Mock the execute logic to raise an exception
        async def failing_logic(input_data):
            raise ValueError("Simulated failure")

        agent._execute_logic = failing_logic

        input_data = AgentInput(
            session_id="test-session",
            data={"query": "test"},
        )

        output = await agent.execute(input_data)

        assert output.success is False
        assert output.error is not None
        assert "Simulated failure" in output.error
        assert agent.state == AgentState.FAILED

    @pytest.mark.asyncio
    async def test_agent_state_transitions(self, concrete_agent_class):
        """Test agent state transitions during execution."""
        agent = concrete_agent_class()

        # Initial state
        assert agent.state == AgentState.IDLE

        # Create a slow executing agent to observe state transitions
        original_execute = agent._execute_logic

        async def slow_execute(input_data):
            await asyncio.sleep(0.1)
            return await original_execute(input_data)

        agent._execute_logic = slow_execute

        input_data = AgentInput(
            session_id="test-session",
            data={"query": "test"},
        )

        # Start execution in background
        task = asyncio.create_task(agent.execute(input_data))

        # Check state transitions
        await asyncio.sleep(0.01)  # Let execution start
        assert agent.state == AgentState.EXECUTING

        # Wait for completion
        output = await task
        assert agent.state == AgentState.COMPLETED

    @pytest.mark.asyncio
    async def test_agent_logging(self, concrete_agent_class, caplog):
        """Test agent logging during execution."""
        agent = concrete_agent_class()
        input_data = AgentInput(
            session_id="test-session",
            data={"query": "test query"},
        )

        with patch.object(agent.logger, 'info') as mock_info:
            with patch.object(agent.logger, 'error') as mock_error:
                output = await agent.execute(input_data)

                # Check that info logging was called
                assert mock_info.called
                mock_info.assert_any_call(
                    "Agent execution started",
                    agent="TestAgent",
                    session_id="test-session"
                )

    @pytest.mark.asyncio
    async def test_agent_cleanup(self, concrete_agent_class):
        """Test agent cleanup method."""
        agent = concrete_agent_class()

        # Execute to change state
        input_data = AgentInput(
            session_id="test-session",
            data={"query": "test"},
        )
        await agent.execute(input_data)

        # Cleanup should reset state
        await agent.cleanup()
        assert agent.state == AgentState.IDLE

    def test_abstract_agent_cannot_be_instantiated(self):
        """Test that AbstractBaseAgent cannot be directly instantiated."""
        with pytest.raises(TypeError):
            # This should fail because _execute_logic is abstract
            AbstractBaseAgent(name="Test", description="Test")


class TestAgentExceptions:
    """Test agent-specific exceptions."""

    def test_agent_error_base(self):
        """Test base AgentError exception."""
        error = AgentError("Something went wrong")
        assert str(error) == "Something went wrong"
        assert isinstance(error, Exception)

    def test_agent_execution_error(self):
        """Test AgentExecutionError exception."""
        error = AgentExecutionError("Failed to execute agent logic")
        assert str(error) == "Failed to execute agent logic"
        assert isinstance(error, AgentError)

    def test_agent_validation_error(self):
        """Test AgentValidationError exception."""
        error = AgentValidationError("Invalid input data")
        assert str(error) == "Invalid input data"
        assert isinstance(error, AgentError)

    def test_exception_with_context(self):
        """Test exceptions with additional context."""
        try:
            raise AgentExecutionError("API call failed") from ValueError("Connection timeout")
        except AgentExecutionError as e:
            assert str(e) == "API call failed"
            assert isinstance(e.__cause__, ValueError)


class TestAgentIntegration:
    """Integration tests for agent functionality."""

    @pytest.mark.asyncio
    async def test_multiple_agent_execution(self):
        """Test executing multiple agents concurrently."""

        class SearchAgent(AbstractBaseAgent):
            async def _execute_logic(self, input_data: AgentInput) -> Dict[str, Any]:
                await asyncio.sleep(0.1)
                return {"results": ["Location 1", "Location 2"]}

            def _validate_input(self, input_data: AgentInput) -> bool:
                return True

        class FilterAgent(AbstractBaseAgent):
            async def _execute_logic(self, input_data: AgentInput) -> Dict[str, Any]:
                await asyncio.sleep(0.05)
                return {"filtered": ["Location 1"]}

            def _validate_input(self, input_data: AgentInput) -> bool:
                return True

        search_agent = SearchAgent(name="Search", description="Search locations")
        filter_agent = FilterAgent(name="Filter", description="Filter results")

        input_data = AgentInput(session_id="test", data={})

        # Execute agents concurrently
        results = await asyncio.gather(
            search_agent.execute(input_data),
            filter_agent.execute(input_data),
        )

        assert len(results) == 2
        assert results[0].success is True
        assert results[1].success is True
        assert results[0].data["results"] == ["Location 1", "Location 2"]
        assert results[1].data["filtered"] == ["Location 1"]

    @pytest.mark.asyncio
    async def test_agent_with_timeout(self):
        """Test agent execution with timeout."""

        class SlowAgent(AbstractBaseAgent):
            async def _execute_logic(self, input_data: AgentInput) -> Dict[str, Any]:
                await asyncio.sleep(10)  # Very slow operation
                return {"done": True}

            def _validate_input(self, input_data: AgentInput) -> bool:
                return True

        agent = SlowAgent(name="Slow", description="Slow agent")
        input_data = AgentInput(session_id="test", data={})

        # Execute with timeout
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(agent.execute(input_data), timeout=0.5)