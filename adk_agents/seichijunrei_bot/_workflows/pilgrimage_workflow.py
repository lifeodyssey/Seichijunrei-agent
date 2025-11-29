"""Sequential/Parallel ADK workflow for Seichijunrei pilgrimage planning.

This module wires together the LlmAgents and BaseAgents defined under
`adk_agents.seichijunrei_bot.agents` into a deterministic workflow using
SequentialAgent and ParallelAgent, as described in
`docs/adk_sequential_agent_migration_plan.md` (Stage 4).

At this stage, the workflow is defined but not yet used by the root agent.
"""

from google.adk.agents import ParallelAgent, SequentialAgent

from adk_agents.seichijunrei_bot._agents.bangumi_search_agent import bangumi_search_agent
from adk_agents.seichijunrei_bot._agents.extraction_agent import extraction_agent
from adk_agents.seichijunrei_bot._agents.input_normalization_agent import input_normalization_agent
from adk_agents.seichijunrei_bot._agents.location_search_agent import location_search_agent
from adk_agents.seichijunrei_bot._agents.points_search_agent import points_search_agent
from adk_agents.seichijunrei_bot._agents.route_agent import route_optimization_agent
from adk_agents.seichijunrei_bot._agents.transport_agent import transport_agent
from adk_agents.seichijunrei_bot._agents.weather_agent import weather_agent


# Step 2: parallel search for bangumi + location
parallel_search = ParallelAgent(
    name="ParallelSearch",
    sub_agents=[
        bangumi_search_agent,
        location_search_agent,
    ],
)


# Step 4: parallel enrichment (weather + route optimization)
parallel_enrichment = ParallelAgent(
    name="ParallelEnrichment",
    sub_agents=[
        weather_agent,
        route_optimization_agent,
    ],
)


# Main Sequential workflow
pilgrimage_workflow = SequentialAgent(
    # This name becomes the ADK tool name via AgentTool; keep it
    # aligned with root_agent.instructions as the canonical entry point.
    name="plan_pilgrimage_workflow",
    description="完整的圣地巡礼规划工作流（规范化 → 提取 → 搜索 → 点位 → 增强 → 交通优化）",
    sub_agents=[
        input_normalization_agent,  # Step 0: normalize input parameters to user_query
        extraction_agent,           # Step 1: extract bangumi + location
        parallel_search,            # Step 2: resolve bangumi + location in parallel
        points_search_agent,        # Step 3: fetch pilgrimage points
        parallel_enrichment,        # Step 4: fetch weather + optimize route
        transport_agent,            # Step 5: optimize transport & finalize plan
    ],
)
