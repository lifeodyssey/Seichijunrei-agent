"""Export negative feedback from Supabase to pydantic-evals compatible dataset.

Usage:
    python scripts/feedback_to_eval.py --since 2026-03-01 \
        --output tests/eval/cases/feedback_regression.json

Requires SUPABASE_DB_URL in environment.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime


async def fetch_bad_feedback(dsn: str, since: str) -> list[dict]:
    """Fetch all 'bad' feedback records since the given date."""
    import asyncpg

    conn = await asyncpg.connect(dsn)
    try:
        rows = await conn.fetch(
            """
            SELECT query_text, intent, comment, created_at
            FROM feedback
            WHERE rating = 'bad' AND created_at >= $1
            ORDER BY created_at DESC
            """,
            datetime.fromisoformat(since),
        )
        return [dict(r) for r in rows]
    finally:
        await conn.close()


def to_eval_cases(feedback_rows: list[dict]) -> list[dict]:
    """Convert feedback rows to pydantic-evals compatible case format."""
    cases = []
    for row in feedback_rows:
        case = {
            "name": f"feedback_{row['created_at'].isoformat()[:19]}",
            "inputs": row["query_text"],
            "metadata": {
                "source": "user_feedback",
                "original_intent": row.get("intent"),
                "user_comment": row.get("comment"),
                "feedback_date": row["created_at"].isoformat(),
            },
        }
        # If we know the intent was wrong, mark expected intent for eval
        if row.get("intent"):
            case["expected_output"] = {"intent": row["intent"]}
        cases.append(case)
    return cases


async def main_async(args: argparse.Namespace) -> None:
    dsn = os.environ.get("SUPABASE_DB_URL")
    if not dsn:
        print("Error: SUPABASE_DB_URL environment variable is required.", file=sys.stderr)
        sys.exit(1)

    rows = await fetch_bad_feedback(dsn, args.since)
    if not rows:
        print(f"No bad feedback found since {args.since}.")
        return

    cases = to_eval_cases(rows)

    # Ensure output directory exists
    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(cases, f, ensure_ascii=False, indent=2, default=str)

    print(f"Exported {len(cases)} feedback cases to {args.output}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Export bad feedback to eval dataset")
    parser.add_argument(
        "--since",
        default="2026-01-01",
        help="ISO date to filter feedback from (default: 2026-01-01)",
    )
    parser.add_argument(
        "--output",
        default="tests/eval/cases/feedback_regression.json",
        help="Output JSON file path",
    )
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
