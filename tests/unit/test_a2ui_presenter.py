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
