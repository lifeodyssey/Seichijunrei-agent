"""Domain repository modules for Supabase data access."""

from backend.infrastructure.supabase.repositories.bangumi import BangumiRepository
from backend.infrastructure.supabase.repositories.feedback import FeedbackRepository
from backend.infrastructure.supabase.repositories.messages import MessagesRepository
from backend.infrastructure.supabase.repositories.points import PointsRepository
from backend.infrastructure.supabase.repositories.routes import RoutesRepository
from backend.infrastructure.supabase.repositories.session import SessionRepository
from backend.infrastructure.supabase.repositories.user_memory import (
    UserMemoryRepository,
)

__all__ = [
    "BangumiRepository",
    "FeedbackRepository",
    "MessagesRepository",
    "PointsRepository",
    "RoutesRepository",
    "SessionRepository",
    "UserMemoryRepository",
]
