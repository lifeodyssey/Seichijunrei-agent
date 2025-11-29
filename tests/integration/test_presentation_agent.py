"""Integration tests for UserPresentationAgent.

These tests verify that the presentation agent is properly configured
and integrated into the workflow following ADK best practices.
"""

import pytest


pytestmark = pytest.mark.asyncio


async def test_user_presentation_agent_basic_structure():
    """Test that UserPresentationAgent can be instantiated and has correct config.

    This is a basic structural test to verify the agent is properly configured
    without output_schema, allowing natural language generation.
    """
    from adk_agents.seichijunrei_bot._agents.user_presentation_agent import (
        user_presentation_agent
    )

    # Verify agent exists and has correct name
    assert user_presentation_agent is not None
    assert user_presentation_agent.name == "UserPresentationAgent"

    # Verify agent uses correct model
    assert user_presentation_agent.model == "gemini-2.0-flash"

    # Verify agent has instruction
    assert user_presentation_agent.instruction is not None
    assert len(user_presentation_agent.instruction) > 100, \
           "Agent should have detailed instructions"

    # Verify instruction mentions key concepts
    instruction = user_presentation_agent.instruction
    assert "bangumi_candidates" in instruction, \
           "Instruction should reference bangumi_candidates state"
    assert "natural" in instruction.lower() or "friendly" in instruction.lower(), \
           "Instruction should emphasize natural, friendly output"


async def test_bangumi_search_workflow_includes_presentation_agent():
    """Test that BangumiSearchWorkflow includes UserPresentationAgent as third step."""
    from adk_agents.seichijunrei_bot._workflows.bangumi_search_workflow import (
        bangumi_search_workflow
    )

    # Verify workflow exists
    assert bangumi_search_workflow is not None
    assert bangumi_search_workflow.name == "BangumiSearchWorkflow"

    # Verify workflow has 3 sub-agents
    assert hasattr(bangumi_search_workflow, 'sub_agents')
    assert len(bangumi_search_workflow.sub_agents) == 3, \
           "Workflow should have 3 sub-agents: ExtractionAgent, BangumiCandidatesAgent, UserPresentationAgent"

    # Verify third agent is UserPresentationAgent
    third_agent = bangumi_search_workflow.sub_agents[2]
    assert third_agent.name == "UserPresentationAgent", \
           "Third agent should be UserPresentationAgent for presentation"


async def test_presentation_agent_no_output_schema():
    """Test that UserPresentationAgent doesn't have output_schema.

    This is critical for ADK best practices: presentation agents should
    generate free-form natural language, not structured JSON.
    """
    from adk_agents.seichijunrei_bot._agents.user_presentation_agent import (
        user_presentation_agent
    )
    from adk_agents.seichijunrei_bot._agents.bangumi_candidates_agent import (
        bangumi_candidates_agent
    )

    # Verify UserPresentationAgent has NO output_schema
    assert not hasattr(user_presentation_agent, 'output_schema') or \
           user_presentation_agent.output_schema is None, \
           "UserPresentationAgent should NOT have output_schema (must generate natural language)"

    # Verify it also has NO output_key (doesn't persist to state)
    assert not hasattr(user_presentation_agent, 'output_key') or \
           user_presentation_agent.output_key is None, \
           "UserPresentationAgent should NOT have output_key (output goes to user, not state)"

    # For contrast, verify BangumiCandidatesAgent DOES have output_schema
    # (following the ADK pattern of separating data processing from presentation)
    formatter = bangumi_candidates_agent.sub_agents[1]  # The formatter agent
    assert hasattr(formatter, 'output_schema') and formatter.output_schema is not None, \
           "BangumiCandidatesFormatter should have output_schema (structured data processing)"


async def test_workflow_integration():
    """Test that the complete workflow can be instantiated correctly."""
    from adk_agents.seichijunrei_bot._workflows.bangumi_search_workflow import (
        bangumi_search_workflow
    )

    # Verify workflow has description
    assert bangumi_search_workflow.description is not None
    assert "present" in bangumi_search_workflow.description.lower() or \
           "user-friendly" in bangumi_search_workflow.description.lower(), \
           "Workflow description should mention user presentation"

    # Verify all sub-agents are configured
    for i, agent in enumerate(bangumi_search_workflow.sub_agents):
        assert agent.name is not None, f"Agent {i} should have a name"

    print("\n✅ Workflow structure verified:")
    for i, agent in enumerate(bangumi_search_workflow.sub_agents):
        print(f"  {i+1}. {agent.name}")
