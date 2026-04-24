"""Unit tests for typed runtime stage models.

These models are the source of truth for journey-stage payload shapes.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from backend.agents.models import TimedItinerary
from backend.agents.runtime_models import (
    ClarifyResponseModel,
    GreetingResponseModel,
    QAResponseModel,
    RouteResponseModel,
    SearchResponseModel,
)


def test_clarify_response_model_validates_candidates() -> None:
    model = ClarifyResponseModel(
        intent="clarify",
        message="你是指哪部凉宫？",
        data={
            "status": "needs_clarification",
            "question": "你是指哪部凉宫？",
            "options": ["凉宫春日的忧郁"],
            "candidates": [
                {
                    "title": "凉宫春日的忧郁",
                    "cover_url": None,
                    "spot_count": 0,
                    "city": "",
                }
            ],
        },
        ui={"component": "Clarification"},
    )
    assert model.intent == "clarify"
    assert model.data.candidates[0].title == "凉宫春日的忧郁"


def test_search_response_model_accepts_rows_and_nearby_groups() -> None:
    model = SearchResponseModel(
        intent="search_nearby",
        message="宇治站附近有 1 处相关圣地。",
        data={
            "results": {
                "rows": [
                    {
                        "id": "pt-uji-1",
                        "name": "宇治桥",
                        "name_cn": None,
                        "episode": 1,
                        "time_seconds": None,
                        "screenshot_url": None,
                        "bangumi_id": "120632",
                        "latitude": 34.889,
                        "longitude": 135.807,
                        "title": "響け！ユーフォニアム",
                        "title_cn": "吹响吧！上低音号",
                        "distance_m": 280.0,
                        "origin": "宇治",
                    }
                ],
                "row_count": 1,
                "strategy": "geo",
                "status": "ok",
                "metadata": {"radius_m": 5000},
                "nearby_groups": [
                    {
                        "bangumi_id": "120632",
                        "title": "響け！ユーフォニアム",
                        "cover_url": None,
                        "points_count": 1,
                        "closest_distance_m": 280.0,
                    }
                ],
            }
        },
        ui={"component": "NearbyMap"},
    )
    assert model.data.results.row_count == 1
    assert model.data.results.rows[0].distance_m == 280.0


def test_route_response_model_requires_timed_itinerary() -> None:
    # timed_itinerary now has a default factory, so missing it should NOT raise
    model = RouteResponseModel(
        intent="plan_route",
        message="已为你规划好路线。",
        data={
            "route": {
                "ordered_points": [],
                "point_count": 0,
            }
        },
        ui={"component": "RoutePlannerWizard"},
    )
    assert model.data.route.timed_itinerary is not None

    model = RouteResponseModel(
        intent="plan_route",
        message="已为你规划好路线。",
        data={
            "route": {
                "ordered_points": [
                    {
                        "id": "p1",
                        "name": "宇治桥",
                        "name_cn": None,
                        "episode": None,
                        "time_seconds": None,
                        "screenshot_url": None,
                        "bangumi_id": "120632",
                        "latitude": 34.889,
                        "longitude": 135.807,
                    }
                ],
                "point_count": 1,
                "timed_itinerary": TimedItinerary().model_dump(mode="json"),
            }
        },
        ui={"component": "RoutePlannerWizard"},
    )
    assert model.data.route.point_count == 1


def test_qa_and_greet_models_include_data_message() -> None:
    qa = QAResponseModel(
        intent="general_qa",
        message="建议你从车站开始走。",
        data={"status": "info", "message": "建议你从车站开始走。"},
        ui={"component": "GeneralAnswer"},
    )
    greet = GreetingResponseModel(
        intent="greet_user",
        message="我是 Seichijunrei。",
        data={"status": "info", "message": "我是 Seichijunrei。"},
        ui={"component": "GeneralAnswer"},
    )
    assert qa.data.message
    assert greet.data.message


def test_qa_response_model_rejects_answer_question_intent() -> None:
    """QAResponseModel only accepts intent='general_qa', not 'answer_question'."""
    with pytest.raises(ValidationError):
        QAResponseModel(
            intent="answer_question",
            message="Some answer",
            data={"status": "info", "message": "Some answer"},
        )
