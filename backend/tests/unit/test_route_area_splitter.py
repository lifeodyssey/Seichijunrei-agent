"""Unit tests for backend.agents.route_area_splitter."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

from backend.agents.route_area_splitter import (
    AreaGroup,
    AreaSplitResult,
    split_into_areas,
)


def _make_point(index: int, lat: float = 35.0, lng: float = 139.0) -> dict[str, object]:
    return {
        "name": f"Spot {index}",
        "latitude": lat + index * 0.01,
        "longitude": lng + index * 0.01,
        "episode": str(index),
    }


def _make_points(count: int) -> list[dict[str, object]]:
    return [_make_point(i) for i in range(count)]


class TestSplitIntoAreasSmallSets:
    async def test_returns_none_for_five_points(self) -> None:
        result = await split_into_areas(_make_points(5))
        assert result is None

    async def test_returns_none_for_ten_points(self) -> None:
        result = await split_into_areas(_make_points(10))
        assert result is None

    async def test_returns_none_for_empty_list(self) -> None:
        result = await split_into_areas([])
        assert result is None


class TestSplitIntoAreasLargeSets:
    async def test_returns_result_for_fifteen_points(self) -> None:
        mock_output = AreaSplitResult(
            areas=[
                AreaGroup(
                    name="Area A",
                    station="Station A",
                    point_indices=[0, 1, 2, 3, 4, 5, 6],
                ),
                AreaGroup(
                    name="Area B",
                    station="Station B",
                    point_indices=[7, 8, 9, 10, 11, 12, 13, 14],
                ),
            ],
            recommended_order=[0, 1],
        )
        mock_run_result = MagicMock()
        mock_run_result.output = mock_output

        mock_agent_instance = MagicMock()
        mock_agent_instance.run = AsyncMock(return_value=mock_run_result)

        with patch(
            "backend.agents.route_area_splitter.Agent", return_value=mock_agent_instance
        ):
            result = await split_into_areas(_make_points(15))

        assert result is not None
        assert len(result.areas) == 2
        all_indices = set()
        for area in result.areas:
            all_indices.update(area.point_indices)
        assert all_indices == set(range(15))


class TestSplitIntoAreasHandlesFailure:
    async def test_returns_none_on_agent_exception(self) -> None:
        mock_agent_instance = MagicMock()
        mock_agent_instance.run = AsyncMock(side_effect=RuntimeError("LLM timeout"))

        with patch(
            "backend.agents.route_area_splitter.Agent", return_value=mock_agent_instance
        ):
            result = await split_into_areas(_make_points(15))

        assert result is None


class TestSplitIntoAreasFixesOrphans:
    async def test_assigns_missing_indices_to_last_area(self) -> None:
        mock_output = AreaSplitResult(
            areas=[
                AreaGroup(
                    name="Area A", station="Station A", point_indices=[0, 1, 2, 3, 4]
                ),
                AreaGroup(
                    name="Area B", station="Station B", point_indices=[5, 6, 7, 8, 9]
                ),
            ],
            recommended_order=[0, 1],
        )
        mock_run_result = MagicMock()
        mock_run_result.output = mock_output

        mock_agent_instance = MagicMock()
        mock_agent_instance.run = AsyncMock(return_value=mock_run_result)

        with patch(
            "backend.agents.route_area_splitter.Agent", return_value=mock_agent_instance
        ):
            result = await split_into_areas(_make_points(12))

        assert result is not None
        all_indices = set()
        for area in result.areas:
            all_indices.update(area.point_indices)
        assert all_indices == set(range(12)), (
            f"Missing indices: {set(range(12)) - all_indices}"
        )
