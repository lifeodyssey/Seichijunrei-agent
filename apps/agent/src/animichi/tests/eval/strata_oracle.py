"""The strata-loading half of the oracle the TypeScript port is pinned against.

``load_case_strata`` decides two things no arithmetic fixture can pin: which
datasets are *poolable* (no ``path`` column at all → one stratum plus a warning)
and which are *malformed* (a row with no id, or a path column with a hole in it
→ a refusal, before the run spends anything). Both sides have to answer
identically, so Python's own answers — mappings, warning text and refusal text —
are recorded here for ``packages/eval/test/gate-case-strata.test.ts``.

The scenarios are raw dataset text rather than files: the strata are read from
text on both sides, and a temp file would only add a path nobody can compare.

Written through ``stats_oracle.py``, the module that owns the output file.
"""

from __future__ import annotations

from animichi.tests.eval.case_strata import (
    CaseStrata,
    MalformedEvalDataset,
    case_strata_from_text,
)

DATASET = "oracle_set"

#: name → the dataset text ``case_strata_from_text`` is asked to load.
SCENARIOS: dict[str, str] = {
    "path_column": '[{"id": "a", "path": "p"}, {"id": "b", "path": "q"}]',
    "no_path_column": '[{"id": "a"}, {"id": "b"}]',
    "partial_path_column": '[{"id": "a", "path": "p"}, {"id": "b"}]',
    "non_string_path": '[{"id": "a", "path": "p"}, {"id": "b", "path": 3}]',
    "row_without_id": '[{"id": "a", "path": "p"}, {"path": "q"}]',
    "pooled_row_without_id": '[{"id": "a"}, {}]',
    "not_a_list": '{"id": "a", "path": "p"}',
    #: Not JSON at all. The two languages' own parse errors share no wording, so
    #: only a dataset-named refusal can be pinned across both.
    "invalid_json": '[{"id": "a", "path": "p"},',
    "empty_set": "[]",
}


def _loaded(text: str) -> dict[str, object]:
    strata = case_strata_from_text(text, DATASET)
    return _strata_json(strata)


def _strata_json(strata: CaseStrata) -> dict[str, object]:
    return {"strata": strata.by_case, "warnings": strata.warnings, "error": None}


def _refused(exc: MalformedEvalDataset) -> dict[str, object]:
    return {"strata": None, "warnings": [], "error": str(exc)}


def _strata_case(name: str, text: str) -> dict[str, object]:
    try:
        answer = _loaded(text)
    except MalformedEvalDataset as exc:
        answer = _refused(exc)
    return {"name": name, "dataset": DATASET, "text": text, **answer}


def strata_sections() -> dict[str, object]:
    """The ``case_strata`` section of ``stats-oracle.json``."""
    return {
        "case_strata": [_strata_case(name, text) for name, text in SCENARIOS.items()]
    }
