"""Feedback submission route."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from backend.interfaces.routes._deps import (
    FeedbackRequest,
    TrustedAuthContext,
    _error_response,
    _get_db_from_request,
    _get_trusted_auth_context,
    _json_response,
    _require_supabase,
)

router = APIRouter(prefix="/v1", tags=["feedback"])


@router.post("/feedback")
async def handle_feedback(
    payload: FeedbackRequest,
    request: Request,
    auth: Annotated[
        TrustedAuthContext, Depends(_get_trusted_auth_context)
    ] = TrustedAuthContext(user_id=None, user_type=None),
) -> JSONResponse:
    db = _require_supabase(_get_db_from_request(request))

    # Validate session ownership when session_id is provided
    if payload.session_id:
        if not auth.user_id:
            return _error_response(
                "authentication_error",
                "Authentication required for session feedback.",
                status_code=401,
            )
        owns = await db.session.check_session_owner(payload.session_id, auth.user_id)
        if not owns:
            return _error_response(
                "forbidden",
                "You do not have permission to submit feedback for this session.",
                status_code=403,
            )

    feedback_id_obj = await db.feedback.save_feedback(
        payload.session_id,
        payload.query_text,
        payload.intent,
        payload.rating,
        payload.comment,
    )
    feedback_id = str(feedback_id_obj)
    return _json_response({"feedback_id": feedback_id})
