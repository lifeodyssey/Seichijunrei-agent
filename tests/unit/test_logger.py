import structlog
from structlog import testing

from utils.logger import LogContext, get_logger


def test_log_context_adds_contextvars_only_within_scope() -> None:
    structlog.contextvars.clear_contextvars()
    logger = get_logger("test_logger")

    with testing.capture_logs(
        processors=[structlog.contextvars.merge_contextvars]
    ) as captured:
        logger.info("outside-1")
        with LogContext(logger, request_id="abc"):
            logger.info("inside")
        logger.info("outside-2")

    assert captured[0].get("request_id") is None
    assert captured[1]["request_id"] == "abc"
    assert captured[2].get("request_id") is None


def test_log_context_restores_previous_values_in_nested_scopes() -> None:
    structlog.contextvars.clear_contextvars()
    logger = get_logger("test_logger_nested")

    with testing.capture_logs(
        processors=[structlog.contextvars.merge_contextvars]
    ) as captured:
        with LogContext(logger, request_id="outer"):
            logger.info("outer")
            with LogContext(logger, request_id="inner"):
                logger.info("inner")
            logger.info("outer-again")
        logger.info("after")

    assert captured[0]["request_id"] == "outer"
    assert captured[1]["request_id"] == "inner"
    assert captured[2]["request_id"] == "outer"
    assert captured[3].get("request_id") is None
