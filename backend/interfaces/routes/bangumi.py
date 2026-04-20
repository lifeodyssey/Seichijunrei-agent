"""Bangumi discovery routes (popular, nearby)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from backend.interfaces.routes._deps import (
    TrustedAuthContext,
    _get_db_from_request,
    _get_trusted_auth_context,
    _json_response,
    _require_db_method,
)

router = APIRouter(prefix="/v1/bangumi", tags=["bangumi"])


@router.get("/popular")
async def handle_bangumi_popular(
    request: Request,
    auth: Annotated[TrustedAuthContext, Depends(_get_trusted_auth_context)],
    limit: int = 8,
) -> JSONResponse:
    if limit < 1:
        raise HTTPException(status_code=422, detail="limit must be a positive integer.")
    db = _get_db_from_request(request)
    list_popular = _require_db_method(db, "list_popular")
    rows_obj: object = await list_popular(limit=limit)
    rows: list[object] = list(rows_obj) if isinstance(rows_obj, list) else []
    return _json_response({"bangumi": rows})


@router.get("/nearby")
async def handle_bangumi_nearby(
    request: Request,
    auth: Annotated[TrustedAuthContext, Depends(_get_trusted_auth_context)],
    lat: float,
    lng: float,
    radius_m: int = 50000,
) -> JSONResponse:
    if lat < -90.0 or lat > 90.0:
        raise HTTPException(status_code=422, detail="lat must be between -90 and 90.")
    if lng < -180.0 or lng > 180.0:
        raise HTTPException(status_code=422, detail="lng must be between -180 and 180.")
    if radius_m < 1:
        raise HTTPException(status_code=422, detail="radius_m must be positive.")
    db = _get_db_from_request(request)
    get_bangumi_by_area = _require_db_method(db, "get_bangumi_by_area")
    rows_obj: object = await get_bangumi_by_area(lat, lng, radius_m)
    rows: list[object] = list(rows_obj) if isinstance(rows_obj, list) else []
    return _json_response({"bangumi": rows})
