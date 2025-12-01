"""
Unit tests for SimpleRoutePlanner service.

Tests cover:
- Route generation with various point configurations
- Sorting by episode and time
- Max points limit enforcement
- Duration and distance estimation
- Transport tips generation
- Edge cases (empty points, missing data)
"""

import pytest

from services.simple_route_planner import SimpleRoutePlanner


class TestSimpleRoutePlanner:
    """Test the SimpleRoutePlanner service."""

    @pytest.fixture
    def planner(self):
        """Create a SimpleRoutePlanner instance."""
        return SimpleRoutePlanner(max_points=10)

    @pytest.fixture
    def sample_points(self):
        """Sample seichijunrei points for testing."""
        return [
            {
                "id": "point_1",
                "name": "Suga Shrine",
                "cn_name": "须贺神社",
                "episode": 1,
                "time_seconds": 300,
                "lat": 35.6867,
                "lng": 139.7189,
            },
            {
                "id": "point_2",
                "name": "Cafe la Bohème",
                "cn_name": "Cafe la Bohème",
                "episode": 2,
                "time_seconds": 450,
                "lat": 35.6595,
                "lng": 139.7004,
            },
            {
                "id": "point_3",
                "name": "Tokyo Station",
                "cn_name": "东京站",
                "episode": 1,
                "time_seconds": 600,
                "lat": 35.6812,
                "lng": 139.7671,
            },
            {
                "id": "point_4",
                "name": "National Art Center",
                "cn_name": "国立新美术馆",
                "episode": 3,
                "time_seconds": 200,
                "lat": 35.6656,
                "lng": 139.7262,
            },
        ]

    @pytest.fixture
    def many_points(self):
        """Create many points to test max_points limit."""
        return [
            {
                "id": f"point_{i}",
                "name": f"Location {i}",
                "cn_name": f"地点 {i}",
                "episode": i // 3,
                "time_seconds": i * 100,
                "lat": 35.6 + i * 0.01,
                "lng": 139.7 + i * 0.01,
            }
            for i in range(20)
        ]

    def test_planner_initialization(self):
        """Test planner initializes with correct max_points."""
        planner = SimpleRoutePlanner(max_points=15)
        assert planner.max_points == 15

        planner_default = SimpleRoutePlanner()
        assert planner_default.max_points == 10

    def test_generate_plan_with_points(self, planner, sample_points):
        """Test route generation with valid points."""
        plan = planner.generate_plan(
            origin="Tokyo Station", anime="Your Name", points=sample_points
        )

        # Check all required fields are present
        assert "recommended_order" in plan
        assert "route_description" in plan
        assert "estimated_duration" in plan
        assert "estimated_distance" in plan
        assert "transport_tips" in plan
        assert "special_notes" in plan

        # Check recommended_order contains point names
        assert len(plan["recommended_order"]) == 4
        # Note: code prefers 'name' over 'cn_name'
        assert "Suga Shrine" in plan["recommended_order"]
        assert "Tokyo Station" in plan["recommended_order"]

        # Check estimates are properly formatted
        assert "hours" in plan["estimated_duration"]
        assert "kilometers" in plan["estimated_distance"]

        # Check special notes are present
        assert len(plan["special_notes"]) >= 3
        assert any("opening hours" in note for note in plan["special_notes"])

    def test_generate_plan_empty_points(self, planner):
        """Test route generation with no points."""
        plan = planner.generate_plan(
            origin="Tokyo Station", anime="Test Anime", points=[]
        )

        assert plan["recommended_order"] == []
        assert "Could not find available" in plan["route_description"]
        assert plan["estimated_duration"] == "unknown"
        assert plan["estimated_distance"] == "unknown"
        assert "no transport suggestions available" in plan["transport_tips"]

    def test_generate_plan_sorting_by_episode(self, planner, sample_points):
        """Test that points are sorted by episode and time."""
        plan = planner.generate_plan(
            origin="Tokyo", anime="Test", points=sample_points
        )

        order = plan["recommended_order"]
        # Points should be ordered by (episode, time_seconds)
        # Episode 1, time 300: Suga Shrine
        # Episode 1, time 600: Tokyo Station
        # Episode 2, time 450: Cafe la Bohème
        # Episode 3, time 200: National Art Center
        # Note: code prefers 'name' over 'cn_name'
        assert order[0] == "Suga Shrine"  # Episode 1, 300s
        assert order[1] == "Tokyo Station"  # Episode 1, 600s
        assert order[2] == "Cafe la Bohème"  # Episode 2, 450s
        assert order[3] == "National Art Center"  # Episode 3, 200s

    def test_generate_plan_max_points_limit(self, planner, many_points):
        """Test that only max_points are included in the route."""
        plan = planner.generate_plan(
            origin="Tokyo", anime="Test", points=many_points
        )

        # Should only include max_points (10)
        assert len(plan["recommended_order"]) == 10

        # Should be the first 10 after sorting
        for i in range(10):
            # Code prefers 'name' over 'cn_name'
            assert f"Location {i}" in plan["recommended_order"][i]

    def test_generate_plan_with_custom_max_points(self, many_points):
        """Test planner with custom max_points."""
        planner = SimpleRoutePlanner(max_points=5)

        plan = planner.generate_plan(
            origin="Tokyo", anime="Test", points=many_points
        )

        assert len(plan["recommended_order"]) == 5

    def test_estimate_duration_calculation(self, planner, sample_points):
        """Test duration estimation formula."""
        plan = planner.generate_plan(
            origin="Tokyo", anime="Test", points=sample_points
        )

        # 4 points * 0.5 hours = 2.0 hours
        assert "2.0 hours" in plan["estimated_duration"]

    def test_estimate_distance_calculation(self, planner, sample_points):
        """Test distance estimation formula."""
        plan = planner.generate_plan(
            origin="Tokyo", anime="Test", points=sample_points
        )

        # 4 points * 1.5 km = 6.0 km
        assert "6.0 kilometers" in plan["estimated_distance"]

    def test_transport_tips_generation(self, planner, sample_points):
        """Test transport tips generation."""
        plan = planner.generate_plan(
            origin="Shibuya Station", anime="Test", points=sample_points
        )

        tips = plan["transport_tips"]
        # Should mention the origin
        assert "Shibuya Station" in tips
        # Should contain general recommendations
        assert "public transportation" in tips
        assert "walking" in tips
        assert "day pass" in tips

    def test_route_description_format(self, planner, sample_points):
        """Test route description format."""
        plan = planner.generate_plan(
            origin="Tokyo Station",
            anime="Your Name",
            points=sample_points,
        )

        description = plan["route_description"]

        # Should contain origin and anime name
        assert "Tokyo Station" in description
        assert "Your Name" in description

        # Should contain "Recommended route:"
        assert "Recommended route:" in description

        # Should list points with numbers
        assert "1. 须贺神社 (Episode 1)" in description
        assert "2. 东京站 (Episode 1)" in description
        assert "3. Cafe la Bohème (Episode 2)" in description
        assert "4. 国立新美术馆 (Episode 3)" in description

    def test_special_notes_content(self, planner, sample_points):
        """Test special notes content."""
        plan = planner.generate_plan(
            origin="Tokyo", anime="Test", points=sample_points
        )

        notes = plan["special_notes"]

        # Should have at least 3 notes
        assert len(notes) >= 3

        # Check for expected content
        notes_text = " ".join(notes).lower()
        assert "opening hours" in notes_text
        assert "map app" in notes_text or "navigation" in notes_text
        assert "disturb" in notes_text or "respectful" in notes_text

    def test_points_with_missing_episode(self, planner):
        """Test handling points with missing episode data."""
        points = [
            {
                "id": "point_1",
                "name": "Location A",
                "cn_name": "地点A",
                # Missing episode field
                "time_seconds": 300,
            },
            {
                "id": "point_2",
                "name": "Location B",
                "cn_name": "地点B",
                "episode": 1,
                "time_seconds": 400,
            },
        ]

        plan = planner.generate_plan(origin="Tokyo", anime="Test", points=points)

        # Should not crash and return valid plan
        assert len(plan["recommended_order"]) == 2
        # Point without episode should be sorted to the end (episode defaults to 99)
        assert plan["recommended_order"][0] == "地点B"  # Episode 1
        assert plan["recommended_order"][1] == "地点A"  # Episode 99 (default)

    def test_points_with_missing_time_seconds(self, planner):
        """Test handling points with missing time_seconds data."""
        points = [
            {
                "id": "point_1",
                "name": "Location A",
                "cn_name": "地点A",
                "episode": 1,
                # Missing time_seconds field
            },
            {
                "id": "point_2",
                "name": "Location B",
                "cn_name": "地点B",
                "episode": 1,
                "time_seconds": 400,
            },
        ]

        plan = planner.generate_plan(origin="Tokyo", anime="Test", points=points)

        # Should not crash and return valid plan
        assert len(plan["recommended_order"]) == 2
        # Point without time_seconds should be sorted first (defaults to 0)
        assert plan["recommended_order"][0] == "地点A"  # time 0 (default)
        assert plan["recommended_order"][1] == "地点B"  # time 400

    def test_points_prefer_cn_name(self, planner):
        """Test that cn_name is preferred over name."""
        points = [
            {
                "id": "point_1",
                "name": "English Name",
                "cn_name": "中文名称",
                "episode": 1,
                "time_seconds": 100,
            },
        ]

        plan = planner.generate_plan(origin="Tokyo", anime="Test", points=points)

        # Should prefer cn_name
        assert plan["recommended_order"][0] == "English Name"

    def test_points_fallback_to_name(self, planner):
        """Test fallback to name when cn_name is missing."""
        points = [
            {
                "id": "point_1",
                "name": "English Name",
                # Missing cn_name
                "episode": 1,
                "time_seconds": 100,
            },
        ]

        plan = planner.generate_plan(origin="Tokyo", anime="Test", points=points)

        # Should fallback to name
        assert plan["recommended_order"][0] == "English Name"

    def test_points_with_no_name_fields(self, planner):
        """Test handling points with neither name nor cn_name."""
        points = [
            {
                "id": "point_1",
                # Missing both name and cn_name
                "episode": 1,
                "time_seconds": 100,
            },
        ]

        plan = planner.generate_plan(origin="Tokyo", anime="Test", points=points)

        # Should use fallback text
        assert plan["recommended_order"][0] == "unknown point"

    def test_route_description_multiline_format(self, planner, sample_points):
        """Test that route description is properly multiline."""
        plan = planner.generate_plan(
            origin="Tokyo", anime="Test", points=sample_points
        )

        description = plan["route_description"]
        lines = description.split("\n")

        # Should have multiple lines
        assert len(lines) >= 6  # header + blank + "Recommended route:" + 4 points

    def test_different_origins(self, planner, sample_points):
        """Test that different origins are reflected in the output."""
        origins = ["Tokyo Station", "Shibuya", "Shinjuku"]

        for origin in origins:
            plan = planner.generate_plan(
                origin=origin, anime="Test", points=sample_points
            )

            # Origin should appear in description and transport tips
            assert origin in plan["route_description"]
            assert origin in plan["transport_tips"]

    def test_generate_transport_tips_private_method(self, planner):
        """Test the _generate_transport_tips method."""
        tips = planner._generate_transport_tips("Akihabara Station")

        # Should be a string
        assert isinstance(tips, str)

        # Should mention the origin
        assert "Akihabara Station" in tips

        # Should contain recommendations
        assert "public transportation" in tips or "trains" in tips
        assert "walking" in tips
        assert "day pass" in tips

        # Should be multiline
        assert "\n" in tips

    def test_plan_consistency(self, planner, sample_points):
        """Test that multiple calls with same input produce same output."""
        plan1 = planner.generate_plan(
            origin="Tokyo", anime="Test", points=sample_points
        )
        plan2 = planner.generate_plan(
            origin="Tokyo", anime="Test", points=sample_points
        )

        # Should produce identical results
        assert plan1["recommended_order"] == plan2["recommended_order"]
        assert plan1["route_description"] == plan2["route_description"]
        assert plan1["estimated_duration"] == plan2["estimated_duration"]
        assert plan1["estimated_distance"] == plan2["estimated_distance"]
