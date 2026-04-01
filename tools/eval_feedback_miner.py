"""Mine bad-feedback rows and suggest prompt improvements.

Usage:
    uv run python tools/eval_feedback_miner.py
    uv run python tools/eval_feedback_miner.py --limit 50 --output suggestions.md
"""

from __future__ import annotations

import asyncio
import os
import sys
from dataclasses import dataclass, field

from dotenv import load_dotenv

load_dotenv()

_DEFAULT_MODEL = os.environ.get(
    "EVAL_MODEL", "openai:qwen3.5-9b@http://localhost:1234/v1"
)


@dataclass
class _PromptSuggestion:
    issue_summary: str
    affected_queries: list[str]
    suggested_prompt_change: str
    confidence: float


@dataclass
class _MinerOutput:
    suggestions: list[_PromptSuggestion] = field(default_factory=list)


_MINER_PROMPT = """
You are an AI system improver for an anime pilgrimage search assistant.

You are given a list of queries where users gave a thumbs-down rating.
Identify patterns in these failures and suggest specific changes to the
planner agent's system prompt that would fix them.

For each distinct pattern, output a suggestion with:
- issue_summary: short description of the failure pattern
- affected_queries: 2-3 representative queries
- suggested_prompt_change: the exact text to add/change in the system prompt
- confidence: how confident you are this change would help (0.0-1.0)

Be concrete. Output JSON matching the schema.
""".strip()


async def mine(
    limit: int = 100, model_id: str | None = None
) -> list[_PromptSuggestion]:
    from pydantic_ai import Agent
    from pydantic_ai.models.openai import OpenAIModel
    from pydantic_ai.providers.openai import OpenAIProvider
    from infrastructure.supabase.client import SupabaseClient
    import asyncpg

    db_url = os.environ["DATABASE_URL"]
    pool = await asyncpg.create_pool(db_url, min_size=1, max_size=2)
    client = SupabaseClient.__new__(SupabaseClient)
    client.pool = pool
    rows = await client.fetch_bad_feedback(limit=limit)
    await pool.close()

    if not rows:
        print("No bad feedback rows found.")
        return []

    model = model_id or _DEFAULT_MODEL
    if isinstance(model, str) and "@" in model:
        name, base_url = model.split("@", 1)
        name = name.removeprefix("openai:")
        _model = OpenAIModel(name, provider=OpenAIProvider(base_url=base_url))
    else:
        _model = model

    agent: Agent[None, _MinerOutput] = Agent(
        _model, system_prompt=_MINER_PROMPT, output_type=_MinerOutput, retries=2
    )

    query_list = "\n".join(
        f"- [{r.get('intent','?')}] {r['query_text']}"
        + (f" // {r['comment']}" if r.get("comment") else "")
        for r in rows
    )
    result = await agent.run(f"Bad-feedback queries ({len(rows)} total):\n{query_list}")
    return result.output.suggestions


async def run(
    limit: int = 100, model_id: str | None = None, output: str | None = None
) -> None:
    suggestions = await mine(limit=limit, model_id=model_id)
    lines: list[str] = ["# Planner Prompt Improvement Suggestions\n"]
    for i, s in enumerate(suggestions, 1):
        lines.append(f"## Suggestion {i}: {s.issue_summary}")
        lines.append(f"\n**Confidence:** {s.confidence:.0%}\n")
        lines.append("**Affected queries:**")
        for q in s.affected_queries:
            lines.append(f"- {q}")
        lines.append(
            f"\n**Suggested prompt change:**\n```\n{s.suggested_prompt_change}\n```\n"
        )
    text = "\n".join(lines)
    if output:
        with open(output, "w") as f:
            f.write(text)
        print(f"Suggestions written to {output}")
    else:
        print(text)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--model", type=str, default=None)
    parser.add_argument("--output", type=str, default=None)
    args = parser.parse_args()
    asyncio.run(run(limit=args.limit, model_id=args.model, output=args.output))
