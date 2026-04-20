"""Feedback submission route."""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from backend.interfaces.routes._deps import (
    FeedbackRequest,
    _get_db_from_request,
    _json_response,
    _require_db_method,
)

router = APIRouter(prefix="/v1", tags=["feedback"])


@router.post("/feedback")
async def handle_feedback(
    payload: FeedbackRequest,
    request: Request,
) -> JSONResponse:
    db = _get_db_from_request(request)
    save_feedback = _require_db_method(db, "save_feedback")
    feedback_id_obj = await save_feedback(
        payload.session_id,
        payload.query_text,
        payload.intent,
        payload.rating,
        payload.comment,
    )
    feedback_id = str(feedback_id_obj)
    return _json_response({"feedback_id": feedback_id})
