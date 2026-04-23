"""Unit tests for the feedback route — session ownership checks.

Covers:
- Unauthenticated request with session_id → 401
- Authenticated + owned session → 200
- Authenticated + non-owned session → 403
- Request without session_id → 200 (no ownership check)
"""

from __future__ import annotations

from unittest.mock import AsyncMock

from backend.tests.unit.conftest_fastapi import (
    async_client,
    build_app,
    build_stub_db,
)


def _feedback_payload(
    *,
    session_id: str | None = None,
    query_text: str = "Great app!",
    rating: str = "good",
) -> dict[str, object]:
    payload: dict[str, object] = {"query_text": query_text, "rating": rating}
    if session_id is not None:
        payload["session_id"] = session_id
    return payload


# ---------------------------------------------------------------------------
# 401 — unauthenticated request with session_id
# ---------------------------------------------------------------------------


async def test_feedback_with_session_id_but_no_auth_returns_401() -> None:
    app, _ = build_app()
    async with async_client(app) as client:
        resp = await client.post(
            "/v1/feedback",
            json=_feedback_payload(session_id="sess-123"),
            # no X-User-Id header → unauthenticated
        )
    assert resp.status_code == 401
    body = resp.json()
    assert body["error"]["code"] == "authentication_error"


# ---------------------------------------------------------------------------
# 200 — authenticated + owned session
# ---------------------------------------------------------------------------


async def test_feedback_with_owned_session_returns_200() -> None:
    db = build_stub_db()
    db.session.check_session_owner = AsyncMock(return_value=True)
    db.feedback.save_feedback = AsyncMock(return_value="fb-001")

    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.post(
            "/v1/feedback",
            json=_feedback_payload(session_id="sess-123"),
            headers={"X-User-Id": "user-1"},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["feedback_id"] == "fb-001"
    db.session.check_session_owner.assert_awaited_once_with("sess-123", "user-1")


# ---------------------------------------------------------------------------
# 403 — authenticated but session belongs to another user
# ---------------------------------------------------------------------------


async def test_feedback_with_non_owned_session_returns_403() -> None:
    db = build_stub_db()
    db.session.check_session_owner = AsyncMock(return_value=False)

    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.post(
            "/v1/feedback",
            json=_feedback_payload(session_id="sess-456"),
            headers={"X-User-Id": "user-evil"},
        )
    assert resp.status_code == 403
    body = resp.json()
    assert body["error"]["code"] == "forbidden"


# ---------------------------------------------------------------------------
# 200 — no session_id → skip ownership check entirely
# ---------------------------------------------------------------------------


async def test_feedback_without_session_id_skips_ownership_check() -> None:
    db = build_stub_db()
    db.feedback.save_feedback = AsyncMock(return_value="fb-002")

    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.post(
            "/v1/feedback",
            json=_feedback_payload(),  # no session_id
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["feedback_id"] == "fb-002"
    # check_session_owner should never have been called
    db.session.check_session_owner.assert_not_called()
