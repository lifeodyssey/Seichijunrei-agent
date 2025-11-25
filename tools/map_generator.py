"""
MapGeneratorTool - Generate interactive maps using Folium.

Creates interactive HTML maps with:
- Origin marker (station)
- Numbered markers for each pilgrimage point
- Color-coded markers by bangumi
- Route polylines
- Bilingual (CN/JP) popups
"""

import folium
from pathlib import Path
from typing import Optional, Dict
from domain.entities import PilgrimageSession, Point, Coordinates
from tools.base import BaseTool


class MapGeneratorTool(BaseTool):
    """
    Generate interactive HTML maps for pilgrimage routes.

    Uses Folium library to create maps with markers, popups, and route lines.
    """

    def __init__(self, output_dir: Optional[str] = None):
        """
        Initialize the MapGeneratorTool.

        Args:
            output_dir: Directory to save map HTML files. Defaults to "output/maps"
        """
        super().__init__(output_dir=output_dir or "output/maps")

    async def generate(self, session: PilgrimageSession) -> str:
        """
        Generate an interactive map from a PilgrimageSession.

        Args:
            session: Complete PilgrimageSession with route data

        Returns:
            Path to the generated HTML file

        Raises:
            ValueError: If session data is incomplete
        """
        # Validate input
        self._validate_session_for_map(session)

        self.logger.info(
            "Generating map for session",
            session_id=session.session_id,
            points_count=len(session.route.segments)
        )

        # Create base map
        map_obj = self._create_base_map(session)

        # Add origin marker
        self._add_origin_marker(map_obj, session.station)

        # Add point markers with numbering and colors
        self._add_point_markers(map_obj, session)

        # Add route polylines
        self._add_route_polylines(map_obj, session)

        # Save map
        output_path = self._save_map(map_obj, session.session_id)

        self.logger.info(
            "Map generated successfully",
            session_id=session.session_id,
            output_path=str(output_path)
        )

        return str(output_path)

    def _validate_session_for_map(self, session: PilgrimageSession):
        """Validate session has required data for map generation."""
        if not session.route:
            raise ValueError("Session must have a route for map generation")

        if len(session.route.segments) == 0:
            raise ValueError("Route must have at least one segments")

    def _create_base_map(self, session: PilgrimageSession) -> folium.Map:
        """
        Create base Folium map centered on route.

        Args:
            session: PilgrimageSession with route data

        Returns:
            Folium Map object
        """
        # Calculate centroid of all points
        center_lat, center_lon = self._calculate_route_center(session)

        # Create map
        map_obj = folium.Map(
            location=[center_lat, center_lon],
            zoom_start=13,
            tiles="OpenStreetMap"
        )

        return map_obj

    def _calculate_route_center(self, session: PilgrimageSession) -> tuple[float, float]:
        """Calculate the geographic center of the route."""
        # Include origin station
        all_coords = [session.station.coordinates]

        # Add all point coordinates
        for segment in session.route.segments:
            all_coords.append(segment.point.coordinates)

        # Calculate average
        avg_lat = sum(c.latitude for c in all_coords) / len(all_coords)
        avg_lon = sum(c.longitude for c in all_coords) / len(all_coords)

        return avg_lat, avg_lon

    def _add_origin_marker(self, map_obj: folium.Map, station):
        """Add a special marker for the origin station."""
        popup_html = f"""
        <div style="font-family: Arial, sans-serif; min-width: 200px;">
            <h4 style="margin: 0 0 8px 0; color: #2C3E50;">起点 / Origin</h4>
            <p style="margin: 4px 0;">
                <strong>🚉 {station.name}</strong>
            </p>
            {f'<p style="margin: 4px 0; color: #7F8C8D;">{station.city}, {station.prefecture}</p>' if station.city else ''}
        </div>
        """

        folium.Marker(
            location=[station.coordinates.latitude, station.coordinates.longitude],
            popup=folium.Popup(popup_html, max_width=300),
            icon=folium.Icon(color="red", icon="home", prefix="fa"),
            tooltip="起点 Origin"
        ).add_to(map_obj)

    def _add_point_markers(self, map_obj: folium.Map, session: PilgrimageSession):
        """Add numbered markers for each pilgrimage point."""
        # Build bangumi color map
        color_map = self._build_bangumi_color_map(session)

        for segment in session.route.segments:
            point = segment.point
            order = segment.order

            # Get color for this bangumi
            marker_color = color_map.get(point.bangumi_id, "#3498DB")

            # Create bilingual popup
            popup_html = self._create_point_popup_html(point, order, segment)

            # Create custom numbered icon
            icon_html = self._create_numbered_icon(order, marker_color)

            folium.Marker(
                location=[point.coordinates.latitude, point.coordinates.longitude],
                popup=folium.Popup(popup_html, max_width=350),
                icon=folium.DivIcon(html=icon_html),
                tooltip=f"{order}. {point.cn_name}"
            ).add_to(map_obj)

    def _build_bangumi_color_map(self, session: PilgrimageSession) -> Dict[str, str]:
        """Build a map of bangumi_id to color."""
        color_map = {}

        for bangumi in session.nearby_bangumi:
            if bangumi.primary_color:
                color_map[bangumi.id] = bangumi.primary_color

        return color_map

    def _create_point_popup_html(self, point: Point, order: int, segment) -> str:
        """Create HTML content for point popup."""
        transport_info = ""
        if segment.transport:
            transport_icon = "🚶" if segment.transport.mode == "walking" else "🚇"
            transport_info = f"""
            <p style="margin: 8px 0; padding: 8px; background: #ECF0F1; border-radius: 4px;">
                {transport_icon} <strong>{segment.transport.mode.title()}</strong><br/>
                {segment.transport.distance_meters}m, {segment.transport.duration_minutes}分钟
            </p>
            """

        html = f"""
        <div style="font-family: Arial, sans-serif; min-width: 250px;">
            <div style="background: #3498DB; color: white; padding: 8px; margin: -10px -10px 10px -10px; border-radius: 4px 4px 0 0;">
                <h4 style="margin: 0;">景点 {order}</h4>
            </div>
            <p style="margin: 8px 0;">
                <strong style="font-size: 14px; color: #2C3E50;">{point.cn_name}</strong><br/>
                <span style="color: #7F8C8D; font-size: 12px;">{point.name}</span>
            </p>
            <p style="margin: 8px 0; font-size: 13px;">
                <strong>🎬 {point.bangumi_title}</strong><br/>
                <span style="color: #7F8C8D;">第{point.episode}集 {point.time_formatted}</span>
            </p>
            {transport_info}
        </div>
        """

        return html

    def _create_numbered_icon(self, order: int, color: str) -> str:
        """Create HTML for numbered marker icon."""
        html = f"""
        <div style="
            position: relative;
            width: 36px;
            height: 36px;
            background-color: {color};
            border: 3px solid white;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            font-weight: bold;
            font-size: 16px;
            color: white;
        ">
            {order}
        </div>
        """
        return html

    def _add_route_polylines(self, map_obj: folium.Map, session: PilgrimageSession):
        """Draw polylines connecting points in visit order."""
        # Start from origin
        route_coords = [
            [session.station.coordinates.latitude,
             session.station.coordinates.longitude]
        ]

        # Add all point coordinates in order
        for segment in session.route.segments:
            route_coords.append([
                segment.point.coordinates.latitude,
                segment.point.coordinates.longitude
            ])

        # Draw polyline
        folium.PolyLine(
            locations=route_coords,
            color="#3498DB",
            weight=4,
            opacity=0.7,
            popup="巡礼路线 Pilgrimage Route"
        ).add_to(map_obj)

    def _save_map(self, map_obj: folium.Map, session_id: str) -> Path:
        """Save map to HTML file."""
        filename = f"{session_id}.html"
        output_path = self.get_output_path(filename)

        map_obj.save(str(output_path))

        return output_path
