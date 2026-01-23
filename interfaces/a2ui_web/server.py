"""Local A2UI web server (aiohttp) for Seichijunrei.

This is a developer-facing / local-user UI to validate an A2UI-driven
experience without relying on the ADK web UI.
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Any

from aiohttp import web

from .backends import create_backend
from .presenter import build_a2ui_error_response, build_a2ui_response

_HERE = Path(__file__).resolve().parent
_STATIC_DIR = _HERE / "static"

_BACKEND = create_backend()


def _ensure_session_id(session_id: str | None) -> str:
    if session_id and isinstance(session_id, str):
        return session_id
    return uuid.uuid4().hex


def _action_to_message(action_name: str) -> str:
    if action_name.startswith("select_candidate_"):
        return action_name.removeprefix("select_candidate_")
    if action_name.startswith("send_text:"):
        return action_name.removeprefix("send_text:")
    return action_name


async def index(request: web.Request) -> web.StreamResponse:
    return web.FileResponse(_STATIC_DIR / "index.html")


async def static_file(request: web.Request) -> web.StreamResponse:
    rel = request.match_info.get("path", "")
    # Prevent directory traversal.
    safe_rel = rel.replace("..", "").lstrip("/")
    path = (_STATIC_DIR / safe_rel).resolve()
    if not str(path).startswith(str(_STATIC_DIR.resolve())):
        raise web.HTTPNotFound()
    if not path.exists() or not path.is_file():
        raise web.HTTPNotFound()
    return web.FileResponse(path)


async def api_chat(request: web.Request) -> web.Response:
    payload = await request.json()
    session_id = _ensure_session_id(payload.get("session_id"))
    message = payload.get("message")
    if not isinstance(message, str) or not message.strip():
        raise web.HTTPBadRequest(text="Missing 'message' (string).")

    try:
        last_text, state = await _BACKEND.chat(
            session_id=session_id, user_text=message.strip()
        )
        presenter_text, a2ui_messages = build_a2ui_response(state)
        return web.json_response(
            {
                "session_id": session_id,
                "assistant_text": last_text or presenter_text,
                "a2ui_messages": a2ui_messages,
            }
        )
    except Exception as exc:
        # Best-effort: render an error surface; state may be empty if backend failed early.
        state: dict[str, Any] = {}
        assistant_text, a2ui_messages = build_a2ui_error_response(
            state, error_message=str(exc)
        )
        return web.json_response(
            {
                "session_id": session_id,
                "assistant_text": assistant_text,
                "a2ui_messages": a2ui_messages,
            }
        )


async def api_action(request: web.Request) -> web.Response:
    payload = await request.json()
    session_id = _ensure_session_id(payload.get("session_id"))
    action_name = payload.get("action_name")
    if not isinstance(action_name, str) or not action_name.strip():
        raise web.HTTPBadRequest(text="Missing 'action_name' (string).")

    # UI-only action: remove a selected point by displayed index (1-based).
    if action_name.startswith("remove_point_"):
        idx_str = action_name.removeprefix("remove_point_")
        if idx_str.isdigit():
            ok, state = await _BACKEND.remove_point(
                session_id=session_id, index_0=int(idx_str) - 1
            )

            extraction = state.get("extraction_result") or {}
            lang = (
                extraction.get("user_language")
                if isinstance(extraction, dict)
                else None
            )
            lang = lang if isinstance(lang, str) else "zh-CN"

            if ok:
                assistant_text = (
                    "Removed the point and replanned."
                    if lang == "en"
                    else (
                        "削除してルートを再計算しました。"
                        if lang == "ja"
                        else "已移除该点位并重新规划路线。"
                    )
                )
            else:
                assistant_text = (
                    "Remove failed: invalid index."
                    if lang == "en"
                    else (
                        "削除に失敗しました（インデックスが不正）。"
                        if lang == "ja"
                        else "移除失败：点位索引无效。"
                    )
                )

            presenter_text, a2ui_messages = build_a2ui_response(state)
            return web.json_response(
                {
                    "session_id": session_id,
                    "assistant_text": assistant_text or presenter_text,
                    "a2ui_messages": a2ui_messages,
                }
            )

    message = _action_to_message(action_name.strip())
    try:
        last_text, state = await _BACKEND.chat(session_id=session_id, user_text=message)
        presenter_text, a2ui_messages = build_a2ui_response(state)
        return web.json_response(
            {
                "session_id": session_id,
                "assistant_text": last_text or presenter_text,
                "a2ui_messages": a2ui_messages,
            }
        )
    except Exception as exc:
        state = {}
        assistant_text, a2ui_messages = build_a2ui_error_response(
            state, error_message=str(exc)
        )
        return web.json_response(
            {
                "session_id": session_id,
                "assistant_text": assistant_text,
                "a2ui_messages": a2ui_messages,
            }
        )


def create_app() -> web.Application:
    app = web.Application()
    app.router.add_get("/", index)
    app.router.add_get("/static/{path:.*}", static_file)
    app.router.add_post("/api/chat", api_chat)
    app.router.add_post("/api/action", api_action)
    return app


def main() -> None:  # pragma: no cover
    # Cloud Run provides PORT; local dev uses A2UI_PORT (default 8081).
    port = int(os.getenv("PORT", os.getenv("A2UI_PORT", "8081")))
    host = os.getenv("A2UI_HOST", "0.0.0.0")
    web.run_app(create_app(), host=host, port=port, print=None)


if __name__ == "__main__":  # pragma: no cover
    main()
