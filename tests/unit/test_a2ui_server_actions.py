from interfaces.a2ui_web.state_mutations import remove_selected_point_by_index


def test_remove_selected_point_by_index_updates_state_and_route_plan():
    state = {
        "extraction_result": {"location": "Tokyo", "user_language": "en"},
        "selected_bangumi": {"bangumi_title": "JP"},
        "all_points": [
            {"name": "A", "episode": 1, "time_seconds": 0},
            {"name": "B", "episode": 2, "time_seconds": 0},
        ],
        "points_selection_result": {
            "selected_points": [
                {"name": "A", "episode": 1, "time_seconds": 0},
                {"name": "B", "episode": 2, "time_seconds": 0},
            ],
            "selection_rationale": "initial",
            "estimated_coverage": "episodes 1-2",
            "total_available": 2,
            "rejected_count": 0,
        },
    }

    ok = remove_selected_point_by_index(state, index_0=0)
    assert ok is True

    points_selection = state["points_selection_result"]
    assert len(points_selection["selected_points"]) == 1
    assert points_selection["rejected_count"] == 1
    assert "User manually adjusted" in points_selection["selection_rationale"]

    assert "route_plan" in state
    assert len(state["route_plan"]["recommended_order"]) == 1


def test_remove_selected_point_by_index_invalid_index_returns_false():
    state = {
        "points_selection_result": {"selected_points": [{"name": "A"}]},
        "extraction_result": {"location": "Tokyo"},
        "selected_bangumi": {"bangumi_title": "JP"},
    }
    assert remove_selected_point_by_index(state, index_0=10) is False
