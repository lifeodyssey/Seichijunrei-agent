"""
Base agent architecture for Seichijunrei Bot.
Provides abstract base class and common functionality for all agents.
"""

from abc import ABC, abstractmethod
from enum import Enum
from typing import Optional, Dict, Any
from datetime import datetime
import asyncio

from pydantic import BaseModel, Field, ConfigDict

from utils.logger import get_logger


# === Pydantic Models for Agent I/O ===

class AgentInput(BaseModel):
    """Standard input format for all agents."""

    model_config = ConfigDict(extra="forbid")  # Strict validation

    session_id: str = Field(..., description="User session identifier")
    data: Dict[str, Any] = Field(default_factory=dict, description="Agent-specific input data")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional metadata")


class AgentOutput(BaseModel):
    """Standard output format for all agents."""

    model_config = ConfigDict(extra="forbid")  # Strict validation

    success: bool = Field(..., description="Whether execution was successful")
    data: Dict[str, Any] = Field(default_factory=dict, description="Agent-specific output data")
    error: Optional[str] = Field(None, description="Error message if execution failed")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional metadata")


# === Agent State Enum ===

class AgentState(str, Enum):
    """Agent execution states."""

    IDLE = "idle"
    INITIALIZING = "initializing"
    EXECUTING = "executing"
    COMPLETED = "completed"
    FAILED = "failed"


# === Agent Exceptions ===

class AgentError(Exception):
    """Base exception for agent errors."""
    pass


class AgentExecutionError(AgentError):
    """Raised when agent execution fails."""
    pass


class AgentValidationError(AgentError):
    """Raised when agent input validation fails."""
    pass


# === Abstract Base Agent ===

class AbstractBaseAgent(ABC):
    """
    Abstract base class for all agents in the system.

    Each agent must:
    1. Implement _execute_logic() for its specific functionality
    2. Implement _validate_input() for input validation
    3. Use structured logging for observability
    4. Return standardized AgentOutput
    """

    def __init__(self, name: str, description: str):
        """
        Initialize the agent.

        Args:
            name: Agent name for identification
            description: Human-readable description of agent purpose
        """
        self.name = name
        self.description = description
        self.state = AgentState.IDLE
        self.logger = get_logger(f"agent.{name}")
        self._start_time: Optional[datetime] = None

    async def execute(self, input_data: AgentInput) -> AgentOutput:
        """
        Execute the agent with given input.

        This method handles:
        - State management
        - Input validation
        - Error handling
        - Logging
        - Timing

        Args:
            input_data: Standardized agent input

        Returns:
            AgentOutput: Standardized agent output
        """
        self._start_time = datetime.now()
        self.state = AgentState.INITIALIZING

        try:
            # Log execution start
            self.logger.info(
                "Agent execution started",
                agent=self.name,
                session_id=input_data.session_id,
            )

            # Validate input
            if not self._validate_input(input_data):
                raise AgentValidationError(
                    f"Input validation failed for agent {self.name}"
                )

            # Update state and execute
            self.state = AgentState.EXECUTING
            result_data = await self._execute_logic(input_data)

            # Calculate execution time
            execution_time = (datetime.now() - self._start_time).total_seconds()

            # Update state and return success
            self.state = AgentState.COMPLETED
            self.logger.info(
                "Agent execution completed",
                agent=self.name,
                session_id=input_data.session_id,
                execution_time=execution_time,
            )

            return AgentOutput(
                success=True,
                data=result_data,
                metadata={
                    "agent": self.name,
                    "execution_time": execution_time,
                    "timestamp": datetime.now().isoformat(),
                },
            )

        except AgentValidationError as e:
            self.state = AgentState.FAILED
            self.logger.error(
                "Agent validation error",
                agent=self.name,
                session_id=input_data.session_id,
                error=str(e),
            )
            return AgentOutput(
                success=False,
                data={},
                error=str(e),
                metadata={"agent": self.name},
            )

        except Exception as e:
            self.state = AgentState.FAILED
            self.logger.error(
                "Agent execution error",
                agent=self.name,
                session_id=input_data.session_id,
                error=str(e),
                exc_info=True,
            )
            return AgentOutput(
                success=False,
                data={},
                error=str(e),
                metadata={"agent": self.name},
            )

    @abstractmethod
    async def _execute_logic(self, input_data: AgentInput) -> Dict[str, Any]:
        """
        Implement the agent's core logic.

        This method should:
        - Process the input data
        - Perform the agent's specific task
        - Return the result as a dictionary

        Args:
            input_data: Validated agent input

        Returns:
            Dict containing agent-specific results

        Raises:
            Any exception will be caught and handled by execute()
        """
        pass

    @abstractmethod
    def _validate_input(self, input_data: AgentInput) -> bool:
        """
        Validate input data for this specific agent.

        This method should check that the input contains
        all required fields and values for this agent.

        Args:
            input_data: Agent input to validate

        Returns:
            True if input is valid, False otherwise
        """
        pass

    async def cleanup(self):
        """
        Clean up agent resources and reset state.

        Override this method if your agent needs special cleanup.
        """
        self.state = AgentState.IDLE
        self._start_time = None
        self.logger.info("Agent cleanup completed", agent=self.name)

    def get_info(self) -> Dict[str, Any]:
        """
        Get agent information and current status.

        Returns:
            Dictionary with agent information
        """
        return {
            "name": self.name,
            "description": self.description,
            "state": self.state.value,
            "start_time": self._start_time.isoformat() if self._start_time else None,
        }

    def __repr__(self) -> str:
        """String representation of the agent."""
        return f"{self.__class__.__name__}(name='{self.name}', state={self.state.value})"