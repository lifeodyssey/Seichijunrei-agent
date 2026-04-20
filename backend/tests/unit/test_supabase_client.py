"""Unit tests for SupabaseClient repository property delegation."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from backend.infrastructure.supabase.client import SupabaseClient


@pytest.fixture
def mock_pool() -> AsyncMock:
    pool = AsyncMock()
    pool.fetchrow = AsyncMock()
    pool.execute = AsyncMock()
    return pool


def _make_client(pool: AsyncMock) -> SupabaseClient:
    """Create a SupabaseClient with repos initialized from a mock pool."""
    client = SupabaseClient.__new__(SupabaseClient)
    client._pool = pool
    client._bangumi = None
    client._points = None
    client._session = None
    client._feedback = None
    client._user_memory = None
    client._routes = None
    client._messages = None
    client._init_repos(pool)
    return client


@pytest.mark.asyncio
async def test_upsert_point_uses_geography_cast_for_location() -> None:
    pool = AsyncMock()
    client = _make_client(pool)

    await client.points.upsert_point(
        "p1",
        bangumi_id="115908",
        name="宇治桥",
        name_cn="宇治桥",
        episode=1,
        time_seconds=42,
        image="https://example.com/point.jpg",
        location="POINT(135.7997 34.8843)",
    )

    sql = pool.execute.await_args.args[0]
    assert "ST_GeogFromText" in sql
    assert pool.execute.await_args.args[-1] == "POINT(135.7997 34.8843)"


@pytest.mark.asyncio
async def test_upsert_points_batch_accepts_latitude_and_longitude() -> None:
    conn = MagicMock()
    conn.executemany = AsyncMock()
    tx = AsyncMock()
    tx.__aenter__.return_value = tx
    tx.__aexit__.return_value = None
    conn.transaction.return_value = tx

    acquire_ctx = AsyncMock()
    acquire_ctx.__aenter__.return_value = conn
    acquire_ctx.__aexit__.return_value = None

    pool = MagicMock()
    pool.acquire.return_value = acquire_ctx
    client = _make_client(pool)

    await client.points.upsert_points_batch(
        [
            {
                "id": "p1",
                "bangumi_id": "115908",
                "name": "宇治桥",
                "name_cn": "宇治桥",
                "latitude": 34.8843,
                "longitude": 135.7997,
                "episode": 1,
                "time_seconds": 42,
                "image": "https://example.com/point.jpg",
                "location": "POINT(135.7997 34.8843)",
            }
        ]
    )

    sql = conn.executemany.await_args.args[0]
    args = conn.executemany.await_args.args[1]
    assert "latitude" in sql
    assert "longitude" in sql
    assert "ST_GeogFromText" in sql
    assert args == [
        (
            "p1",
            "115908",
            "宇治桥",
            "宇治桥",
            34.8843,
            135.7997,
            1,
            42,
            "https://example.com/point.jpg",
            "POINT(135.7997 34.8843)",
        )
    ]


@pytest.mark.asyncio
async def test_upsert_point_casts_embedding_to_vector() -> None:
    pool = AsyncMock()
    client = _make_client(pool)

    await client.points.upsert_point(
        "p1",
        bangumi_id="115908",
        name="宇治桥",
        latitude=34.8843,
        longitude=135.7997,
        embedding=[0.1, 0.2, 0.3],
    )

    sql = pool.execute.await_args.args[0]
    args = pool.execute.await_args.args[1:]
    assert "embedding" in sql
    assert "::vector" in sql
    assert args[-1] == "[0.1,0.2,0.3]"


@pytest.mark.asyncio
async def test_search_points_by_location_uses_runtime_contract_query() -> None:
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    client = _make_client(pool)

    await client.points.search_points_by_location(34.8843, 135.7997, 5000, limit=10)

    sql = pool.fetch.await_args.args[0]
    assert "SELECT *" not in sql
    assert "LEFT JOIN bangumi b ON p.bangumi_id = b.id" in sql
    assert "p.image AS screenshot_url" in sql
    assert "b.title" in sql
    assert "b.title_cn" in sql
    assert "distance_m" in sql


class TestFindBangumiByTitle:
    async def test_exact_title_match(self, mock_pool):
        mock_pool.fetchrow.return_value = {"id": "115908"}
        client = _make_client(mock_pool)
        result = await client.bangumi.find_bangumi_by_title("響け！ユーフォニアム")
        assert result == "115908"
        call_args = mock_pool.fetchrow.call_args[0]
        assert "ilike" in call_args[0].lower() or "$1" in call_args[0]

    async def test_no_match_returns_none(self, mock_pool):
        mock_pool.fetchrow.return_value = None
        client = _make_client(mock_pool)
        result = await client.bangumi.find_bangumi_by_title("unknown anime xyz")
        assert result is None


class TestGetPointsByIds:
    async def test_returns_empty_for_empty_input(self, mock_pool):
        client = _make_client(mock_pool)

        result = await client.points.get_points_by_ids([])

        assert result == []
        mock_pool.fetch.assert_not_awaited()

    async def test_fetches_points_preserving_input_order(self, mock_pool):
        mock_pool.fetch.return_value = [
            {"id": "p2", "name": "Byodoin"},
            {"id": "p1", "name": "Uji Bridge"},
        ]
        client = _make_client(mock_pool)

        result = await client.points.get_points_by_ids(["p2", "p1"])

        assert result == [
            {"id": "p2", "name": "Byodoin"},
            {"id": "p1", "name": "Uji Bridge"},
        ]
        sql = mock_pool.fetch.await_args.args[0]
        assert "WITH ORDINALITY" in sql


class TestUpsertBangumiTitle:
    async def test_upserts_title(self, mock_pool):
        mock_pool.execute.return_value = None
        client = _make_client(mock_pool)
        await client.bangumi.upsert_bangumi_title("進撃の巨人", "6718")
        mock_pool.execute.assert_awaited_once()
        sql, *args = mock_pool.execute.call_args[0]
        assert "6718" in args or "進撃の巨人" in args


@pytest.fixture
def persistence_db(mock_pool: AsyncMock) -> SupabaseClient:
    return _make_client(mock_pool)


class TestUpsertConversation:
    async def test_inserts_or_touches_conversation(self, persistence_db, mock_pool):
        await persistence_db.session.upsert_conversation(
            session_id="sess-1",
            user_id="user-1",
            first_query="京吹の聖地を探して",
        )

        sql = mock_pool.execute.await_args.args[0]
        assert "INSERT INTO conversations" in sql
        assert "ON CONFLICT" in sql

    async def test_does_not_overwrite_existing_first_query(
        self,
        persistence_db,
        mock_pool,
    ):
        await persistence_db.session.upsert_conversation(
            session_id="sess-1",
            user_id="user-1",
            first_query="京吹の聖地を探して",
        )

        sql = mock_pool.execute.await_args.args[0]
        assert "first_query" not in sql.split("DO UPDATE SET", maxsplit=1)[1]


class TestUpdateConversationTitle:
    async def test_updates_conversation_title(self, persistence_db, mock_pool):
        await persistence_db.session.update_conversation_title("sess-1", "京吹 宇治")

        sql = mock_pool.execute.await_args.args[0]
        assert "UPDATE conversations" in sql
        assert "title" in sql


class TestGetConversations:
    async def test_returns_empty_list_when_no_rows(self, persistence_db, mock_pool):
        mock_pool.fetch.return_value = []

        result = await persistence_db.session.get_conversations("user-1")

        assert result == []

    async def test_returns_list_of_dicts(self, persistence_db, mock_pool):
        mock_pool.fetch.return_value = [
            {
                "session_id": "sess-1",
                "title": "京吹の聖地",
                "first_query": "京吹の聖地を探して",
                "created_at": "2026-04-02T10:00:00Z",
                "updated_at": "2026-04-02T10:00:00Z",
            }
        ]

        result = await persistence_db.session.get_conversations("user-1")

        assert len(result) == 1
        assert result[0]["session_id"] == "sess-1"


class TestUserMemory:
    async def test_upsert_inserts_first_entry(self, persistence_db, mock_pool):
        mock_pool.fetchrow.return_value = None

        await persistence_db.user_memory.upsert_user_memory(
            "user-1",
            bangumi_id="253",
            anime_title="響け！ユーフォニアム",
        )

        sql, *args = mock_pool.execute.await_args.args
        stored = json.loads(args[1])

        assert "INSERT INTO user_memory" in sql
        assert stored[0]["bangumi_id"] == "253"

    async def test_upsert_updates_existing_entry(self, persistence_db, mock_pool):
        mock_pool.fetchrow.return_value = {
            "visited_anime": json.dumps(
                [{"bangumi_id": "253", "title": "old", "last_at": "2026-01-01"}]
            )
        }

        await persistence_db.user_memory.upsert_user_memory(
            "user-1",
            bangumi_id="253",
            anime_title="響け！ユーフォニアム",
        )

        _, *args = mock_pool.execute.await_args.args
        stored = json.loads(args[1])

        assert len(stored) == 1
        assert stored[0]["title"] == "響け！ユーフォニアム"

    async def test_get_user_memory_returns_none_when_absent(
        self,
        persistence_db,
        mock_pool,
    ):
        mock_pool.fetchrow.return_value = None

        result = await persistence_db.user_memory.get_user_memory("user-1")

        assert result is None

    async def test_get_user_memory_returns_parsed_data(self, persistence_db, mock_pool):
        mock_pool.fetchrow.return_value = {
            "visited_anime": json.dumps([{"bangumi_id": "253"}]),
            "visited_points": "[]",
        }

        result = await persistence_db.user_memory.get_user_memory("user-1")

        assert result["visited_anime"][0]["bangumi_id"] == "253"
