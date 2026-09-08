from __future__ import annotations

import json
import math
from collections.abc import Mapping
from pathlib import Path
from typing import cast

from animichi.clients.geocode import GeocodeKind
from animichi.tests.eval.mock_catalog_fixtures import POINT_SEEDS
from animichi.tests.eval.mock_geocode_fixtures import GEOCODE_FIXTURES

DATASET = Path(__file__).parents[1] / "eval" / "datasets" / "agent_eval_v3.json"
SUFFIX_CASES = {"C2_ja_005", "C2_zh_004", "C2_zh_006"}
PREFECTURE_NARROWING_CASES = SUFFIX_CASES | {"C2_ja_007"}
BARE_CASES = {"C2_ja_004", "C2_zh_005", "C2_en_004", "C2_en_005", "C2_ja_006"}
NEW_CASES = {
    "C1_ja_007",
    "C1_ja_008",
    "C1_en_006",
    "C1_zh_006",
    "C2_ja_007",
    "C5_ja_001",
    "C5_zh_001",
    "C5_en_001",
    "Q304_retrieval_place_001",
}
CASE_GEOCODE_KEYS: dict[str, str | None] = {
    "C1_ja_001": "宇治",
    "C1_ja_002": "鎌倉",
    "C1_ja_003": "秋葉原",
    "C1_ja_004": "西宮",
    "C1_ja_005": "新宿",
    "C1_ja_006": "岐阜",
    "C1_ja_007": "箱根",
    "C1_ja_008": "豊郷",
    "C1_zh_001": "宇治",
    "C1_zh_002": "镰仓",
    "C1_zh_003": "秋叶原",
    "C1_zh_004": "下北泽",
    "C1_zh_005": "西宫",
    "C1_zh_006": "西宫",
    "C1_en_001": "uji",
    "C1_en_002": "kamakura",
    "C1_en_003": "shinjuku",
    "C1_en_004": "akihabara",
    "C1_en_005": "nishinomiya",
    "C1_en_006": "nishinomiya",
    "C2_ja_001": "京都",
    "C2_ja_002": "東京",
    "C2_ja_003": "大阪",
    "C2_ja_004": "埼玉",
    "C2_ja_005": "山梨県",
    "C2_ja_006": "神奈川",
    "C2_ja_007": "山梨県",
    "C2_zh_001": "京都",
    "C2_zh_002": "东京",
    "C2_zh_003": "大阪",
    "C2_zh_004": "神奈川县",
    "C2_zh_005": "岐阜",
    "C2_zh_006": "宫崎县",
    "C2_en_001": "tokyo",
    "C2_en_002": "kyoto",
    "C2_en_003": "osaka",
    "C2_en_004": "saitama",
    "C2_en_005": "kanagawa",
    "C4_ja_001": None,
    "C4_ja_002": None,
    "C4_zh_001": None,
    "C4_zh_002": None,
    "C4_zh_003": None,
    "C4_en_001": None,
    "C4_en_002": None,
    "C4_en_003": None,
    "C5_ja_001": "府中",
    "C5_zh_001": "府中",
    "C5_en_001": "府中",
    "Q304_retrieval_place_001": "秋叶原",
    "E2_ja_001": "京都",
    "E2_ja_002": None,
    "E2_ja_003": None,
    "E2_zh_001": "京都",
    "E2_zh_002": None,
    "E2_zh_003": None,
    "E2_en_001": "tokyo",
    "E2_en_002": None,
    "E2_en_003": None,
    "E2_en_004": None,
    "G4_ja_001": None,
    "G4_ja_002": None,
    "G4_ja_003": None,
    "G4_zh_001": None,
    "G4_zh_002": None,
    "G4_en_001": None,
    "G4_en_002": None,
    "G4_en_003": None,
    "H1_ja_001": None,
    "H1_ja_002": None,
    "H1_ja_003": None,
    "H1_zh_001": None,
    "H1_zh_002": None,
    "H1_zh_003": None,
    "H1_en_001": None,
    "H1_en_002": None,
    "H1_en_003": None,
    "H1_en_004": None,
}


def _rows() -> dict[str, Mapping[str, object]]:
    raw = cast(list[object], json.loads(DATASET.read_text()))
    rows = [cast(Mapping[str, object], row) for row in raw]
    return {str(row["id"]): row for row in rows}


def test_b3_prefecture_carve_out_and_new_cases() -> None:
    rows = _rows()
    assert all(
        rows[id_]["acceptable_stages"] == ["search_nearby"] for id_ in BARE_CASES
    )
    assert all(
        rows[id_]["acceptable_stages"] == ["clarify_after_nearby"]
        for id_ in SUFFIX_CASES
    )
    assert NEW_CASES <= rows.keys()


def test_b3_c1_c2_flips_c4_trajectory_and_nonempty_tags() -> None:
    rows = _rows()
    flipped = [
        row
        for id_, row in rows.items()
        if id_.startswith(("C1_", "C2_")) and id_ not in PREFECTURE_NARROWING_CASES
    ]
    assert all(row["acceptable_stages"] == ["search_nearby"] for row in flipped)
    assert all(
        "clarify_after_nearby" in cast(list[str], row["acceptable_stages"])
        for id_, row in rows.items()
        if id_.startswith("C4_")
    )
    assert sum(row.get("expect_nonempty") is True for row in rows.values()) >= 15


def test_nearby_eval_cases_have_geocode_fixture_coverage() -> None:
    rows = _rows()
    nearby_stages = {"search_nearby", "clarify_after_nearby"}
    nearby_ids = {
        id_
        for id_, row in rows.items()
        if nearby_stages & set(cast(list[str], row["acceptable_stages"]))
    }
    assert CASE_GEOCODE_KEYS.keys() == nearby_ids
    for id_, key in CASE_GEOCODE_KEYS.items():
        if key is None:
            continue
        query = str(rows[id_]["query"])
        assert key.lower() in query.lower(), id_
        assert key.lower() in GEOCODE_FIXTURES, id_


def test_bare_prefecture_fixtures_resolve_to_capital_cities() -> None:
    keys = ("埼玉", "saitama", "神奈川", "kanagawa", "岐阜", "gifu")
    assert all(GEOCODE_FIXTURES[key][0].kind is GeocodeKind.CITY for key in keys)


def test_expect_nonempty_cases_are_geographically_satisfiable() -> None:
    rows = _rows()
    for id_, row in rows.items():
        if row.get("expect_nonempty") is not True:
            continue
        key = CASE_GEOCODE_KEYS[id_]
        assert key is not None
        origin = GEOCODE_FIXTURES[key.lower()][0]
        assert any(
            2
            * 6371
            * math.asin(
                math.sqrt(
                    math.sin(math.radians(seed.lat - origin.lat) / 2) ** 2
                    + math.cos(math.radians(origin.lat))
                    * math.cos(math.radians(seed.lat))
                    * math.sin(math.radians(seed.lng - origin.lng) / 2) ** 2
                )
            )
            <= 50
            for seed in POINT_SEEDS
        ), id_
