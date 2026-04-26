"""Tests for generated_title in PublicAPIResponse.

Behavior: when a conversation title is generated (first interaction),
the response should include generated_title so the frontend can update
the sidebar immediately without a page refresh.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from backend.infrastructure.session.memory import InMemorySessionStore
from backend.infrastructure.supabase.client import SupabaseClient
from backend.interfaces.public_api import PublicAPIRequest, RuntimeAPI
from backend.tests.unit.conftest_public_api import (
    install_mock_pipeline,
)
from backend.tests.unit.conftest_public_api import (
    make_result as _make_result,
)


@pytest.fixture(autouse=True)
def _mock_pipeline(monkeypatch):
    install_mock_pipeline(monkeypatch)


@pytest.fixture
def mock_db():
    db = MagicMock(spec=SupabaseClient)
    db.session.upsert_session = AsyncMock()
    db.session.upsert_conversation = AsyncMock()
    db.session.update_conversation_title = AsyncMock()
    db.user_memory.get_user_memory = AsyncMock(return_value=None)
    db.user_memory.upsert_user_memory = AsyncMock()
    db.routes.save_route = AsyncMock(return_value="route-1")
    db.insert_message = AsyncMock()
    db.insert_request_log = AsyncMock()
    return db


class TestGeneratedTitleInResponse:
    async def test_response_has_generated_title_field(self) -> None:
        """PublicAPIResponse schema should accept generated_title."""
        from backend.interfaces.schemas import PublicAPIResponse

        resp = PublicAPIResponse(
            success=True,
            status="ok",
            intent="search_bangumi",
            generated_title="響けの聖地",
        )
        assert resp.generated_title == "響けの聖地"

    async def test_generated_title_defaults_to_none(self) -> None:
        """generated_title should be None when not provided."""
        from backend.interfaces.schemas import PublicAPIResponse

        resp = PublicAPIResponse(
            success=True,
            status="ok",
            intent="search_bangumi",
        )
        assert resp.generated_title is None

    # TODO: re-enable when conversation history title generation is wired back
    # async def test_first_interaction_includes_fallback_title(self, mock_db):
    #     api = RuntimeAPI(mock_db, session_store=InMemorySessionStore())
    #     response = await api.handle(
    #         PublicAPIRequest(text="響けの聖地を探して", locale="ja"),
    #         user_id="user-1",
    #     )
    #     assert response is not None
    #     assert response.generated_title == "響けの聖地を探して"

    async def test_greet_does_not_include_generated_title(
        self, mock_db, monkeypatch
    ) -> None:
        """Greet (ephemeral) should not have generated_title."""

        async def _fake_greet(**kwargs):
            return _make_result(
                intent="greet_user",
                message="你好！我是圣地巡礼助手。",
            )

        monkeypatch.setattr(
            "backend.interfaces.public_api.run_pilgrimage_agent", _fake_greet
        )

        api = RuntimeAPI(mock_db, session_store=InMemorySessionStore())
        response = await api.handle(
            PublicAPIRequest(text="你好", locale="zh"),
        )

        assert response is not None
        assert response.generated_title is None
