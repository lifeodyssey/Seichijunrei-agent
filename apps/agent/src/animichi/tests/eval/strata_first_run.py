"""The run that loads its strata before it spends a case (#1478).

``load_case_strata`` used to run inside ``_report_gate_input``, i.e. after every
case had already been evaluated: one of the five canonical sets that carry no
``path`` column threw there, once the whole run was paid for, and no result was
written. Loading first is the whole point of this module, so the order lives in
one named place both runners call rather than in a line someone can move.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import TypeVar

from animichi.tests.eval.case_strata import CaseStrata, load_case_strata

logger = logging.getLogger(__name__)

#: What the run returns is not this module's business; the ORDER is.
Report = TypeVar("Report")


async def evaluate_after_strata(
    dataset_path: Path, evaluate: Callable[[], Awaitable[Report]]
) -> tuple[CaseStrata, Report]:
    """Validate the strata, then run: a malformed dataset refuses unspent."""
    strata = preflight_strata(dataset_path)
    return strata, await evaluate()


def preflight_strata(dataset_path: Path) -> CaseStrata:
    """Load the strata and log what a pooled dataset costs the interval."""
    strata = load_case_strata(dataset_path)
    for warning in strata.warnings:
        logger.warning(warning)
    return strata
