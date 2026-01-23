from interfaces.a2ui_web.presenter import build_a2ui_error_response, build_a2ui_response


def _components_from_messages(messages: list[dict]) -> dict[str, dict]:
    surface_update = next(m for m in messages if "surfaceUpdate" in m)
    components = surface_update["surfaceUpdate"]["components"]
    return {c["id"]: c["component"] for c in components}


def test_welcome_view_has_examples_and_begin_rendering():
    assistant_text, messages = build_a2ui_response({})
    assert "请输入" in assistant_text

    assert messages[-1]["beginRendering"]["root"] == "root"
    comps = _components_from_messages(messages)

    # Example buttons should be present and clickable.
    for idx in (1, 2, 3):
        btn = comps[f"example-btn-{idx}"]["Button"]
        assert btn["action"]["name"].startswith("send_text:")
        assert btn["child"] == f"example-btn-{idx}-text"


def test_candidates_view_renders_select_buttons():
    state = {
        "extraction_result": {"user_language": "zh-CN"},
        "bangumi_candidates": {
            "query": "test",
            "total": 2,
            "candidates": [
                {
                    "bangumi_id": 1,
                    "title": "JP1",
                    "title_cn": "CN1",
                    "air_date": "2015-04",
                    "summary": "S1",
                },
                {
                    "bangumi_id": 2,
                    "title": "JP2",
                    "title_cn": None,
                    "air_date": None,
                    "summary": "S2",
                },
            ],
        },
    }
    assistant_text, messages = build_a2ui_response(state)
    assert "请选择" in assistant_text

    comps = _components_from_messages(messages)
    btn1 = comps["cand-card-1-select"]["Button"]
    btn2 = comps["cand-card-2-select"]["Button"]
    assert btn1["action"]["name"] == "select_candidate_1"
    assert btn2["action"]["name"] == "select_candidate_2"


def test_route_view_renders_steps_points_and_controls():
    state = {
        "extraction_result": {"user_language": "zh-CN"},
        "selected_bangumi": {"bangumi_title": "JP", "bangumi_title_cn": "CN"},
        "points_selection_result": {
            "selected_points": [
                {
                    "id": "p1",
                    "name": "P1",
                    "cn_name": "点1",
                    "lat": 35.0,
                    "lng": 139.0,
                    "episode": 1,
                    "address": "addr",
                    "screenshot_url": "https://example.com/1.jpg",
                }
            ]
        },
        "route_plan": {
            "recommended_order": ["点1", "点2"],
            "estimated_duration": "4-5h",
            "estimated_distance": "6km",
            "route_description": "line1\nline2",
            "transport_tips": "walk",
            "special_notes": ["note"],
        },
    }
    assistant_text, messages = build_a2ui_response(state)
    assert "路线" in assistant_text

    comps = _components_from_messages(messages)
    assert "Text" in comps["route-step-1"]
    assert "Text" in comps["route-step-2"]

    back_btn = comps["route-back"]["Button"]
    reset_btn = comps["route-reset"]["Button"]
    assert back_btn["action"]["name"] == "back"
    assert reset_btn["action"]["name"] == "reset"

    remove_btn = comps["pt-card-1-remove"]["Button"]
    assert remove_btn["action"]["name"] == "remove_point_1"

    map_btn = comps["pt-card-1-map"]["Button"]
    assert map_btn["action"]["name"].startswith("open_url:https://www.google.com/maps/")

    open_maps_btn = comps["route-open-maps"]["Button"]
    assert open_maps_btn["action"]["name"].startswith(
        "open_url:https://www.google.com/maps/dir/?api=1"
    )

    assert "Text" in comps["route-desc-text"]


def test_error_view_has_reset_button():
    assistant_text, messages = build_a2ui_error_response(
        {"extraction_result": {"user_language": "en"}}, error_message="boom"
    )
    assert "Error:" in assistant_text

    comps = _components_from_messages(messages)
    reset_btn = comps["error-reset"]["Button"]
    assert reset_btn["action"]["name"] == "reset"


# --- Edge Case Tests ---


def test_welcome_view_with_different_languages():
    """Test welcome view renders correctly in different languages."""
    # English
    state_en = {"extraction_result": {"user_language": "en"}}
    text_en, _ = build_a2ui_response(state_en)
    assert "anime" in text_en.lower() or "title" in text_en.lower()

    # Japanese
    state_ja = {"extraction_result": {"user_language": "ja"}}
    text_ja, _ = build_a2ui_response(state_ja)
    assert "アニメ" in text_ja or "タイトル" in text_ja or "入力" in text_ja


def test_candidates_view_with_empty_candidates():
    """Test candidates view with empty candidates list shows empty state."""
    state = {
        "extraction_result": {"user_language": "zh-CN"},
        "bangumi_candidates": {"query": "test", "candidates": []},
    }
    # Empty candidates renders candidates view with empty list
    assistant_text, messages = build_a2ui_response(state)
    comps = _components_from_messages(messages)
    # Should have header and reset button
    assert "cand-header" in comps
    assert "cand-reset" in comps
    # The list should be empty
    cand_list = comps.get("cand-list", {})
    children = cand_list.get("Column", {}).get("children", {}).get("explicitList", [])
    assert len(children) == 0


def test_candidates_view_with_missing_optional_fields():
    """Test candidates view handles missing optional fields gracefully."""
    state = {
        "extraction_result": {"user_language": "zh-CN"},
        "bangumi_candidates": {
            "query": "minimal",
            "candidates": [
                {"id": 1, "title": "Only Title"},  # No title_cn, air_date, summary
            ],
        },
    }
    assistant_text, messages = build_a2ui_response(state)
    comps = _components_from_messages(messages)
    # Should still render the card
    assert "cand-card-1" in comps
    assert "cand-card-1-select" in comps


def test_route_view_with_no_points():
    """Test route view handles empty points list."""
    state = {
        "extraction_result": {"user_language": "zh-CN"},
        "selected_bangumi": {"bangumi_title": "Test Anime"},
        "points_selection_result": {"selected_points": []},
        "route_plan": {"recommended_order": []},
    }
    assistant_text, messages = build_a2ui_response(state)
    comps = _components_from_messages(messages)
    # Should show empty points message
    assert "points-empty" in comps


def test_route_view_without_route_plan_falls_back():
    """Test that without route_plan, it falls back to candidates or welcome."""
    state = {
        "extraction_result": {"user_language": "zh-CN"},
        "selected_bangumi": {"bangumi_title": "Test"},
        "points_selection_result": {
            "selected_points": [{"name": "Point A", "lat": 35.0, "lng": 139.0}]
        },
        # No route_plan - should fall back
    }
    # Without route_plan, falls back to welcome view (no bangumi_candidates)
    assistant_text, messages = build_a2ui_response(state)
    comps = _components_from_messages(messages)
    # Should be welcome view
    assert "welcome-header" in comps


def test_route_view_point_without_coordinates():
    """Test route view handles points without lat/lng."""
    state = {
        "extraction_result": {"user_language": "zh-CN"},
        "selected_bangumi": {"bangumi_title": "Test"},
        "points_selection_result": {
            "selected_points": [
                {"name": "No Coords Point"},  # No lat/lng
            ]
        },
        "route_plan": {"recommended_order": ["No Coords Point"]},  # Must have route_plan to trigger route view
    }
    assistant_text, messages = build_a2ui_response(state)
    comps = _components_from_messages(messages)
    # Should not have map button for point without coords
    assert "pt-card-1-map" not in comps
    # But remove button should still exist
    assert "pt-card-1-remove" in comps


def test_error_view_with_empty_state():
    """Test error view works with completely empty state."""
    assistant_text, messages = build_a2ui_error_response({}, error_message="Test error")
    comps = _components_from_messages(messages)
    assert "error-reset" in comps


def test_error_view_with_different_languages():
    """Test error view renders in different languages."""
    # Japanese error
    state_ja = {"extraction_result": {"user_language": "ja"}}
    text_ja, _ = build_a2ui_error_response(state_ja, error_message="boom")
    assert "エラー" in text_ja

    # Chinese error
    state_zh = {"extraction_result": {"user_language": "zh-CN"}}
    text_zh, _ = build_a2ui_error_response(state_zh, error_message="boom")
    assert "出错" in text_zh


def test_message_structure_is_valid():
    """Test that all messages have valid A2UI structure."""
    state = {
        "extraction_result": {"user_language": "zh-CN"},
        "bangumi_candidates": {
            "candidates": [{"id": 1, "title": "Test"}]
        },
    }
    _, messages = build_a2ui_response(state)

    # Check surfaceUpdate message
    surface_updates = [m for m in messages if "surfaceUpdate" in m]
    assert len(surface_updates) >= 1
    for su in surface_updates:
        assert "surfaceId" in su["surfaceUpdate"]
        assert "components" in su["surfaceUpdate"]
        for comp in su["surfaceUpdate"]["components"]:
            assert "id" in comp
            assert "component" in comp

    # Check beginRendering message
    begin_msgs = [m for m in messages if "beginRendering" in m]
    assert len(begin_msgs) >= 1
    for br in begin_msgs:
        assert "surfaceId" in br["beginRendering"]
        assert "root" in br["beginRendering"]
