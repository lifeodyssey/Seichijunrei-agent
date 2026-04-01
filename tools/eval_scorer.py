"""Batch LLM judge: scores unscored request_log rows.

Usage:
    uv run python tools/eval_scorer.py
    uv run python tools/eval_scorer.py --limit 50 --model openai:gpt-4o-mini
"""

from __future__ import annotations

import asyncio
import os
import sys
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()

_DEFAULT_MODEL = os.environ.get(
    "EVAL_MODEL", "openai:qwen3.5-9b@http://localhost:1234/v1"
)


@dataclass
class _ScoreOutput:
    score: float
    reasoning: str


_SCORER_PROMPT = """
You are an eval judge for an anime pilgrimage search assistant.

Given a user query and the list of tool steps the system chose to execute,
score how well the steps match what the user intended:

- 1.0: steps perfectly match intent (e.g. "find spots" → [resolve_anime, search_bangumi])
- 0.7: steps mostly correct but missing an optional step
- 0.3: steps partially relevant
- 0.0: completely wrong steps

Respond with a JSON object: {"score": <float>, "reasoning": "<one sentence>"}
""".strip()


async def score_row(row: dict, model: object) -> float:
    from pydantic_ai import Agent
    from pydantic_ai.models.openai import OpenAIModel
    from pydantic_ai.providers.openai import OpenAIProvider

    if isinstance(model, str) and "@" in model:
        name, base_url = model.split("@", 1)
        name = name.removeprefix("openai:")
        _model = OpenAIModel(name, provider=OpenAIProvider(base_url=base_url))
    else:
        _model = model

    agent: Agent[None, _ScoreOutput] = Agent(
        _model,
        system_prompt=_SCORER_PROMPT,
        output_type=_ScoreOutput,
        retries=1,
    )

    steps = row.get("plan_steps") or []
    if isinstance(steps, str):
        import json

        steps = json.loads(steps)

    prompt = (
        f"Query ({row.get('locale','ja')}): {row['query_text']}\n"
        f"Plan steps: {steps}\n"
        f"Intent: {row.get('intent','unknown')}"
    )
    result = await agent.run(prompt)
    return max(0.0, min(1.0, result.output.score))


async def run(limit: int = 200, model_id: str | None = None) -> None:
    from infrastructure.supabase.client import SupabaseClient
    import asyncpg

    db_url = os.environ["DATABASE_URL"]
    pool = await asyncpg.create_pool(db_url, min_size=1, max_size=3)
    client = SupabaseClient.__new__(SupabaseClient)
    client.pool = pool

    model = model_id or _DEFAULT_MODEL
    rows = await client.fetch_request_log_unscored(limit=limit)
    print(f"Scoring {len(rows)} unscored rows with model={model}")

    scored = 0
    for row in rows:
        try:
            score = await score_row(row, model)
            await client.update_request_log_score(log_id=str(row["id"]), score=score)
            scored += 1
            print(
                f"  [{scored}/{len(rows)}] {row['query_text'][:50]:50s} → {score:.2f}"
            )
        except Exception as exc:
            print(f"  SKIP {row['id']}: {exc}", file=sys.stderr)

    await pool.close()
    print(f"\nDone. Scored {scored}/{len(rows)} rows.")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=200)
    parser.add_argument("--model", type=str, default=None)
    args = parser.parse_args()
    asyncio.run(run(limit=args.limit, model_id=args.model))
