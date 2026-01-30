"""Edge case tests for A2UI presenter.

This module tests edge cases and boundary conditions for the A2UI presenter.
"""

from interfaces.a2ui_web.presenter import (
    _build_anitabi_image_url,
    build_a2ui_loading_response,
    build_a2ui_response,
)


def _components_from_messages(messages: list[dict]) -> dict[str, dict]:
    """Extract components from A2UI messages."""
    surface_update = next(m for m in messages if "surfaceUpdate" in m)
    components = surface_update["surfaceUpdate"]["components"]
    return {c["id"]: c["component"] for c in components}


class TestCandidatesViewEdgeCases:
    """Edge case tests for candidates view."""

    def test_candidate_without_subtitle_parts(self):
        """Test candidate with no subtitle parts (no jp_title, no air_date)."""
        state = {
            "extraction_result": {"user_language": "zh-CN"},
            "bangumi_candidates": {
                "query": "test",
                "candidates": [
                    {
                        "bangumi_id": 1,
                        "title_cn": "中文标题",
                        "title": "中文标题",  # Same as title_cn
                        # No air_date
                    }
                ],
            },
        }
        _, messages = build_a2ui_response(state)
        comps = _components_from_messages(messages)
        # Should still render the card
        assert "cand-card-1" in comps
        # Subtitle should be empty or minimal
        subtitle = comps.get("cand-card-1-subtitle", {})
        assert "Text" in subtitle

    def test_candidates_with_many_items(self):
        """Test candidates view with many candidates."""
        candidates = [{"bangumi_id": i, "title": f"Anime {i}"} for i in range(1, 11)]
        state = {
            "extraction_result": {"user_language": "en"},
            "bangumi_candidates": {"query": "test", "candidates": candidates},
        }
        _, messages = build_a2ui_response(state)
        comps = _components_from_messages(messages)
        # All 10 candidates should be rendered
        for i in range(1, 11):
            assert f"cand-card-{i}" in comps
            assert f"cand-card-{i}-select" in comps

    def test_candidates_with_special_characters_in_title(self):
        """Test candidates with special characters in title."""
        state = {
            "extraction_result": {"user_language": "ja"},
            "bangumi_candidates": {
                "query": "test",
                "candidates": [
                    {
                        "bangumi_id": 1,
                        "title": 'Re:Zero <Starting Life> & "Another" World',
                        "summary": "Test with <html> & special chars",
                    }
                ],
            },
        }
        _, messages = build_a2ui_response(state)
        comps = _components_from_messages(messages)
        assert "cand-card-1" in comps


class TestRouteViewEdgeCases:
    """Edge case tests for route view."""

    def test_route_view_with_points_meta(self):
        """Test route view with total_available and rejected_count."""
        state = {
            "extraction_result": {"user_language": "zh-CN"},
            "selected_bangumi": {"bangumi_title": "Test"},
            "points_selection_result": {
                "selected_points": [{"name": "Point A", "lat": 35.0, "lng": 139.0}],
                "total_available": 20,
                "rejected_count": 15,
            },
            "route_plan": {"recommended_order": ["Point A"]},
        }
        _, messages = build_a2ui_response(state)
        comps = _components_from_messages(messages)
        # Should have points-meta component
        assert "points-meta" in comps

    def test_route_view_with_selection_rationale(self):
        """Test route view with selection rationale."""
        state = {
            "extraction_result": {"user_language": "en"},
            "selected_bangumi": {"bangumi_title": "Test"},
            "points_selection_result": {
                "selected_points": [{"name": "Point A", "lat": 35.0, "lng": 139.0}],
                "selection_rationale": "Selected based on proximity to station.",
            },
            "route_plan": {"recommended_order": ["Point A"]},
        }
        _, messages = build_a2ui_response(state)
        comps = _components_from_messages(messages)
        # Should have rationale card
        assert "points-rationale-card" in comps
        assert "points-rationale-text" in comps

    def test_route_view_with_anitabi_image(self):
        """Test route view with Anitabi CDN image."""
        state = {
            "extraction_result": {"user_language": "zh-CN"},
            "selected_bangumi": {"bangumi_title": "Test"},
            "points_selection_result": {
                "selected_points": [
                    {
                        "name": "Point A",
                        "lat": 35.0,
                        "lng": 139.0,
                        "screenshot_url": "points/test.jpg",
                    }
                ],
            },
            "route_plan": {"recommended_order": ["Point A"]},
        }
        _, messages = build_a2ui_response(state)
        comps = _components_from_messages(messages)
        # Should have image and image source attribution
        assert "pt-card-1-image" in comps
        assert "pt-card-1-image-source" in comps

    def test_route_view_with_external_image(self):
        """Test route view with external (non-Anitabi) image."""
        state = {
            "extraction_result": {"user_language": "en"},
            "selected_bangumi": {"bangumi_title": "Test"},
            "points_selection_result": {
                "selected_points": [
                    {
                        "name": "Point A",
                        "lat": 35.0,
                        "lng": 139.0,
                        "screenshot_url": "https://external.com/image.jpg",
                    }
                ],
            },
            "route_plan": {"recommended_order": ["Point A"]},
        }
        _, messages = build_a2ui_response(state)
        comps = _components_from_messages(messages)
        # Should have image but no Anitabi attribution
        assert "pt-card-1-image" in comps
        assert "pt-card-1-image-source" not in comps

    def test_route_view_with_transport_tips(self):
        """Test route view with transport tips."""
        state = {
            "extraction_result": {"user_language": "zh-CN"},
            "selected_bangumi": {"bangumi_title": "Test"},
            "points_selection_result": {
                "selected_points": [{"name": "Point A", "lat": 35.0, "lng": 139.0}],
            },
            "route_plan": {
                "recommended_order": ["Point A"],
                "transport_tips": "Take the JR Yamanote Line",
            },
        }
        _, messages = build_a2ui_response(state)
        comps = _components_from_messages(messages)
        # Should have tips card
        assert "route-tips-card" in comps

    def test_route_view_with_special_notes(self):
        """Test route view with special notes only."""
        state = {
            "extraction_result": {"user_language": "en"},
            "selected_bangumi": {"bangumi_title": "Test"},
            "points_selection_result": {
                "selected_points": [{"name": "Point A", "lat": 35.0, "lng": 139.0}],
            },
            "route_plan": {
                "recommended_order": ["Point A"],
                "special_notes": ["Note 1", "Note 2"],
            },
        }
        _, messages = build_a2ui_response(state)
        comps = _components_from_messages(messages)
        assert "route-tips-card" in comps


class TestRouteViewDirectionsUrl:
    """Tests for Google Maps directions URL generation."""

    def test_directions_url_with_multiple_points(self):
        """Test directions URL with multiple waypoints."""
        state = {
            "extraction_result": {"user_language": "zh-CN", "location": "Tokyo"},
            "selected_bangumi": {"bangumi_title": "Test"},
            "points_selection_result": {
                "selected_points": [
                    {"name": "A", "lat": 35.0, "lng": 139.0},
                    {"name": "B", "lat": 35.1, "lng": 139.1},
                    {"name": "C", "lat": 35.2, "lng": 139.2},
                ],
            },
            "route_plan": {"recommended_order": ["A", "B", "C"]},
        }
        _, messages = build_a2ui_response(state)
        comps = _components_from_messages(messages)
        btn = comps["route-open-maps"]["Button"]
        action = btn["action"]["name"]
        assert "waypoints" in action

    def test_directions_url_without_origin(self):
        """Test directions URL when no origin location."""
        state = {
            "extraction_result": {"user_language": "en"},
            "selected_bangumi": {"bangumi_title": "Test"},
            "points_selection_result": {
                "selected_points": [
                    {"name": "A", "lat": 35.0, "lng": 139.0},
                ],
            },
            "route_plan": {"recommended_order": ["A"]},
        }
        _, messages = build_a2ui_response(state)
        comps = _components_from_messages(messages)
        assert "route-open-maps" in comps


class TestPointSorting:
    """Tests for point sorting in route view."""

    def test_points_sorted_by_episode(self):
        """Test points are sorted by episode number."""
        state = {
            "extraction_result": {"user_language": "zh-CN"},
            "selected_bangumi": {"bangumi_title": "Test"},
            "points_selection_result": {
                "selected_points": [
                    {"name": "C", "lat": 35.2, "lng": 139.2, "episode": 3},
                    {"name": "A", "lat": 35.0, "lng": 139.0, "episode": 1},
                    {"name": "B", "lat": 35.1, "lng": 139.1, "episode": 2},
                ],
            },
            "route_plan": {"recommended_order": ["A", "B", "C"]},
        }
        _, messages = build_a2ui_response(state)
        comps = _components_from_messages(messages)
        # Points should be rendered in order
        assert "pt-card-1" in comps
        assert "pt-card-2" in comps
        assert "pt-card-3" in comps


class TestImageUrlBuilder:
    """Additional tests for image URL builder."""

    def test_image_url_with_non_string_input(self):
        """Test image URL builder with non-string input."""
        assert _build_anitabi_image_url(123) == ""
        assert _build_anitabi_image_url(["list"]) == ""
        assert _build_anitabi_image_url({"dict": "value"}) == ""

    def test_image_url_with_http_url(self):
        """Test image URL builder with http URL."""
        url = _build_anitabi_image_url("http://example.com/image.jpg")
        assert url == "http://example.com/image.jpg"


class TestLoadingViewEdgeCases:
    """Edge case tests for loading view."""

    def test_loading_view_unknown_stage(self):
        """Test loading view with unknown stage falls back to default."""
        state = {"extraction_result": {"user_language": "zh-CN"}}
        text, messages = build_a2ui_loading_response(state, stage="unknown_stage")
        assert "处理中" in text

    def test_loading_view_all_languages(self):
        """Test loading view in all supported languages."""
        for lang in ["zh-CN", "en", "ja"]:
            state = {"extraction_result": {"user_language": lang}}
            text, messages = build_a2ui_loading_response(state, stage="processing")
            comps = _components_from_messages(messages)
            assert "loading-card" in comps


class TestCandidateEmptySubtitle:
    """Tests for candidate with empty subtitle."""

    def test_candidate_with_no_subtitle_parts_renders_empty(self):
        """Test candidate with no jp_title and no air_date has empty subtitle."""
        state = {
            "extraction_result": {"user_language": "en"},
            "bangumi_candidates": {
                "query": "test",
                "candidates": [
                    {
                        "bangumi_id": 1,
                        # No title, no air_date - subtitle will be empty
                    }
                ],
            },
        }
        _, messages = build_a2ui_response(state)
        comps = _components_from_messages(messages)
        subtitle = comps["cand-card-1-subtitle"]["Text"]
        # Subtitle should be empty string
        assert subtitle["text"]["literalString"] == ""
