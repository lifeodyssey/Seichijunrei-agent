"""Pydantic request/response schemas for the public API surface.

Extracted from public_api.py to reduce module size and allow reuse
by multiple adapters (aiohttp, FastAPI, etc.).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator


class PublicAPIRequest(BaseModel):
    """Public request contract for runtime execution."""

    text: str = Field(default="", description="User message to process")
    session_id: str | None = Field(
        default=None,
        description="Optional session identifier for persisting conversation state",
    )
    model: str | None = Field(
        default=None,
        description="Optional override for the runtime model used by the pipeline",
    )
    locale: Literal["ja", "zh", "en"] = Field(
        default="ja",
        description="Response locale: ja (Japanese), zh (Chinese), or en (English)",
    )
    include_debug: bool = Field(
        default=False,
        description="Include plan and step-level details in the response",
    )
    selected_point_ids: list[str] | None = Field(
        default=None,
        description="Optional point IDs to route directly without planner execution.",
    )
    origin: str | None = Field(
        default=None,
        description="Optional departure location for selected-point routing.",
    )

    @model_validator(mode="after")
    def validate_request(self) -> PublicAPIRequest:
        self.text = self.text.strip()
        if self.origin is not None:
            self.origin = self.origin.strip() or None
        if self.selected_point_ids is not None:
            cleaned_ids = [
                point_id
                for point_id in (
                    str(point_id).strip() for point_id in self.selected_point_ids
                )
                if point_id
            ]
            self.selected_point_ids = cleaned_ids or None
        if not self.text and not self.selected_point_ids:
            raise ValueError(
                "text cannot be blank unless selected_point_ids is provided"
            )
        return self


class PublicAPIError(BaseModel):
    """Stable error payload for public callers."""

    code: str
    message: str
    details: dict[str, object] = Field(default_factory=dict)


class PublicAPIResponse(BaseModel):
    """Public response contract for runtime execution."""

    success: bool
    status: str
    intent: str
    session_id: str | None = None
    message: str = ""
    data: dict[str, object] = Field(default_factory=dict)
    session: dict[str, object] = Field(default_factory=dict)
    route_history: list[dict[str, object]] = Field(default_factory=list)
    errors: list[PublicAPIError] = Field(default_factory=list)
    ui: dict[str, str] | None = Field(
        default=None,
        description="Optional Generative UI descriptor: {component}",
    )
    debug: dict[str, object] | None = None
