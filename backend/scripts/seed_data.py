#!/usr/bin/env python3
"""Seed Supabase with bangumi metadata + Anitabi pilgrimage points.

Usage:
    uv run python scripts/seed_data.py          # seed all 17 bangumi
    uv run python scripts/seed_data.py --dry-run # preview without writing
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

# Ensure project root is on sys.path so bare imports work.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.clients.anitabi import AnitabiClient  # noqa: E402
from backend.clients.bangumi import BangumiClient  # noqa: E402
from backend.config.settings import get_settings  # noqa: E402
from backend.infrastructure.supabase.client import SupabaseClient  # noqa: E402
from backend.utils.logger import get_logger  # noqa: E402

logger = get_logger(__name__)

# ── 17 target bangumi ────────────────────────────────────────────────
SEED_BANGUMI_IDS: list[int] = [
    # Shinkai Makoto (5)
    160209,  # 君の名は。
    269235,  # 天気の子
    362577,  # すずめの戸締まり
    927,  # 秒速5センチメートル
    58949,  # 言の葉の庭
    # KyoAni TV (7)
    115908,  # 響け！ユーフォニアム
    152091,  # 響け！ユーフォニアム2
    283643,  # 響け！ユーフォニアム3
    485,  # 涼宮ハルヒの憂鬱
    1424,  # けいおん！
    55113,  # たまこまーけっと
    27364,  # 氷菓
    # Hibike movies (5)
    152092,  # 劇場版 響け！北宇治
    211089,  # 劇場版 響け！届けたいメロディ
    216371,  # リズと青い鳥
    216372,  # 劇場版 響け！誓いのフィナーレ
    386195,  # 特別編 響け！アンサンブルコンテスト
]

# ── helpers ───────────────────────────────────────────────────────────


async def fetch_bangumi_metadata(client: BangumiClient, subject_id: int) -> dict | None:
    """Fetch a single bangumi subject and return DB-ready dict."""
    try:
        raw = await client.get_subject(subject_id)
    except (OSError, RuntimeError, ValueError) as exc:
        logger.error("bangumi_fetch_failed", subject_id=subject_id, error=str(exc))
        return None

    images = raw.get("images") or {}
    rating_obj = raw.get("rating") or {}

    return {
        "id": str(subject_id),
        "title": raw.get("name") or "",
        "title_cn": raw.get("name_cn") or raw.get("name") or "",
        "cover_url": images.get("large") or images.get("common") or "",
        "air_date": raw.get("date"),  # text like "2016-08-26"
        "summary": (raw.get("summary") or "")[:2000],
        "eps_count": raw.get("total_episodes") or raw.get("eps") or 0,
        "rating": rating_obj.get("score"),
        "points_count": 0,  # will be updated after points seed
    }


async def fetch_points(client: AnitabiClient, bangumi_id: int) -> list[dict]:
    """Fetch pilgrimage points and return DB-ready dicts."""
    try:
        points = await client.get_bangumi_points(str(bangumi_id))
    except (OSError, RuntimeError, ValueError) as exc:
        logger.error("anitabi_fetch_failed", bangumi_id=bangumi_id, error=str(exc))
        return []

    rows: list[dict] = []
    for p in points:
        rows.append(
            {
                "id": p.id,
                "bangumi_id": str(bangumi_id),
                "name": p.name,
                "name_cn": p.cn_name,
                "latitude": p.coordinates.latitude,
                "longitude": p.coordinates.longitude,
                "episode": p.episode,
                "time_seconds": p.time_seconds,
                "image": str(p.screenshot_url),
                "origin": p.origin,
                "origin_url": p.origin_url,
                "location": f"POINT({p.coordinates.longitude} {p.coordinates.latitude})",
            }
        )
    return rows


# ── main ──────────────────────────────────────────────────────────────


async def seed(dry_run: bool = False) -> None:
    settings = get_settings()
    dsn = settings.supabase_db_url
    if not dsn:
        logger.error("SUPABASE_DB_URL is not set in .env")
        sys.exit(1)

    db = SupabaseClient(dsn)
    await db.connect()

    bangumi_client = BangumiClient()
    anitabi_client = AnitabiClient()

    total_points = 0

    try:
        # Step A: Bangumi metadata
        logger.info("seed_bangumi_start", count=len(SEED_BANGUMI_IDS))
        for sid in SEED_BANGUMI_IDS:
            meta = await fetch_bangumi_metadata(bangumi_client, sid)
            if meta is None:
                continue
            if dry_run:
                logger.info("dry_run_bangumi", id=sid, title=meta["title"])
                continue
            bid = meta.pop("id")
            await db.upsert_bangumi(bid, **meta)
            logger.info("upserted_bangumi", id=sid, title=meta["title"])

        # Step B: Anitabi points
        logger.info("seed_points_start", count=len(SEED_BANGUMI_IDS))
        for sid in SEED_BANGUMI_IDS:
            rows = await fetch_points(anitabi_client, sid)
            if not rows:
                logger.warning("no_points", bangumi_id=sid)
                continue
            if dry_run:
                logger.info("dry_run_points", bangumi_id=sid, count=len(rows))
                total_points += len(rows)
                continue

            for row in rows:
                pid = row.pop("id")
                loc_wkt = row.pop("location")
                # Use raw SQL for geography column
                cols = ["id"] + list(row.keys()) + ["location"]
                vals = [pid] + list(row.values())
                placeholders = ", ".join(f"${i + 1}" for i in range(len(vals)))
                placeholders += f", ST_GeogFromText(${len(vals) + 1})"
                update_set = ", ".join(f"{c} = EXCLUDED.{c}" for c in row.keys())
                update_set += ", location = EXCLUDED.location"
                sql = (
                    f"INSERT INTO points ({', '.join(cols)}) "
                    f"VALUES ({placeholders}) "
                    f"ON CONFLICT (id) DO UPDATE SET {update_set}"
                )
                await db.pool.execute(sql, *vals, loc_wkt)
                row["id"] = pid
                row["location"] = loc_wkt

            # Update points_count on bangumi
            await db.pool.execute(
                "UPDATE bangumi SET points_count = $1 WHERE id = $2",
                len(rows),
                str(sid),
            )
            total_points += len(rows)
            logger.info("upserted_points", bangumi_id=sid, count=len(rows))

        logger.info(
            "seed_complete",
            bangumi=len(SEED_BANGUMI_IDS),
            points=total_points,
            dry_run=dry_run,
        )
    finally:
        await bangumi_client.close()
        await anitabi_client.close()
        await db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed Supabase with anime data")
    parser.add_argument(
        "--dry-run", action="store_true", help="Preview without writing"
    )
    args = parser.parse_args()
    asyncio.run(seed(dry_run=args.dry_run))


if __name__ == "__main__":
    main()
