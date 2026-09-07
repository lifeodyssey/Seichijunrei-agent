from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest
from pydantic_evals import Case, Dataset
from pydantic_evals.reporting import EvaluationReport, ReportCase, ReportCaseFailure

from animichi.agents.agent_result import AgentResult
from animichi.agents.animichi_agent import animichi_agent
from animichi.infrastructure.persistence.repositories.composite import (
    PersistenceRepos,
)
from animichi.tests.eval import eval_gate_flow, run_agent_eval
from animichi.tests.eval.eval_gate_flow import finish_cli_report, gate_exit_code
from animichi.tests.eval.eval_harness import (
    DATASET_PATH,
    _agentic_tracing,
    agent_dataset,
    build_evaluators,
)
from animichi.tests.eval.evaluators import (
    AgentExpected,
    AgentInput,
    DataKeysPresent,
    LocaleMatch,
    NonemptyResults,
    StepEfficiency,
)
from animichi.tests.eval.exec_tiers import EvalTierTarget
from animichi.tests.eval.official_evaluators import (
    OfficialArgumentCorrectness,
    OfficialMaxToolCalls,
    OfficialToolCorrectness,
    OfficialTrajectoryMatch,
)
from animichi.tests.eval.run_agent_eval import (
    CliArgs,
    StreamingProgress,
    _db_source,
    _db_url,
    _export_dataset,
    _fullstack_target,
    _main,
    _parse_args,
)
from animichi.tests.eval.stats import CaseStrata


def test_fullstack_db_url_prefers_secret_test_database_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    expected = "postgresql://owner:password@ep-safe.example/neondb?sslmode=require"
    monkeypatch.setenv("EVAL_FULLSTACK", "1")
    monkeypatch.setenv("TEST_DATABASE_URL", expected)

    assert _db_url() == expected


def test_fullstack_db_url_has_no_localhost_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("EVAL_FULLSTACK", "1")
    monkeypatch.delenv("TEST_DATABASE_URL", raising=False)
    monkeypatch.delenv("TEST_DB", raising=False)

    with pytest.raises(RuntimeError) as error:
        _db_url()

    message = str(error.value)
    assert "EVAL_FULLSTACK" in message
    assert "TEST_DATABASE_URL" in message
    assert "TEST_DB" in message
    assert "localhost" not in message
    assert "spec section 3c" in message


@pytest.mark.asyncio
async def test_fullstack_target_runs_shared_byo_preflight_before_build(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db_url = "postgresql://owner:password@localhost:5432/test"
    events: list[str] = []
    monkeypatch.setenv("TEST_DATABASE_URL", db_url)
    monkeypatch.setenv("TEST_DB_ALLOW_MUTATION", "1")

    async def preflight(config: object, target: object) -> None:
        del config, target
        events.append("preflight")

    class _FakeLifecycle:
        def __init__(self) -> None:
            self.sessionmaker = MagicMock()

        async def close(self) -> None:
            events.append("close")

    def fake_build(sessionmaker: object) -> PersistenceRepos:
        del sessionmaker
        events.append("build")
        return PersistenceRepos(
            sessionmaker=MagicMock(),
            session=MagicMock(),
            turn_reservation=MagicMock(),
            bangumi=MagicMock(),
            points=MagicMock(),
            usage=MagicMock(),
            anon_quota=MagicMock(),
            feedback=MagicMock(),
            memory=MagicMock(),
            outbox=MagicMock(),
        )

    monkeypatch.setattr(run_agent_eval, "preflight_byo_database", preflight)
    monkeypatch.setattr(
        "animichi.infrastructure.persistence.database.create_database_lifecycle",
        lambda _dsn: _FakeLifecycle(),
    )
    monkeypatch.setattr(PersistenceRepos, "build", staticmethod(fake_build))
    target = await _fullstack_target()
    assert isinstance(target.db, PersistenceRepos)
    assert target.on_close is not None
    await target.on_close()
    assert events == ["preflight", "build", "close"]


@pytest.mark.asyncio
async def test_fullstack_target_refuses_protected_neon_dsn(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from animichi.tests import conftest_db
    from animichi.tests.neon_api import Branch, assert_mutable_branch

    monkeypatch.setenv(
        "TEST_DATABASE_URL",
        "postgresql://owner:secret@ep-safe.neon.tech/neondb",
    )
    monkeypatch.setenv("TEST_DB_ALLOW_MUTATION", "1")
    monkeypatch.setenv("NEON_API_KEY", "secret")
    monkeypatch.setenv("NEON_PROJECT_ID", "project-test")

    async def no_io(target: object) -> None:
        del target

    def reject_protected(config: object, target: object) -> None:
        del config, target
        assert_mutable_branch(Branch("br-main", "main", "project-test", None, True))

    monkeypatch.setattr(conftest_db, "_wake_database_async", no_io)
    monkeypatch.setattr(conftest_db, "_verify_revisions_async", no_io)
    monkeypatch.setattr(conftest_db, "_verify_capabilities_async", no_io)
    monkeypatch.setattr(conftest_db, "_verify_byo_identity", reject_protected)
    with pytest.raises(RuntimeError, match="protected Neon branch main"):
        await _fullstack_target()


def test_fullstack_db_source_logs_host_only() -> None:
    secret = "postgresql://owner:password@ep-safe.example/neondb?sslmode=require"
    source = _db_source(secret)
    assert source == "DB host: ep-safe.example"
    assert "password" not in source


@pytest.mark.parametrize(
    ("argv", "expected_model", "expected_export"),
    [
        (["--eval-model", "openai:test"], "openai:test", None),
        (["--eval-model=openai:test"], "openai:test", None),
        (["--export-dataset", "out.json"], None, Path("out.json")),
        (["--export-dataset=out.json"], None, Path("out.json")),
        ([], None, None),
    ],
)
def test_parse_args(
    argv: list[str], expected_model: str | None, expected_export: Path | None
) -> None:
    parsed = _parse_args(argv)
    assert parsed.eval_model == expected_model
    assert parsed.export_dataset == expected_export


def test_bare_export_flag_is_cli_error(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exc_info:
        _parse_args(["--export-dataset"])

    assert exc_info.value.code == 2
    assert "expected one argument" in capsys.readouterr().err


@pytest.mark.parametrize("path", [DATASET_PATH, DATASET_PATH.parent / "export.json"])
def test_export_refuses_canonical_dataset_tree(
    path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    with pytest.raises(SystemExit) as exc_info:
        _parse_args(["--export-dataset", str(path)])

    assert exc_info.value.code == 2
    assert "must not be the canonical dataset or reside under datasets/" in (
        capsys.readouterr().err
    )


@pytest.mark.asyncio
async def test_export_mode_exits_without_evaluation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output = tmp_path / "official.json"

    async def unexpected_target() -> EvalTierTarget:
        raise AssertionError("evaluation target must not be created in export mode")

    monkeypatch.setattr(run_agent_eval, "_target", unexpected_target)

    assert await _main(CliArgs(eval_model=None, export_dataset=output)) == 0
    assert output.exists()


def test_real_dataset_round_trips_with_official_first_evaluators(
    tmp_path: Path,
) -> None:
    evaluator_types = (
        OfficialArgumentCorrectness,
        OfficialToolCorrectness,
        OfficialTrajectoryMatch,
        OfficialMaxToolCalls,
        DataKeysPresent,
        LocaleMatch,
        NonemptyResults,
        StepEfficiency,
    )
    output = tmp_path / "agent-eval-official.json"

    _export_dataset(agent_dataset, output)
    loaded = Dataset[AgentInput, AgentResult, AgentExpected].from_file(
        output, custom_evaluator_types=evaluator_types
    )

    assert [(case.name, case.inputs, case.metadata) for case in loaded.cases] == [
        (case.name, case.inputs, case.metadata) for case in agent_dataset.cases
    ]
    assert [type(evaluator) for evaluator in loaded.evaluators] == list(evaluator_types)


def test_retired_legacy_evaluators_stay_absent() -> None:
    registered = {type(evaluator).__name__ for evaluator in build_evaluators()}
    assert "ToolCallRecall" not in registered
    assert "RouteOrderCorrect" not in registered


def test_streaming_progress_reports_completed_cases(
    capsys: pytest.CaptureFixture[str],
) -> None:
    progress = StreamingProgress(total=2)
    ok_input = AgentInput(query="ok", locale="en")
    error_input = AgentInput(query="error", locale="en")
    first = progress(Case(name="case-ok", inputs=ok_input))
    second = progress(Case(name="case-error", inputs=error_input))

    first_result = ReportCase(
        name="case-ok",
        inputs=ok_input,
        metadata=None,
        expected_output=None,
        output="done",
        metrics={},
        attributes={},
        scores={},
        labels={},
        assertions={},
        task_duration=0.1,
        total_duration=0.2,
    )
    failure = ReportCaseFailure(
        name="case-error",
        inputs=error_input,
        metadata=None,
        expected_output=None,
        error_message="boom\ncontinued",
        error_stacktrace="trace",
    )

    import asyncio

    asyncio.run(first.teardown(first_result))
    asyncio.run(second.teardown(failure))

    assert capsys.readouterr().err.splitlines() == [
        "[eval] id=case-ok result=ok completed=1/2 evaluated=1 errored=0",
        "[eval] id=case-error result=error error=boom continued "
        "completed=2/2 evaluated=1 errored=1",
    ]


def test_agentic_tracing_is_scoped_to_evaluation() -> None:
    previous = animichi_agent.instrument
    with _agentic_tracing():
        assert animichi_agent.instrument is True
    assert animichi_agent.instrument is previous


@pytest.mark.parametrize(
    ("failures", "expected"), [(None, 0), ([], 0), (["regression"], 1)]
)
def test_exit_code_matches_gate_verdict(
    failures: list[str] | None, expected: int
) -> None:
    assert gate_exit_code(failures) == expected


def test_capped_all_error_report_is_report_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    failure = ReportCaseFailure(
        name="only-case",
        inputs=AgentInput(query="fail", locale="en"),
        metadata=None,
        expected_output=None,
        error_message="boom",
        error_stacktrace="trace",
    )
    report = EvaluationReport(name="capped", cases=[], failures=[failure])
    target = EvalTierTarget(object(), object, "fixture", "trajectory", "fixture")
    persisted: list[dict[str, float]] = []
    monkeypatch.setattr(eval_gate_flow, "CAPPED", True)
    monkeypatch.setattr(
        eval_gate_flow,
        "persist_report",
        lambda report, target, model_id, scores, warnings: persisted.append(scores),
    )

    failures = finish_cli_report(report, target, "fixture:model", CaseStrata({}, []))

    assert failures == []
    assert persisted == [{}]
