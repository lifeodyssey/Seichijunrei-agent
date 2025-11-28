"""
Seichijunrei Bot ADK Agent Package

This package configures the Python path to ensure all imports from the
root project directory work correctly when the agent is loaded by ADK.
"""

import sys
from pathlib import Path

# Add the project root directory to Python path
# This allows imports like 'from agents import ...' to work
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

# Export root_agent for ADK
from .agent import root_agent

__all__ = ['root_agent']
