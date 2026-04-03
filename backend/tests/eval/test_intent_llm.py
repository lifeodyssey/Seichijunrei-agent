"""Integration tests for IntentAgent using pydantic_evals + pluggable models.

Runs 55 cases through the full classify_intent pipeline (regex + LLM fallback).
Model is configurable via EVAL_MODEL env var or --eval-model CLI arg.

Usage:
    # Local LM Studio (default)
    uv run python tests/eval/test_intent_llm.py

    # Gemini
    uv run python tests/eval/test_intent_llm.py --eval-model gemini-3.1-flash-lite

    # Any OpenAI-compatible endpoint
    EVAL_MODEL=openai:gpt-4o-mini uv run python tests/eval/test_intent_llm.py

    # pytest
    EVAL_MODEL=gemini-3.1-flash-lite uv run python -m pytest tests/eval/test_intent_llm.py -v -m integration --no-cov
"""

from __future__ import annotations

import asyncio
import os
import sys
from dataclasses import dataclass
from typing import Any

import pytest
from backend.agents.intent_agent import IntentOutput, classify_intent
from dotenv import load_dotenv
from pydantic_evals import Case, Dataset
from pydantic_evals.evaluators import Evaluator, EvaluatorContext

load_dotenv()

# ── Pluggable model factory ─────────────────────────────────────────


def make_model(model_id: str | None = None) -> Any:
    """Create a pydantic-ai model from a model identifier string.

    Supported formats:
        "lm-studio"                     → local LM Studio (qwen/qwen3.5-9b)
        "lm-studio:model-name"          → local LM Studio with specific model
        "gemini-3.1-flash-lite"         → Google Gemini via API key
        "gemini-*"                      → any Gemini model
        "openai:gpt-4o-mini"            → OpenAI
        "anthropic:claude-sonnet-4-..."  → Anthropic

    Falls back to env var EVAL_MODEL, then to "lm-studio".
    """
    model_id = model_id or os.environ.get("EVAL_MODEL", "lm-studio")

    if model_id.startswith("lm-studio"):
        from pydantic_ai.models.openai import OpenAIChatModel
        from pydantic_ai.providers.openai import OpenAIProvider

        lm_model_name = (
            model_id.split(":", 1)[1] if ":" in model_id else "qwen/qwen3.5-9b"
        )
        return OpenAIChatModel(
            lm_model_name,
            provider=OpenAIProvider(
                base_url=os.environ.get("LM_STUDIO_URL", "http://localhost:1234/v1"),
                api_key="lm-studio",
            ),
        )

    if model_id.startswith("gemini"):
        from pydantic_ai.models.google import GoogleModel
        from pydantic_ai.providers.google import GoogleProvider

        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY env var required for Gemini models")
        return GoogleModel(model_id, provider=GoogleProvider(api_key=api_key))

    # Default: pass as pydantic-ai model string (e.g. "openai:gpt-4o-mini")
    return model_id


# Resolve model at module load
_EVAL_MODEL_ID = os.environ.get("EVAL_MODEL", "lm-studio")
EVAL_MODEL = make_model(_EVAL_MODEL_ID)


# ── Custom Evaluators ────────────────────────────────────────────────


@dataclass
class IntentMatchEvaluator(Evaluator[str, IntentOutput, dict[str, Any]]):
    """Check if predicted intent matches expected intent."""

    async def evaluate(
        self, ctx: EvaluatorContext[str, IntentOutput, dict[str, Any]]
    ) -> float:
        expected = ctx.expected_output
        if expected is None:
            return 1.0
        if ctx.output.intent == expected.get("intent"):
            return 1.0
        return 0.0


@dataclass
class ParamsEvaluator(Evaluator[str, IntentOutput, dict[str, Any]]):
    """Check if extracted params match expected params (partial match OK)."""

    async def evaluate(
        self, ctx: EvaluatorContext[str, IntentOutput, dict[str, Any]]
    ) -> float:
        expected = ctx.expected_output
        if expected is None:
            return 1.0
        expected_params = expected.get("params", {})
        if not expected_params:
            return 1.0

        actual = ctx.output.extracted_params.model_dump(exclude_none=True)
        matched = sum(
            1 for k, v in expected_params.items() if str(actual.get(k, "")) == str(v)
        )
        total = len(expected_params)
        return matched / total if total > 0 else 1.0


# ── Task function ────────────────────────────────────────────────────


async def classify_with_model(text: str) -> IntentOutput:
    """Classify intent using the full pipeline with the configured model."""
    return await classify_intent(text, model=EVAL_MODEL)


# ── Test Cases ───────────────────────────────────────────────────────
# Cases are organized by intent type.
# "regex_path" metadata=True means regex should handle it.
# "regex_path" metadata=False means it MUST go through LLM.

CASES = [
    # ── search_by_bangumi (regex-matchable) ──────────────────────────
    Case(
        name="bangumi_cn_01",
        inputs="秒速5厘米的取景地在哪",
        expected_output={"intent": "search_by_bangumi", "params": {"bangumi": "927"}},
        metadata={"regex_path": True, "lang": "cn"},
    ),
    Case(
        name="bangumi_ja_01",
        inputs="君の名は。の聖地を教えて",
        expected_output={
            "intent": "search_by_bangumi",
            "params": {"bangumi": "160209"},
        },
        metadata={"regex_path": True, "lang": "ja"},
    ),
    Case(
        name="bangumi_cn_02",
        inputs="你的名字取景地",
        expected_output={
            "intent": "search_by_bangumi",
            "params": {"bangumi": "160209"},
        },
        metadata={"regex_path": True, "lang": "cn"},
    ),
    Case(
        name="bangumi_cn_03",
        inputs="天气之子的圣地巡礼",
        expected_output={
            "intent": "search_by_bangumi",
            "params": {"bangumi": "269235"},
        },
        metadata={"regex_path": True, "lang": "cn"},
    ),
    Case(
        name="bangumi_cn_04",
        inputs="铃芽之旅的取景地有哪些",
        expected_output={
            "intent": "search_by_bangumi",
            "params": {"bangumi": "362577"},
        },
        metadata={"regex_path": True, "lang": "cn"},
    ),
    Case(
        name="bangumi_cn_05",
        inputs="言叶之庭在哪里取景的",
        expected_output={"intent": "search_by_bangumi", "params": {"bangumi": "58949"}},
        metadata={"regex_path": True, "lang": "cn"},
    ),
    Case(
        name="bangumi_cn_06",
        inputs="吹响吧上低音号的圣地",
        expected_output={
            "intent": "search_by_bangumi",
            "params": {"bangumi": "115908"},
        },
        metadata={"regex_path": True, "lang": "cn"},
    ),
    Case(
        name="bangumi_ja_02",
        inputs="響け！ユーフォニアムの聖地巡礼スポット",
        expected_output={
            "intent": "search_by_bangumi",
            "params": {"bangumi": "115908"},
        },
        metadata={"regex_path": True, "lang": "ja"},
    ),
    Case(
        name="bangumi_cn_07",
        inputs="凉宫春日的忧郁取景地",
        expected_output={"intent": "search_by_bangumi", "params": {"bangumi": "485"}},
        metadata={"regex_path": True, "lang": "cn"},
    ),
    Case(
        name="bangumi_cn_08",
        inputs="轻音少女的圣地在哪",
        expected_output={"intent": "search_by_bangumi", "params": {"bangumi": "1424"}},
        metadata={"regex_path": True, "lang": "cn"},
    ),
    Case(
        name="bangumi_cn_09",
        inputs="冰菓的取景地",
        expected_output={"intent": "search_by_bangumi", "params": {"bangumi": "27364"}},
        metadata={"regex_path": True, "lang": "cn"},
    ),
    Case(
        name="bangumi_cn_10",
        inputs="玉子市场圣地巡礼",
        expected_output={"intent": "search_by_bangumi", "params": {"bangumi": "55113"}},
        metadata={"regex_path": True, "lang": "cn"},
    ),
    # ── search_by_bangumi (LLM-only, natural language) ───────────────
    Case(
        name="bangumi_llm_01",
        inputs="我想去看看新海诚电影里出现过的地方",
        expected_output={"intent": "search_by_bangumi", "params": {}},
        metadata={"regex_path": False, "lang": "cn"},
    ),
    Case(
        name="bangumi_llm_02",
        inputs="那个在飞騨高山取景的动漫叫什么来着，我想去看看",
        expected_output={"intent": "search_by_bangumi", "params": {}},
        metadata={"regex_path": False, "lang": "cn"},
    ),
    Case(
        name="bangumi_llm_03",
        inputs="京アニの作品で宇治が舞台のやつ、聖地どこ？",
        expected_output={"intent": "search_by_bangumi", "params": {}},
        metadata={"regex_path": False, "lang": "ja"},
    ),
    # ── search_by_bangumi + episode ──────────────────────────────────
    Case(
        name="episode_cn_01",
        inputs="吹响第3集出现的地方",
        expected_output={
            "intent": "search_by_bangumi",
            "params": {"bangumi": "115908", "episode": 3},
        },
        metadata={"regex_path": True, "lang": "cn"},
    ),
    Case(
        name="episode_cn_02",
        inputs="秒速5厘米第1话的场景",
        expected_output={
            "intent": "search_by_bangumi",
            "params": {"bangumi": "927", "episode": 1},
        },
        metadata={"regex_path": True, "lang": "cn"},
    ),
    Case(
        name="episode_ja_01",
        inputs="君の名は。の第5話に出てくる場所",
        expected_output={
            "intent": "search_by_bangumi",
            "params": {"bangumi": "160209", "episode": 5},
        },
        metadata={"regex_path": True, "lang": "ja"},
    ),
    Case(
        name="episode_llm_01",
        inputs="吹响上低音号里面有一集在大吉山展望台的是第几集",
        expected_output={
            "intent": "search_by_bangumi",
            "params": {"bangumi": "115908"},
        },
        metadata={"regex_path": False, "lang": "cn"},
    ),
    # ── search_by_location (regex-matchable) ─────────────────────────
    Case(
        name="location_cn_01",
        inputs="宇治附近有什么圣地",
        expected_output={
            "intent": "search_by_location",
            "params": {"location": "宇治"},
        },
        metadata={"regex_path": True, "lang": "cn"},
    ),
    Case(
        name="location_ja_01",
        inputs="東京駅の近くにあるアニメ聖地",
        expected_output={
            "intent": "search_by_location",
            "params": {"location": "東京駅"},
        },
        metadata={"regex_path": True, "lang": "ja"},
    ),
    Case(
        name="location_ja_02",
        inputs="新宿周辺のアニメスポット",
        expected_output={
            "intent": "search_by_location",
            "params": {"location": "新宿"},
        },
        metadata={"regex_path": True, "lang": "ja"},
    ),
    Case(
        name="location_cn_02",
        inputs="京都有哪些动漫取景地",
        expected_output={
            "intent": "search_by_location",
            "params": {"location": "京都"},
        },
        metadata={"regex_path": True, "lang": "cn"},
    ),
    Case(
        name="location_ja_03",
        inputs="飛騨高山周辺の聖地",
        expected_output={
            "intent": "search_by_location",
            "params": {"location": "飛騨高山"},
        },
        metadata={"regex_path": True, "lang": "ja"},
    ),
    Case(
        name="location_cn_03",
        inputs="秋叶原附近的圣地巡礼点",
        expected_output={
            "intent": "search_by_location",
            "params": {"location": "秋叶原"},
        },
        metadata={"regex_path": True, "lang": "cn"},
    ),
    # ── search_by_location (LLM-only) ───────────────────────────────
    Case(
        name="location_llm_01",
        inputs="东京有没有什么动漫相关的景点可以逛",
        expected_output={
            "intent": "search_by_location",
            "params": {"location": "东京"},
        },
        metadata={"regex_path": False, "lang": "cn"},
    ),
    Case(
        name="location_llm_02",
        inputs="大阪で聖地巡礼できるところある？",
        expected_output={
            "intent": "search_by_location",
            "params": {"location": "大阪"},
        },
        metadata={"regex_path": False, "lang": "ja"},
    ),
    Case(
        name="location_llm_03",
        inputs="我在镰仓旅游，这边有什么动漫圣地吗",
        expected_output={
            "intent": "search_by_location",
            "params": {"location": "镰仓"},
        },
        metadata={"regex_path": False, "lang": "cn"},
    ),
    Case(
        name="location_llm_04",
        inputs="名古屋あたりでアニメの聖地ってある？",
        expected_output={
            "intent": "search_by_location",
            "params": {"location": "名古屋"},
        },
        metadata={"regex_path": False, "lang": "ja"},
    ),
    # ── plan_route (regex-matchable) ─────────────────────────────────
    Case(
        name="route_cn_01",
        inputs="从京都站出发去吹响的圣地",
        expected_output={
            "intent": "plan_route",
            "params": {"origin": "京都站", "bangumi": "115908"},
        },
        metadata={"regex_path": True, "lang": "cn"},
    ),
    Case(
        name="route_ja_01",
        inputs="東京駅から君の名はの聖地を回るルート",
        expected_output={
            "intent": "plan_route",
            "params": {"origin": "東京駅", "bangumi": "160209"},
        },
        metadata={"regex_path": True, "lang": "ja"},
    ),
    Case(
        name="route_cn_02",
        inputs="帮我规划从新宿到天气之子取景地的路线",
        expected_output={
            "intent": "plan_route",
            "params": {"origin": "新宿", "bangumi": "269235"},
        },
        metadata={"regex_path": True, "lang": "cn"},
    ),
    Case(
        name="route_ja_02",
        inputs="宇治駅から響けユーフォの聖地巡りルートを作って",
        expected_output={
            "intent": "plan_route",
            "params": {"origin": "宇治駅", "bangumi": "115908"},
        },
        metadata={"regex_path": True, "lang": "ja"},
    ),
    # ── plan_route (LLM-only) ────────────────────────────────────────
    Case(
        name="route_llm_01",
        inputs="能不能帮我安排一条从涩谷出发看天气之子取景地的路线",
        expected_output={"intent": "plan_route", "params": {"bangumi": "269235"}},
        metadata={"regex_path": False, "lang": "cn"},
    ),
    Case(
        name="route_llm_02",
        inputs="京都で一日で響けユーフォの聖地を全部回れるプランを教えて",
        expected_output={"intent": "plan_route", "params": {"bangumi": "115908"}},
        metadata={"regex_path": False, "lang": "ja"},
    ),
    Case(
        name="route_llm_03",
        inputs="我明天去东京，想用一天时间把你的名字的取景地都走一遍",
        expected_output={"intent": "plan_route", "params": {"bangumi": "160209"}},
        metadata={"regex_path": False, "lang": "cn"},
    ),
    Case(
        name="route_llm_04",
        inputs="秒速5厘米的圣地分布在哪些地方，怎么安排路线比较好",
        expected_output={"intent": "plan_route", "params": {"bangumi": "927"}},
        metadata={"regex_path": False, "lang": "cn"},
    ),
    # ── general_qa (regex-matchable) ─────────────────────────────────
    Case(
        name="qa_cn_01",
        inputs="圣地巡礼是什么意思",
        expected_output={"intent": "general_qa", "params": {}},
        metadata={"regex_path": True, "lang": "cn"},
    ),
    Case(
        name="qa_ja_01",
        inputs="聖地巡礼のマナーを教えて",
        expected_output={"intent": "general_qa", "params": {}},
        metadata={"regex_path": True, "lang": "ja"},
    ),
    Case(
        name="qa_cn_02",
        inputs="日本动漫圣地巡礼需要注意什么",
        expected_output={"intent": "general_qa", "params": {}},
        metadata={"regex_path": True, "lang": "cn"},
    ),
    # ── general_qa (LLM-only) ────────────────────────────────────────
    Case(
        name="qa_llm_01",
        inputs="圣地巡礼一般要花多少钱",
        expected_output={"intent": "general_qa", "params": {}},
        metadata={"regex_path": False, "lang": "cn"},
    ),
    Case(
        name="qa_llm_02",
        inputs="聖地巡礼って一人で行っても楽しめる？",
        expected_output={"intent": "general_qa", "params": {}},
        metadata={"regex_path": False, "lang": "ja"},
    ),
    Case(
        name="qa_llm_03",
        inputs="去日本圣地巡礼要办什么签证",
        expected_output={"intent": "general_qa", "params": {}},
        metadata={"regex_path": False, "lang": "cn"},
    ),
    Case(
        name="qa_llm_04",
        inputs="アニメの聖地巡礼で写真撮影は許可されてる？",
        expected_output={"intent": "general_qa", "params": {}},
        metadata={"regex_path": False, "lang": "ja"},
    ),
    Case(
        name="qa_llm_05",
        inputs="圣地巡礼的时候住哪里比较方便",
        expected_output={"intent": "general_qa", "params": {}},
        metadata={"regex_path": False, "lang": "cn"},
    ),
    # ── unclear ──────────────────────────────────────────────────────
    Case(
        name="unclear_cn_01",
        inputs="推荐一下",
        expected_output={"intent": "unclear", "params": {}},
        metadata={"regex_path": False, "lang": "cn"},
    ),
    Case(
        name="unclear_cn_02",
        inputs="你好",
        expected_output={"intent": "unclear", "params": {}},
        metadata={"regex_path": True, "lang": "cn"},
    ),
    Case(
        name="unclear_ja_01",
        inputs="おすすめ",
        expected_output={"intent": "unclear", "params": {}},
        metadata={"regex_path": False, "lang": "ja"},
    ),
    Case(
        name="unclear_llm_01",
        inputs="帮帮我",
        expected_output={"intent": "unclear", "params": {}},
        metadata={"regex_path": False, "lang": "cn"},
    ),
    Case(
        name="unclear_llm_02",
        inputs="ちょっと聞きたいんだけど",
        expected_output={"intent": "unclear", "params": {}},
        metadata={"regex_path": False, "lang": "ja"},
    ),
    # ── combo (bangumi + location) ───────────────────────────────────
    Case(
        name="combo_cn_01",
        inputs="京都的冰菓取景地",
        expected_output={"intent": "search_by_bangumi", "params": {"bangumi": "27364"}},
        metadata={"regex_path": True, "lang": "cn"},
    ),
    Case(
        name="combo_ja_01",
        inputs="宇治にある響けユーフォの聖地",
        expected_output={
            "intent": "search_by_bangumi",
            "params": {"bangumi": "115908"},
        },
        metadata={"regex_path": True, "lang": "ja"},
    ),
    Case(
        name="combo_llm_01",
        inputs="东京都内有没有你的名字里出现过的地方",
        expected_output={
            "intent": "search_by_bangumi",
            "params": {"bangumi": "160209"},
        },
        metadata={"regex_path": False, "lang": "cn"},
    ),
    Case(
        name="combo_llm_02",
        inputs="京都市内で氷菓のロケ地になった場所を知りたい",
        expected_output={"intent": "search_by_bangumi", "params": {"bangumi": "27364"}},
        metadata={"regex_path": False, "lang": "ja"},
    ),
    Case(
        name="combo_llm_03",
        inputs="我在宇治旅游，这附近有吹响上低音号的取景地吗",
        expected_output={
            "intent": "search_by_bangumi",
            "params": {"bangumi": "115908"},
        },
        metadata={"regex_path": False, "lang": "cn"},
    ),
]


# ── Dataset ──────────────────────────────────────────────────────────

intent_dataset = Dataset(
    name="intent_classification_eval",
    cases=CASES,
    evaluators=[IntentMatchEvaluator(), ParamsEvaluator()],
)


# ── Pytest integration ───────────────────────────────────────────────


@pytest.mark.integration
def test_intent_classification_eval():
    """Run full intent classification eval against configured model."""
    report = intent_dataset.evaluate_sync(
        classify_with_model,
        name=f"intent_eval_{_EVAL_MODEL_ID}",
        max_concurrency=1,
    )
    report.print(include_input=True, include_output=True)

    avg = report.averages()
    intent_score = avg.scores.get("IntentMatchEvaluator", 0)
    params_score = avg.scores.get("ParamsEvaluator", 0)

    print(f"\n{'=' * 60}")
    print(f"  Model:            {_EVAL_MODEL_ID}")
    print(f"  Intent accuracy:  {intent_score:.1%}")
    print(f"  Params accuracy:  {params_score:.1%}")
    print(f"  Total cases:      {len(CASES)}")
    print(f"{'=' * 60}")

    assert intent_score >= 0.70, (
        f"Intent accuracy {intent_score:.1%} below 70% threshold"
    )


# ── Standalone runner ────────────────────────────────────────────────

if __name__ == "__main__":
    # Support --eval-model CLI arg
    model_arg = None
    for i, arg in enumerate(sys.argv[1:], 1):
        if arg == "--eval-model" and i < len(sys.argv):
            model_arg = sys.argv[i + 1]
            break
        if arg.startswith("--eval-model="):
            model_arg = arg.split("=", 1)[1]
            break

    if model_arg:
        _EVAL_MODEL_ID = model_arg  # noqa: F841 — used in main()
        EVAL_MODEL = make_model(model_arg)  # noqa: F841

    async def main():
        _mid = model_arg or _EVAL_MODEL_ID
        _model = make_model(model_arg) if model_arg else EVAL_MODEL

        async def _task(text: str) -> IntentOutput:
            return await classify_intent(text, model=_model)

        report = await intent_dataset.evaluate(
            _task,
            name=f"intent_eval_{_mid}",
            max_concurrency=1,
        )
        report.print(include_input=True, include_output=True)

        avg = report.averages()
        intent_score = avg.scores.get("IntentMatchEvaluator", 0)
        params_score = avg.scores.get("ParamsEvaluator", 0)
        print(f"\n  Model: {_mid}")
        print(
            f"  Intent: {intent_score:.1%}  Params: {params_score:.1%}  Cases: {len(CASES)}"
        )

    asyncio.run(main())
