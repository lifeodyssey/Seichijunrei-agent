import structlog
from structlog import testing

from animichi.interfaces.fastapi_service import create_fastapi_app
from animichi.utils.logger import configure_structlog, get_logger


def test_get_logger_binds_extra_kwargs() -> None:
    structlog.contextvars.clear_contextvars()
    logger = get_logger("test_logger_bind", request_id="abc")

    with testing.capture_logs() as captured:
        logger.info("hello")

    assert captured[0]["request_id"] == "abc"


def test_get_logger_without_kwargs_binds_nothing_extra() -> None:
    structlog.contextvars.clear_contextvars()
    logger = get_logger("test_logger_no_bind")

    with testing.capture_logs() as captured:
        logger.info("hello")

    assert "request_id" not in captured[0]


def test_get_logger_bindings_are_independent_per_call() -> None:
    structlog.contextvars.clear_contextvars()
    logger_a = get_logger("test_logger_a", request_id="a")
    logger_b = get_logger("test_logger_b", request_id="b")

    with testing.capture_logs() as captured:
        logger_a.info("from-a")
        logger_b.info("from-b")

    assert captured[0]["request_id"] == "a"
    assert captured[1]["request_id"] == "b"


def test_the_app_factory_installs_the_process_wide_chain() -> None:
    """The container's process start is the app factory. Without that call the
    runtime renders `exc_info=` with structlog's default rich console
    formatter, at 91 s per agent-run error (issue #1502)."""
    structlog.reset_defaults()
    try:
        create_fastapi_app()
        processors = structlog.get_config()["processors"]
    finally:
        configure_structlog()

    assert structlog.processors.format_exc_info in processors
    assert isinstance(processors[-1], structlog.processors.JSONRenderer)


def test_configure_structlog_leaves_an_existing_configuration_alone() -> None:
    """`capture_logs` and a second `create_fastapi_app()` both reconfigure
    structlog; neither may be clobbered by a late process-start call."""
    with testing.capture_logs() as captured:
        configure_structlog()
        get_logger("test_logger_reconfigure").info("hello")

    assert captured[0]["event"] == "hello"
