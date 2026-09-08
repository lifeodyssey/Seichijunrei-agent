"""How an eval dataset's cases divide into behavior-family strata.

Split out of ``stats.py`` (#1493): that module is the deterministic statistics
the gates compare with, and this one is the dataset-reading concept those
statistics take as an input. Nothing here does arithmetic; nothing there reads
a file.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

#: The stratum a case falls into when the dataset does not name one.
UNSTRATIFIED = "unstratified"


class MalformedEvalDataset(ValueError):
    """A dataset row the gate cannot stratify by: no id, or a broken path column."""


@dataclass(frozen=True)
class CaseStrata:
    """Case-id to behavior-path strata, and what the run must say about them."""

    by_case: dict[str, str]
    warnings: list[str]


def load_case_strata(path: Path) -> CaseStrata:
    """Load case-id to behavior-path strata from an eval dataset."""
    return case_strata_from_text(path.read_text(), path.stem)


def case_strata_from_text(text: str, dataset: str) -> CaseStrata:
    """Strata for one dataset; a set with no ``path`` column is one stratum.

    Five of the eight canonical sets carry no ``path`` (#1478):
    ``injection_g1_v1``, ``input_guard_v1``, ``phase1c_selection_v1``,
    ``runtime_journey_v1`` and ``translation_v1``. Refusing them would leave
    those sets ungateable; stratifying them by a column that is not there is
    impossible. So they pool: every case lands in ``UNSTRATIFIED``, exactly as
    ``bootstrap_gate`` already treats a case the strata do not name, and the run
    carries a warning saying the interval is pooled.
    """
    rows = _dataset_rows(text, dataset)
    stratified = any(_carries_path(row) for row in rows)
    by_case = dict(
        _stratum_entry(row, index, dataset, stratified=stratified)
        for index, row in enumerate(rows)
    )
    if stratified:
        return CaseStrata(by_case, [])
    return CaseStrata(by_case, [pooled_stratum_warning(dataset)])


def pooled_stratum_warning(dataset: str) -> str:
    """The line a pooled run says for itself, on both runners."""
    return (
        f'{dataset}: no "path" column, so every case pools into one stratum '
        "and the interval is unstratified"
    )


def _dataset_rows(text: str, dataset: str) -> list[object]:
    parsed = _parsed_dataset(text, dataset)
    if not isinstance(parsed, list):
        raise MalformedEvalDataset(f"{dataset}: an eval dataset must be a list of rows")
    return list(parsed)


def _parsed_dataset(text: str, dataset: str) -> object:
    """A dataset that is not JSON refuses by NAME, like every other refusal here.

    ``JSONDecodeError`` names no dataset and its wording ("Expecting ','
    delimiter") matches nothing ``JSON.parse`` says, so it can be neither traced
    back to a set nor compared across the two runners. The cause is chained for
    whoever has to open the file.
    """
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise MalformedEvalDataset(f"{dataset}: invalid JSON") from exc


def _carries_path(row: object) -> bool:
    return isinstance(row, dict) and "path" in row


def _stratum_entry(
    row: object, index: int, dataset: str, *, stratified: bool
) -> tuple[str, str]:
    case_id = _row_text(row, "id", index, dataset)
    if not stratified:
        return case_id, UNSTRATIFIED
    return case_id, _row_text(row, "path", index, dataset)


def _row_text(row: object, field: str, index: int, dataset: str) -> str:
    value = row.get(field) if isinstance(row, dict) else None
    if isinstance(value, str):
        return value
    raise MalformedEvalDataset(f'{dataset}: row {index} has no string "{field}"')
