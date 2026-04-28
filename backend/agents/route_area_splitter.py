"""LLM-based area splitting for route planning.

When pilgrimage spots span multiple geographic areas (e.g., Your Name has spots
in Shinjuku AND Hida-Furukawa 300km away), this module asks the LLM to group
spots into walkable areas based on its knowledge of Japanese geography.
"""

from __future__ import annotations

from pydantic import BaseModel, Field
from pydantic_ai import Agent
from pydantic_ai.models import Model

from backend.agents.base import resolve_model

_AREA_THRESHOLD = 10

_SPLIT_INSTRUCTIONS = """\
You are a Japan travel route planner. Given a list of anime pilgrimage spots
with coordinates, group them into walkable areas.

Rules:
- Each area should be walkable (spots within ~1-3km of each other)
- Name each area after the nearest major train station or landmark
- Every point index must appear in exactly one area (no duplicates, no orphans)
- If all points are in one walkable area, return a single area
- recommended_order should reflect a practical visit sequence
"""


class AreaGroup(BaseModel):
    """One walkable area grouping from the LLM."""

    name: str = Field(description="Area name, e.g. '新宿駅周辺'")
    station: str = Field(default="", description="Nearest major train station")
    point_indices: list[int] = Field(
        description="0-based indices into the input points list"
    )


class AreaSplitResult(BaseModel):
    """LLM output: how to split points into walkable areas."""

    areas: list[AreaGroup]
    recommended_order: list[int] = Field(
        default_factory=list,
        description="Visit order as 0-based indices into the areas list",
    )


def _build_prompt(points: list[dict[str, object]]) -> str:
    lines = []
    for i, p in enumerate(points):
        name = p.get("name", f"Point {i}")
        lat = p.get("latitude", 0)
        lng = p.get("longitude", 0)
        lat_f = float(lat) if isinstance(lat, int | float) else 0.0
        lng_f = float(lng) if isinstance(lng, int | float) else 0.0
        ep = p.get("episode", "?")
        lines.append(f"{i}: {name} ({lat_f:.4f}, {lng_f:.4f}) ep{ep}")
    header = (
        f"Split these {len(points)} anime pilgrimage spots into walkable areas:\n\n"
    )
    return header + "\n".join(lines)


def _fix_orphan_indices(split: AreaSplitResult, expected_count: int) -> AreaSplitResult:
    all_indices: set[int] = set()
    for area in split.areas:
        all_indices.update(area.point_indices)
    expected = set(range(expected_count))
    orphans = expected - all_indices
    if orphans and split.areas:
        split.areas[-1].point_indices.extend(sorted(orphans))
    return split


async def split_into_areas(
    points: list[dict[str, object]],
    model: Model | str | None = None,
) -> AreaSplitResult | None:
    """Ask LLM to split points into walkable areas.

    Returns None for small sets (<= 10) or on failure (caller falls back).
    """
    if len(points) <= _AREA_THRESHOLD:
        return None

    agent: Agent[None, AreaSplitResult] = Agent(
        resolve_model(model),
        output_type=AreaSplitResult,
        instructions=_SPLIT_INSTRUCTIONS,
        retries=1,
    )

    try:
        result = await agent.run(_build_prompt(points))
        return _fix_orphan_indices(result.output, len(points))
    except Exception:
        return None
