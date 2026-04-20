"""SQL retrieval with write-through fallback on DB miss."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from backend.agents.models import RetrievalRequest
from backend.agents.retrievers.enrichment import write_through_bangumi_points
from backend.agents.sql_agent import SQLAgent, SQLResult
from backend.domain.entities import Point


def should_try_db_miss_fallback(request: RetrievalRequest) -> bool:
    return request.tool == "search_bangumi" and bool(request.bangumi_id)


async def execute_sql_with_fallback(
    request: RetrievalRequest,
    sql_agent: SQLAgent,
    db: object,
    fetch_bangumi_points: Callable[[str], Awaitable[list[Point]]] | None,
    get_bangumi_subject: Callable[[int], Awaitable[dict[str, object]]] | None,
) -> tuple[SQLResult, dict[str, object]]:
    sql_result = await sql_agent.execute(request)
    metadata: dict[str, object] = {"data_origin": "db"}
    if not sql_result.success:
        return sql_result, metadata
    has_rows = sql_result.row_count > 0
    should_fallback = should_try_db_miss_fallback(request)
    if has_rows and not request.force_refresh:
        return sql_result, metadata
    if not has_rows and not should_fallback:
        return sql_result, metadata
    bangumi_id = request.bangumi_id
    if bangumi_id is None:
        raise ValueError("bangumi_id required for fallback retrieval")
    fallback_meta = await write_through_bangumi_points(
        db, bangumi_id, fetch_bangumi_points, get_bangumi_subject
    )
    metadata.update(fallback_meta)
    if fallback_meta.get("write_through"):
        rerun_result = await sql_agent.execute(request)
        if rerun_result.success:
            return rerun_result, metadata
    return sql_result, metadata
