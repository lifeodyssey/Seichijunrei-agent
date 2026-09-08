from pathlib import Path

import pytest
import structlog
from structlog import testing

from animichi.interfaces.fastapi_service import create_fastapi_app
from animichi.tests.eval.run_agent_eval import CliArgs, _main
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


async def test_the_eval_cli_main_installs_the_process_wide_chain(
    tmp_path: Path,
) -> None:
    """`make test-eval` is a third process start: it reaches neither the app
    factory nor the pytest conftest, so the runtime's `exc_info=` logs would
    render through the rich formatter for the whole run (issue #1502). The
    export aborts on a missing directory, so this also pins that the chain is
    installed before the CLI's first unit of work."""
    structlog.reset_defaults()
    try:
        with pytest.raises(FileNotFoundError):
            await _main(
                CliArgs(eval_model=None, export_dataset=tmp_path / "gone" / "d.yaml")
            )
        processors = structlog.get_config()["processors"]
    finally:
        configure_structlog()

    assert structlog.processors.format_exc_info in processors
    assert isinstance(processors[-1], structlog.processors.JSONRenderer)


def test_configure_structlog_leaves_an_existing_configuration_alone() -> None:
    """`capture_logs` swaps the configured processors out for its own capture
    (structlog 26.1.0 mutates the configured list in place, then calls
    `configure`), so a late process-start call must not overwrite it."""
    with testing.capture_logs() as captured:
        configure_structlog()
        get_logger("test_logger_reconfigure").info("hello")

    assert captured[0]["event"] == "hello"
