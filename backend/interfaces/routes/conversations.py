"""Conversation and route history routes."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from backend.infrastructure.supabase.client import SupabaseClient
from backend.interfaces.routes._deps import (
    ConversationPatchRequest,
    TrustedAuthContext,
    _error_response,
    _get_db_from_request,
    _json_response,
    _require_trusted_user,
)

router = APIRouter(prefix="/v1", tags=["conversations"])


def _require_supabase(db: object) -> SupabaseClient:
    if not isinstance(db, SupabaseClient):
        raise HTTPException(status_code=500, detail="Database client not available.")
    return db


@router.get("/conversations")
async def handle_get_conversations(
    request: Request,
    auth: Annotated[TrustedAuthContext, Depends(_require_trusted_user)],
) -> JSONResponse:
    assert auth.user_id is not None
    db = _require_supabase(_get_db_from_request(request))
    conversations_obj: object = await db.session.get_conversations(auth.user_id)
    return _json_response(conversations_obj)


@router.patch("/conversations/{session_id}")
async def handle_patch_conversation(
    session_id: str,
    payload: ConversationPatchRequest,
    request: Request,
    auth: Annotated[TrustedAuthContext, Depends(_require_trusted_user)],
) -> JSONResponse:
    assert auth.user_id is not None
    db = _require_supabase(_get_db_from_request(request))
    conversation_obj: object = await db.session.get_conversation(session_id)
    conversation = conversation_obj if isinstance(conversation_obj, dict) else None
    if conversation is None or conversation.get("user_id") != auth.user_id:
        return _error_response(
            "not_found",
            "Conversation not found.",
            status_code=404,
        )
    await db.session.update_conversation_title(
        session_id, payload.title, user_id=auth.user_id
    )
    return _json_response({"ok": True})


@router.get("/conversations/{session_id}/messages")
async def handle_get_messages(
    session_id: str,
    request: Request,
    auth: Annotated[TrustedAuthContext, Depends(_require_trusted_user)],
) -> JSONResponse:
    assert auth.user_id is not None
    db = _require_supabase(_get_db_from_request(request))
    conversation_obj: object = await db.session.get_conversation(session_id)
    conversation = conversation_obj if isinstance(conversation_obj, dict) else None
    if conversation is None or conversation.get("user_id") != auth.user_id:
        return _error_response(
            "not_found",
            "Conversation not found.",
            status_code=404,
        )

    messages_obj: object = await db.messages.get_messages(session_id)
    return _json_response({"messages": messages_obj})


@router.get("/routes")
async def handle_get_routes(
    request: Request,
    auth: Annotated[TrustedAuthContext, Depends(_require_trusted_user)],
) -> JSONResponse:
    assert auth.user_id is not None
    db = _require_supabase(_get_db_from_request(request))
    routes_obj: object = await db.routes.get_user_routes(auth.user_id)
    return _json_response({"routes": routes_obj})
