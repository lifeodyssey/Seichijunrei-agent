"""The place-name fixtures the offline eval catalog geocodes against.

Split out of ``mock_catalog_fixtures.py`` (#1493), which keeps the anime side:
titles, aliases and published points. This module keeps the place side — one
seeded candidate list per alias, including the two-answer 府中 the place
ambiguity cases need.
"""

from __future__ import annotations

from dataclasses import dataclass

from animichi.clients.geocode import GeocodeKind


@dataclass(frozen=True)
class GeocodeSeed:
    id: str
    label: str
    name: str
    lat: float
    lng: float
    kind: GeocodeKind = GeocodeKind.CITY


def _seed(
    slug: str, label: str, lat: float, lng: float, kind: GeocodeKind = GeocodeKind.CITY
) -> GeocodeSeed:
    return GeocodeSeed(f"seed:{slug}", label, label.split("(")[0], lat, lng, kind)


def _geocode_fixtures() -> dict[str, tuple[GeocodeSeed, ...]]:
    groups = (
        (("宇治", "宇治市", "uji"), _seed("uji", "宇治(京都府)", 34.8843, 135.7997)),
        (
            ("鎌倉", "镰仓", "kamakura"),
            _seed("kamakura", "鎌倉(神奈川県)", 35.3192, 139.5467),
        ),
        (
            ("秋葉原", "秋叶原", "akihabara"),
            _seed(
                "akihabara", "秋葉原(東京都)", 35.7023, 139.7745, GeocodeKind.LANDMARK
            ),
        ),
        (
            ("西宮", "西宫", "nishinomiya"),
            _seed(
                "nishinomiya", "西宮駅(兵庫県)", 34.7386, 135.3485, GeocodeKind.STATION
            ),
        ),
        (("新宿", "shinjuku"), _seed("shinjuku", "新宿(東京都)", 35.6938, 139.7034)),
        (
            ("下北沢", "下北泽", "shimokitazawa"),
            _seed("shimokitazawa", "下北沢(東京都)", 35.6616, 139.6669),
        ),
        (("京都", "kyoto"), _seed("kyoto", "京都市(京都府)", 35.0116, 135.7681)),
        (("東京", "东京", "tokyo"), _seed("tokyo", "東京(東京都)", 35.6762, 139.6503)),
        (("大阪", "osaka"), _seed("osaka", "大阪市(大阪府)", 34.6937, 135.5023)),
        (
            ("埼玉", "saitama"),
            GeocodeSeed(
                "geonames:6940394",
                "さいたま市(埼玉県)",
                "さいたま市",
                35.90807,
                139.65657,
                GeocodeKind.CITY,
            ),
        ),
        (
            ("神奈川", "kanagawa"),
            GeocodeSeed(
                "geonames:1848354",
                "横浜市(神奈川県)",
                "横浜市",
                35.43333,
                139.65,
                GeocodeKind.CITY,
            ),
        ),
        (
            ("岐阜", "gifu"),
            GeocodeSeed(
                "geonames:1863641",
                "岐阜市(岐阜県)",
                "岐阜市",
                35.42291,
                136.76039,
                GeocodeKind.CITY,
            ),
        ),
        (
            ("宮崎", "宫崎", "miyazaki"),
            _seed("miyazaki", "宮崎市(宮崎県)", 31.9077, 131.4202),
        ),
        (("箱根", "hakone"), _seed("hakone", "箱根町(神奈川県)", 35.2324, 139.1069)),
        (("豊郷", "toyosato"), _seed("toyosato", "豊郷町(滋賀県)", 35.2051, 136.2308)),
        (
            ("山梨県", "yamanashi"),
            _seed("yamanashi", "山梨県", 35.6639, 138.5683, GeocodeKind.PREFECTURE),
        ),
    )
    return {alias.lower(): (seed,) for aliases, seed in groups for alias in aliases}


GEOCODE_FIXTURES = _geocode_fixtures()
GEOCODE_FIXTURES["東京都"] = (
    _seed("tokyo-prefecture", "東京都", 35.6762, 139.6503, GeocodeKind.PREFECTURE),
)
GEOCODE_FIXTURES["神奈川県"] = (
    _seed("kanagawa-prefecture", "神奈川県", 35.4478, 139.6425, GeocodeKind.PREFECTURE),
)
GEOCODE_FIXTURES["神奈川县"] = GEOCODE_FIXTURES["神奈川県"]
GEOCODE_FIXTURES["宫崎县"] = (
    _seed("miyazaki-prefecture", "宮崎県", 31.9111, 131.4239, GeocodeKind.PREFECTURE),
)
GEOCODE_FIXTURES["府中"] = (
    _seed("fuchu-tokyo", "府中市(東京都)", 35.6689, 139.4777),
    _seed("fuchu-hiroshima", "府中市(広島県)", 34.5684, 133.2363),
)
