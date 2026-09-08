"""The anime the offline eval catalog knows: titles, aliases and points.

The place-name side lives in ``mock_geocode_fixtures`` (#1493).
"""

from __future__ import annotations

from dataclasses import dataclass

from animichi.clients.catalog_client import Point


@dataclass(frozen=True)
class TitleNames:
    ja: str
    zh: str
    en: str


@dataclass(frozen=True)
class PointSeed:
    pid: str
    bangumi_id: str
    name: str
    name_cn: str
    lat: float
    lng: float
    episode: int = 1


TITLE_NAMES: dict[str, TitleNames] = {
    "160209": TitleNames("君の名は。", "你的名字", "Your Name"),
    "115908": TitleNames("響け！ユーフォニアム", "吹响悠风号", "Sound Euphonium"),
    "269235": TitleNames("天気の子", "天气之子", "Weathering with You"),
    "324720": TitleNames("THE FIRST SLAM DUNK", "灌篮高手", "The First Slam Dunk"),
    "378862": TitleNames("ぼっち・ざ・ろっく！", "孤独摇滚", "Bocchi the Rock"),
    "11291": TitleNames("涼宮ハルヒの憂鬱", "凉宫春日的忧郁", "Haruhi Suzumiya"),
    "18809": TitleNames("けいおん！", "轻音少女", "K-ON!"),
    "328609": TitleNames("ゆるキャン△", "摇曳露营", "Laid-Back Camp"),
    "396387": TitleNames("SPY×FAMILY", "间谍过家家", "Spy x Family"),
    "387120": TitleNames("すずめの戸締まり", "铃芽之旅", "Suzume"),
    "183878": TitleNames(
        "ヴァイオレット・エヴァーガーデン", "紫罗兰永恒花园", "Violet Evergarden"
    ),
    "404804": TitleNames("【推しの子】", "我推的孩子", "Oshi no Ko"),
    "36954": TitleNames("氷菓", "冰菓", "Hyouka"),
    "1482": TitleNames("らき☆すた", "幸运星", "Lucky Star"),
    "3375": TitleNames(
        "涼宮ハルヒの消失", "凉宫春日的消失", "The Disappearance of Haruhi Suzumiya"
    ),
    "165553": TitleNames(
        "ラブライブ! サンシャイン!!", "Love Live! Sunshine!!", "Love Live! Sunshine!!"
    ),
    "1608": TitleNames("スラムダンク", "灌篮高手", "Slam Dunk"),
    "49294": TitleNames("ラブライブ!", "Love Live!", "Love Live!"),
    "152091": TitleNames("聲の形", "声之形", "A Silent Voice"),
    # Recent (2025-2026) titles — held-out generalization additions.
    "500001": TitleNames("ダンダダン", "胆大党", "Dandadan"),
    "500002": TitleNames("メダリスト", "金牌得主", "Medalist"),
}

POINT_SEEDS: tuple[PointSeed, ...] = (
    PointSeed("p001", "160209", "須賀神社の階段", "须贺神社的台阶", 35.6868, 139.7224),
    PointSeed("p002", "160209", "四ツ谷駅", "四谷站", 35.6860, 139.7301, 2),
    PointSeed("p003", "160209", "新宿御苑", "新宿御苑", 35.6852, 139.7101, 3),
    PointSeed("p004", "115908", "宇治橋", "宇治桥", 34.8915, 135.8075),
    PointSeed("p005", "115908", "京阪宇治駅", "京阪宇治站", 34.8920, 135.8069, 2),
    PointSeed("p006", "115908", "大吉山展望台", "大吉山展望台", 34.8919, 135.8147, 3),
    PointSeed("p007", "269235", "代々木会館跡", "代代木会馆旧址", 35.6827, 139.7020),
    PointSeed("p008", "269235", "新宿駅南口", "新宿站南口", 35.6886, 139.7008, 2),
    PointSeed("p009", "269235", "田端駅", "田端站", 35.7381, 139.7609, 3),
    PointSeed("p010", "324720", "鎌倉高校前駅", "镰仓高校前站", 35.3069, 139.5009),
    PointSeed("p011", "324720", "江ノ電踏切", "江之电道口", 35.3064, 139.5002, 2),
    PointSeed("p012", "324720", "鎌倉駅", "镰仓站", 35.3192, 139.5500, 3),
    PointSeed("p013", "378862", "下北沢SHELTER", "下北泽SHELTER", 35.6615, 139.6673),
    PointSeed("p014", "378862", "下北沢駅", "下北泽站", 35.6616, 139.6669, 2),
    PointSeed("p_haruhi_1", "11291", "西宮北口駅", "西宫北口站", 34.7468, 135.3561),
    PointSeed("p_kon_1", "18809", "出町柳駅", "出町柳站", 35.0300, 135.7720),
    PointSeed(
        "p_kon_toyosato",
        "18809",
        "豊郷小学校旧校舎群",
        "丰乡小学旧校舍群",
        35.2051,
        136.2308,
        2,
    ),
    PointSeed("p_yuru_1", "328609", "本栖湖", "本栖湖", 35.4731, 138.5850),
    PointSeed(
        "p_spy_1", "396387", "大阪市中央公会堂", "大阪市中央公会堂", 34.6937, 135.5023
    ),
    PointSeed("p_suzume_1", "387120", "日南海岸", "日南海岸", 31.6022, 131.3783),
    PointSeed(
        "p_violet_1", "183878", "京都文化博物館", "京都文化博物馆", 35.0094, 135.7620
    ),
    PointSeed(
        "p_oshi_1",
        "404804",
        "渋谷スクランブル交差点",
        "涩谷十字路口",
        35.6595,
        139.7005,
    ),
    PointSeed("p_hyouka_1", "36954", "飛騨高山", "飞驒高山", 36.1461, 137.2522),
    PointSeed("p_lucky_1", "1482", "鷲宮神社", "鹫宫神社", 36.1006, 139.6576),
    PointSeed("p_haruhi_movie_1", "3375", "甲陽園駅", "甲阳园站", 34.7626, 135.3299),
    PointSeed("p_lovelive_sun_1", "165553", "沼津港", "沼津港", 35.0828, 138.8571),
    PointSeed("p_slam_legacy_1", "1608", "湘南海岸", "湘南海岸", 35.3089, 139.4826),
    PointSeed("p_lovelive_1", "49294", "秋葉原UDX", "秋叶原UDX", 35.7002, 139.7729),
    # Satisfiability anchor for the 岐阜 expect_nonempty cases.
    PointSeed("p_koe_ogaki_station", "152091", "大垣駅", "大垣站", 35.3661, 136.6183),
    PointSeed(
        "p_koe_midoribashi", "152091", "美登鯉橋", "美登鲤桥", 35.3585, 136.6151, 2
    ),
    PointSeed(
        "p_koe_ogaki_park", "152091", "大垣公園", "大垣公园", 35.3587, 136.6122, 3
    ),
    # Recent (2025-2026) titles — held-out generalization additions.
    PointSeed("p_dandadan_1", "500001", "西新井大師", "西新井大师", 35.7768, 139.7906),
    PointSeed("p_dandadan_2", "500001", "北千住駅", "北千住站", 35.7497, 139.8050, 2),
    PointSeed(
        "p_medalist_1",
        "500002",
        "新横浜スケートセンター",
        "新横滨滑冰中心",
        35.5100,
        139.6170,
    ),
    PointSeed(
        "p_medalist_2", "500002", "横浜アリーナ", "横滨竞技场", 35.5107, 139.6169, 2
    ),
)

ALIASES_BY_ID: dict[str, tuple[str, ...]] = {
    "160209": ("君の名は", "你的名字", "your name", "kimi no na wa", "kiminonawa"),
    "115908": (
        "響け",
        "ユーフォ",
        "吹响悠风号",
        "悠风号",
        "euphonium",
        "sound euphonium",
        "eupho",
    ),
    "269235": ("天気の子", "天气之子", "weathering with you"),
    "324720": (
        "the first slam dunk",
        "灌篮高手",
        "slam dunk",
        "スラムダンク",
        "スラダン",
    ),
    "378862": ("ぼっち", "孤独摇滚", "bocchi the rock"),
    "11291": (
        "涼宮ハルヒの憂鬱",
        "涼宮ハルヒ",
        "凉宫春日",
        "haruhi suzumiya",
        "haruhi",
    ),
    "18809": ("けいおん", "轻音少女", "k-on", "k on"),
    "328609": ("ゆるキャン", "摇曳露营", "laid-back camp", "yuru camp"),
    "396387": ("spy×family", "spy x family", "spy family", "间谍过家家", "sxf"),
    "387120": ("すずめの戸締まり", "铃芽之旅", "suzume no tojimari", "suzume"),
    "183878": ("ヴァイオレット", "紫罗兰永恒花园", "violet evergarden"),
    "404804": ("推しの子", "我推的孩子", "oshi no ko", "推子"),
    "36954": ("氷菓", "冰菓", "hyouka"),
    "1482": ("らき☆すた", "幸运星", "lucky star"),
    "3375": ("涼宮ハルヒの消失", "凉宫春日的消失", "disappearance of haruhi"),
    "165553": ("ラブライブ! サンシャイン", "love live sunshine", "lovelive sunshine"),
    "1608": ("スラムダンク", "slam dunk legacy"),
    "49294": ("ラブライブ", "love live"),
    "500001": ("ダンダダン", "胆大党", "dandadan"),
    "500002": ("メダリスト", "金牌得主", "medalist"),
}

LOCATION_CENTERS: dict[str, tuple[float, float, str]] = {
    "宇治": (34.8915, 135.8075, "115908"),
    "uji": (34.8915, 135.8075, "115908"),
    "鎌倉": (35.3192, 139.5467, "324720"),
    "kamakura": (35.3192, 139.5467, "324720"),
    "秋葉原": (35.7023, 139.7745, "49294"),
    "akihabara": (35.7023, 139.7745, "49294"),
    "西宮": (34.7468, 135.3561, "11291"),
    "nishinomiya": (34.7468, 135.3561, "11291"),
    "新宿": (35.6886, 139.7008, "269235"),
    "shinjuku": (35.6886, 139.7008, "269235"),
    "下北沢": (35.6615, 139.6673, "378862"),
    "shimokitazawa": (35.6615, 139.6673, "378862"),
    "京都": (35.0116, 135.7681, "18809"),
    "kyoto": (35.0116, 135.7681, "18809"),
    "東京": (35.6762, 139.6503, "160209"),
    "tokyo": (35.6762, 139.6503, "160209"),
    "大阪": (34.6937, 135.5023, "396387"),
    "osaka": (34.6937, 135.5023, "396387"),
    "埼玉": (36.1006, 139.6576, "1482"),
    "saitama": (36.1006, 139.6576, "1482"),
    "山梨": (35.4731, 138.5850, "328609"),
    "yamanashi": (35.4731, 138.5850, "328609"),
    "神奈川": (35.3192, 139.5467, "324720"),
    "kanagawa": (35.3192, 139.5467, "324720"),
    "岐阜": (36.1461, 137.2522, "36954"),
    "gifu": (36.1461, 137.2522, "36954"),
    "宮崎": (31.6022, 131.3783, "387120"),
    "miyazaki": (31.6022, 131.3783, "387120"),
    "沼津": (35.0828, 138.8571, "165553"),
    "numazu": (35.0828, 138.8571, "165553"),
    "渋谷": (35.6595, 139.7005, "404804"),
    "shibuya": (35.6595, 139.7005, "404804"),
}


def _title_aliases() -> dict[str, str]:
    return {
        alias.lower(): bid
        for bid, aliases in ALIASES_BY_ID.items()
        for alias in aliases
    }


def _point(seed: PointSeed) -> Point:
    names = TITLE_NAMES[seed.bangumi_id]
    return Point(
        id=seed.pid,
        name=seed.name,
        name_cn=seed.name_cn,
        episode=seed.episode,
        bangumi_id=seed.bangumi_id,
        latitude=seed.lat,
        longitude=seed.lng,
        title=names.ja,
        title_cn=names.zh,
        cover_url=f"https://example.test/cover/{seed.bangumi_id}.jpg",
        screenshot_url=f"https://example.test/shot/{seed.pid}.jpg",
    )


def _fixture_points() -> dict[str, list[Point]]:
    points: dict[str, list[Point]] = {}
    for seed in POINT_SEEDS:
        points.setdefault(seed.bangumi_id, []).append(_point(seed))
    return points


TITLE_ALIASES = _title_aliases()
FIXTURE_POINTS = _fixture_points()
