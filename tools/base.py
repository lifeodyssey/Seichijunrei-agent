"""
Base tool class for output generation tools.

Provides common interface and utilities for map and PDF generation.
"""

from abc import ABC, abstractmethod
from pathlib import Path

from domain.entities import PilgrimageSession
from utils.logger import get_logger


class BaseTool(ABC):
    """
    Abstract base class for output generation tools.

    All tools should inherit from this class and implement the generate() method.
    """

    def __init__(self, output_dir: str | None = None):
        """
        Initialize the tool.

        Args:
            output_dir: Directory to save output files. Defaults to "output/"
        """
        self.output_dir = Path(output_dir) if output_dir else Path("output")
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.logger = get_logger(__name__)

    @abstractmethod
    async def generate(self, session: PilgrimageSession) -> str:
        """
        Generate output from a pilgrimage session.

        Args:
            session: Complete PilgrimageSession with route and data

        Returns:
            Path to the generated file

        Raises:
            ValueError: If session data is incomplete or invalid
        """
        pass

    def validate_session(self, session: PilgrimageSession) -> bool:
        """
        Validate that session has required data for output generation.

        Args:
            session: PilgrimageSession to validate

        Returns:
            True if valid, False otherwise
        """
        if not session.station:
            self.logger.error("Session missing station data")
            return False

        if not session.route:
            self.logger.error("Session missing route data")
            return False

        if len(session.route.segments) == 0:
            self.logger.error("Route has no segments")
            return False

        return True

    def get_output_path(self, filename: str) -> Path:
        """
        Get full path for output file.

        Args:
            filename: Name of the file to save

        Returns:
            Full path to output file
        """
        return self.output_dir / filename
