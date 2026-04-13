"""Unit tests for eval_common shared infrastructure."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.tests.eval.eval_common import (
    CASE_TIMEOUT_S,
    EvalCase,
    enforce_gate,
    load_dataset,
    read_baseline,
    write_baseline,
)


def test_case_timeout_is_60() -> None:
    assert CASE_TIMEOUT_S == 60


class TestLoadDataset:
    def test_returns_typed_eval_case_objects(self, tmp_path: Path) -> None:
        dataset = [
            {
                "id": "test-01",
                "query": "test query",
                "locale": "ja",
                "expected_steps": ["resolve_anime", "search_bangumi"],
                "expected_intent": "search_bangumi",
            },
        ]
        path = tmp_path / "dataset.json"
        path.write_text(json.dumps(dataset))

        cases = load_dataset(path)

        assert len(cases) == 1
        case = cases[0]
        assert isinstance(case, EvalCase)
        assert case.id == "test-01"
        assert case.query == "test query"
        assert case.locale == "ja"
        assert case.expected_steps == ["resolve_anime", "search_bangumi"]
        assert case.expected_intent == "search_bangumi"

    def test_returns_multiple_cases(self, tmp_path: Path) -> None:
        dataset = [
            {
                "id": f"case-{i:02d}",
                "query": f"query {i}",
                "locale": "en",
                "expected_steps": ["greet_user"],
                "expected_intent": "greet",
            }
            for i in range(3)
        ]
        path = tmp_path / "dataset.json"
        path.write_text(json.dumps(dataset))

        cases = load_dataset(path)
        assert len(cases) == 3

    def test_raises_on_missing_file(self) -> None:
        with pytest.raises(FileNotFoundError):
            load_dataset(Path("/nonexistent/dataset.json"))


class TestReadBaseline:
    def test_returns_empty_dict_when_no_file(self, tmp_path: Path) -> None:
        result = read_baseline("plan_quality", "test-model", baselines_dir=tmp_path)
        assert result == {}

    def test_returns_scores_from_file(self, tmp_path: Path) -> None:
        payload = {
            "model": "test-model",
            "case_count": 10,
            "scores": {"StepsMatch": 0.8, "IntentMatch": 0.9},
        }
        path = tmp_path / "plan_quality_test-model.json"
        path.write_text(json.dumps(payload))

        result = read_baseline("plan_quality", "test-model", baselines_dir=tmp_path)
        assert result == {"StepsMatch": 0.8, "IntentMatch": 0.9}

    def test_returns_empty_dict_when_stale_case_count(self, tmp_path: Path) -> None:
        payload = {
            "model": "test-model",
            "case_count": 10,
            "scores": {"StepsMatch": 0.8},
        }
        path = tmp_path / "plan_quality_test-model.json"
        path.write_text(json.dumps(payload))

        result = read_baseline(
            "plan_quality",
            "test-model",
            baselines_dir=tmp_path,
            expected_case_count=20,
        )
        assert result == {}


class TestWriteBaseline:
    def test_round_trip(self, tmp_path: Path) -> None:
        scores = {"StepsMatch": 0.85, "IntentMatch": 0.92}
        write_baseline(
            "plan_quality", "my-model", scores, case_count=50, baselines_dir=tmp_path
        )

        result = read_baseline(
            "plan_quality", "my-model", baselines_dir=tmp_path, expected_case_count=50
        )
        assert result == scores

    def test_creates_directory_if_missing(self, tmp_path: Path) -> None:
        baselines_dir = tmp_path / "nested" / "baselines"
        write_baseline(
            "layer1",
            "model-x",
            {"score": 1.0},
            case_count=5,
            baselines_dir=baselines_dir,
        )
        assert (baselines_dir / "layer1_model-x.json").exists()


class TestEnforceGate:
    def test_returns_empty_list_when_passing(self) -> None:
        current = {"StepsMatch": 0.80, "IntentMatch": 0.90}
        baseline = {"StepsMatch": 0.85, "IntentMatch": 0.90}

        failures = enforce_gate(current, baseline, tolerance=0.10)
        assert failures == []

    def test_returns_failure_strings_on_regression(self) -> None:
        current = {"StepsMatch": 0.60, "IntentMatch": 0.90}
        baseline = {"StepsMatch": 0.85, "IntentMatch": 0.90}

        failures = enforce_gate(current, baseline, tolerance=0.10)
        assert len(failures) == 1
        assert "StepsMatch" in failures[0]

    def test_empty_baseline_returns_no_failures(self) -> None:
        current = {"StepsMatch": 0.50}
        failures = enforce_gate(current, {}, tolerance=0.10)
        assert failures == []

    def test_multiple_regressions(self) -> None:
        current = {"A": 0.50, "B": 0.40}
        baseline = {"A": 0.80, "B": 0.80}

        failures = enforce_gate(current, baseline, tolerance=0.10)
        assert len(failures) == 2
