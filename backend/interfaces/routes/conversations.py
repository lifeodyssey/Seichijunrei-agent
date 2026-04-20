"""Conversation and route history routes."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from backend.interfaces.routes._deps import (
    ConversationPatchRequest,
    TrustedAuthContext,
    _error_response,
    _get_db_from_request,
    _json_response,
    _require_db_method,
    _require_trusted_user,
)

router = APIRouter(prefix="/v1", tags=["conversations"])


@router.get("/conversations")
async def handle_get_conversations(
    request: Request,
    auth: Annotated[TrustedAuthContext, Depends(_require_trusted_user)],
) -> JSONResponse:
    assert auth.user_id is not None
    db = _get_db_from_request(request)
    get_conversations = _require_db_method(db, "get_conversations")
    conversations_obj: object = await get_conversations(auth.user_id)
    return _json_response(conversations_obj)


@router.patch("/conversations/{session_id}")
async def handle_patch_conversation(
    session_id: str,
    payload: ConversationPatchRequest,
    request: Request,
    auth: Annotated[TrustedAuthContext, Depends(_require_trusted_user)],
) -> JSONResponse:
    assert auth.user_id is not None
    db = _get_db_from_request(request)
    get_conversation = _require_db_method(db, "get_conversation")
    conversation_obj: object = await get_conversation(session_id)
    conversation = conversation_obj if isinstance(conversation_obj, dict) else None
    if conversation is None or conversation.get("user_id") != auth.user_id:
        return _error_response(
            "not_found",
            "Conversation not found.",
            status_code=404,
        )
    update_conversation_title = _require_db_method(db, "update_conversation_title")
    await update_conversation_title(session_id, payload.title, user_id=auth.user_id)
    return _json_response({"ok": True})


@router.get("/conversations/{session_id}/messages")
async def handle_get_messages(
    session_id: str,
    request: Request,
    auth: Annotated[TrustedAuthContext, Depends(_require_trusted_user)],
) -> JSONResponse:
    assert auth.user_id is not None
    db = _get_db_from_request(request)
    get_conversation = _require_db_method(db, "get_conversation")
    conversation_obj: object = await get_conversation(session_id)
    conversation = conversation_obj if isinstance(conversation_obj, dict) else None
    if conversation is None or conversation.get("user_id") != auth.user_id:
        return _error_response(
            "not_found",
            "Conversation not found.",
            status_code=404,
        )

    get_messages = _require_db_method(db, "get_messages")
    messages_obj: object = await get_messages(session_id)
    return _json_response({"messages": messages_obj})


@router.get("/routes")
async def handle_get_routes(
    request: Request,
    auth: Annotated[TrustedAuthContext, Depends(_require_trusted_user)],
) -> JSONResponse:
    assert auth.user_id is not None
    db = _get_db_from_request(request)
    get_user_routes = _require_db_method(db, "get_user_routes")
    routes_obj: object = await get_user_routes(auth.user_id)
    return _json_response({"routes": routes_obj})
