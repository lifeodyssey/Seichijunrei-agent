"""AgentResult — output of the PydanticAI pilgrimage agent run.

Replaces PipelineResult as the contract between agents and interfaces.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from backend.agents.runtime_models import RuntimeStageOutput


@dataclass
class StepRecord:
    """One tool execution record."""

    tool: str
    success: bool
    params: dict[str, object] = field(default_factory=dict)
    data: dict[str, object] | None = None
    error: str | None = None


@dataclass
class AgentResult:
    """Output of pilgrimage agent run."""

    output: RuntimeStageOutput
    steps: list[StepRecord] = field(default_factory=list)
    tool_state: dict[str, object] = field(default_factory=dict)

    @property
    def intent(self) -> str:
        return str(self.output.intent)

    @property
    def success(self) -> bool:
        return all(s.success for s in self.steps) if self.steps else True

    @property
    def message(self) -> str:
        return str(self.output.message)
