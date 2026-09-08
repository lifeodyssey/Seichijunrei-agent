"""The vocabulary one evaluator-oracle scenario is written in (#1301).

A scenario describes one agent turn at the level the evaluators read it: what
the case asked for, what the turn produced, and what each tool call recorded.
The scenarios themselves live in `evaluator_oracle_cases.py`; turning one into
Python objects is `evaluator_oracle_context.py`'s job, and projecting it onto
the wire shape `packages/eval/src/turn-transcript.ts` publishes is
`evaluator_oracle.py`'s.

The vocabulary is deliberately no richer than the wire. W3-2 (#1300) reads the
trajectory out of the SD-9 stream frames, which publish one `args` record per
call; E-2 (#1381) added the second record `argument_correctness` needs — the
params the tool ran with, published on the retrieval surface; and #1462 added
`model_initiated`, which the wire could not answer for until the frames a
deterministic bypass opens started carrying their own origin. A scenario that
could express more than the wire would let this oracle prove a parity the
TypeScript side has no way to reach, so the rule is unchanged even though this
member no longer falls foul of it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

StepStatus = Literal["ok", "error", "unsettled"]
"""How a call ended. `unsettled` = the stream said it was made, never how it
ended; the span-tree ports treat it as not-successful, exactly like `error`."""

StepOrigin = Literal["model", "server"]
"""Who asked for the call, in the vocabulary the frames publish (#1462).
`StepRecord.model_initiated` said as the wire says it."""


@dataclass(frozen=True)
class OracleStep:
    """One tool call: its name, the arguments published for it, its outcome."""

    tool: str
    args: dict[str, object] = field(default_factory=dict)
    status: StepStatus = "ok"
    params: dict[str, object] | None = None
    """What the tool RAN with, when the runtime settled it into something other
    than what the model asked with (#1381). `None` = the call ran with its own
    arguments, which is every scenario written before the second witness."""
    model_initiated: bool = True
    """Whether the MODEL asked for this call (#1462). `False` is a deterministic
    bypass — the runtime's own step, opened with no model arguments — which
    `OfficialArgumentCorrectness` does not score on either side."""

    @property
    def settled_params(self) -> dict[str, object]:
        """The params half of the pair: the settled ones, else the raw ones."""
        return dict(self.args if self.params is None else self.params)


@dataclass(frozen=True)
class OracleItinerary:
    """The itinerary registry entry `_nonempty` and `_available_data_keys` read."""

    ordered_point_count: int
    source_row_count: int | None
    """`None` = no usable source search entry (absent ref, or a ref that misses)."""


@dataclass(frozen=True)
class OracleScenario:
    """One case: its inputs, its expectations, and the turn it produced."""

    case_id: str
    query: str
    locale: str
    intent: str
    message: str
    acceptable_stages: list[str] = field(default_factory=list)
    steps: list[OracleStep] = field(default_factory=list)
    data_keys: list[str] = field(default_factory=list)
    expect_nonempty: bool = False
    selected_point_ids: list[str] | None = None
    selected_candidate_ids: list[str] | None = None
    seeded_pending: dict[str, object] | None = None
    clarification_id: int | None = None
    pending_clarification: bool = False
    search_row_count: int | None = None
    itinerary: OracleItinerary | None = None
