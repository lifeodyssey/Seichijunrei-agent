"""Exception handlers and observability middleware for the FastAPI app."""

from __future__ import annotations

import json
from time import perf_counter

import structlog
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.middleware.base import RequestResponseEndpoint
from starlette.responses import Response

from backend.infrastructure.observability import (
    get_http_tracer,
    record_http_request,
)
from backend.interfaces.routes._deps import (
    _contains_json_invalid_error,
    _error_response,
    _http_error_code,
)

logger = structlog.get_logger(__name__)


def register_exception_handlers(app: FastAPI) -> None:
    """Attach structured JSON exception handlers to *app*."""

    @app.exception_handler(RequestValidationError)
    async def handle_request_validation_error(
        request: Request,
        exc: RequestValidationError,
    ) -> JSONResponse:
        del request
        errors_obj: object = exc.errors()
        if _contains_json_invalid_error(errors_obj):
            return _error_response(
                "invalid_json",
                "Request body must be valid JSON.",
                status_code=400,
            )
        return _error_response(
            "invalid_request",
            "Request payload did not match the public API schema.",
            status_code=422,
            details=errors_obj,
        )

    @app.exception_handler(ValidationError)
    async def handle_validation_error(
        request: Request,
        exc: ValidationError,
    ) -> JSONResponse:
        del request
        details_obj: object = json.loads(exc.json())
        return _error_response(
            "invalid_request",
            "Request payload did not match the public API schema.",
            status_code=422,
            details=details_obj,
        )

    @app.exception_handler(HTTPException)
    async def handle_http_exception(
        request: Request,
        exc: HTTPException,
    ) -> JSONResponse:
        del request
        detail = exc.detail if isinstance(exc.detail, str) else "Request failed."
        return _error_response(
            _http_error_code(exc.status_code),
            detail,
            status_code=exc.status_code,
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_exception(
        request: Request,
        exc: Exception,
    ) -> JSONResponse:
        logger.exception(
            "fastapi_unhandled_exception",
            path=request.url.path,
            error=str(exc),
        )
        return _error_response(
            "internal_error",
            "Something went wrong. Please try again.",
            status_code=500,
        )


def register_observability_middleware(app: FastAPI) -> None:
    """Attach OpenTelemetry request tracing middleware to *app*."""

    @app.middleware("http")
    async def observability_middleware(
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        started_at = perf_counter()
        tracer = get_http_tracer()
        status_code = 500

        with tracer.start_as_current_span("http.request") as span:
            span.set_attribute("http.method", request.method)

            try:
                response = await call_next(request)
            except Exception as exc:
                span.record_exception(exc)
                raise
            else:
                status_code = response.status_code
                return response
            finally:
                elapsed_ms = (perf_counter() - started_at) * 1000
                route_obj: object = request.scope.get("route")
                route_path_obj: object = getattr(route_obj, "path", request.url.path)
                route_path = (
                    route_path_obj
                    if isinstance(route_path_obj, str)
                    else request.url.path
                )
                span.set_attribute("http.route", route_path)
                span.set_attribute("http.status_code", status_code)
                record_http_request(
                    duration_ms=elapsed_ms,
                    method=request.method,
                    route=route_path,
                    status_code=status_code,
                )
