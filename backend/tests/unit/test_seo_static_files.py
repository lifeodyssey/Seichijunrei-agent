"""Tests for SEO static files and layout metadata (Card S_ALL)."""

import re
import xml.etree.ElementTree as ET
from pathlib import Path

FRONTEND_DIR = Path(__file__).resolve().parents[3] / "frontend"
SITE_URL = "https://seichijunrei.zhenjia.org"


class TestSitemapXml:
    def test_sitemap_is_well_formed_xml(self) -> None:
        path = FRONTEND_DIR / "public" / "sitemap.xml"
        tree = ET.parse(path)
        root = tree.getroot()
        ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        urls = root.findall("s:url", ns)
        assert len(urls) >= 1

    def test_sitemap_contains_root_url(self) -> None:
        path = FRONTEND_DIR / "public" / "sitemap.xml"
        content = path.read_text()
        assert SITE_URL in content


class TestRobotsTxt:
    def test_robots_has_allow_directive(self) -> None:
        path = FRONTEND_DIR / "public" / "robots.txt"
        content = path.read_text()
        assert "Allow: /" in content

    def test_robots_has_sitemap_directive(self) -> None:
        path = FRONTEND_DIR / "public" / "robots.txt"
        content = path.read_text()
        assert f"Sitemap: {SITE_URL}/sitemap.xml" in content


class TestOgImage:
    def test_og_image_exists(self) -> None:
        path = FRONTEND_DIR / "public" / "og-image.png"
        assert path.exists()
        assert path.stat().st_size > 0

    def test_og_image_is_valid_png(self) -> None:
        path = FRONTEND_DIR / "public" / "og-image.png"
        header = path.read_bytes()[:8]
        assert header == b"\x89PNG\r\n\x1a\n"


# --- helpers shared by metadata test classes ---


def _read_layout() -> str:
    return (FRONTEND_DIR / "app" / "layout.tsx").read_text()


def _display_width(text: str) -> int:
    """CJK fullwidth chars count as 2; ASCII/halfwidth as 1."""
    width = 0
    for ch in text:
        cp = ord(ch)
        is_wide = (
            (0x3000 <= cp <= 0x9FFF)
            or (0xF900 <= cp <= 0xFAFF)
            or (0xFF01 <= cp <= 0xFF60)
            or (0x20000 <= cp <= 0x2FA1F)
        )
        width += 2 if is_wide else 1
    return width


def _extract_const(source: str, name: str) -> str:
    """Extract string value from a const assignment (may span lines)."""
    pattern = rf'const {name}\s*=\s*\n?\s*"([^"]+)"'
    match = re.search(pattern, source)
    if not match:
        raise AssertionError(f"{name} not found")
    return match.group(1)


class TestTitleAndDescription:
    def test_title_display_width_50_to_60(self) -> None:
        source = _read_layout()
        title = _extract_const(source, "SITE_TITLE")
        width = _display_width(title)
        assert 50 <= width <= 60, f"Title width {width}: {title}"

    def test_title_contains_japanese_and_seichijunrei(self) -> None:
        source = _read_layout()
        assert "聖地巡礼" in source
        assert "Seichijunrei" in source

    def test_description_display_width_120_to_160(self) -> None:
        source = _read_layout()
        desc = _extract_const(source, "SITE_DESCRIPTION")
        width = _display_width(desc)
        assert 120 <= width <= 160, f"Desc width {width}: {desc}"

    def test_description_contains_required_keywords(self) -> None:
        source = _read_layout()
        for keyword in ["聖地巡礼", "アニメ", "ルート", "スポット"]:
            assert keyword in source, f"Missing keyword: {keyword}"


class TestOgMeta:
    def test_og_type_website(self) -> None:
        source = _read_layout()
        assert 'type: "website"' in source

    def test_og_locale_ja_jp(self) -> None:
        source = _read_layout()
        assert 'locale: "ja_JP"' in source

    def test_og_image_dimensions(self) -> None:
        source = _read_layout()
        assert "width: 1200" in source
        assert "height: 630" in source

    def test_twitter_card_summary_large_image(self) -> None:
        source = _read_layout()
        assert 'card: "summary_large_image"' in source


class TestHreflang:
    def test_hreflang_tags(self) -> None:
        source = _read_layout()
        assert "languages:" in source or "languages" in source
        for lang in ["ja", "zh", "en", "x-default"]:
            pattern = rf'["\']?{re.escape(lang)}["\']?\s*:'
            assert re.search(pattern, source), f"Missing hreflang: {lang}"


class TestJsonLd:
    def test_json_ld_website_schema(self) -> None:
        source = _read_layout_structured_data()
        assert '"@type": "WebSite"' in source
        assert "SearchAction" in source

    def test_json_ld_organization_schema(self) -> None:
        source = _read_layout_structured_data()
        assert '"@type": "Organization"' in source

    def test_json_ld_faqpage_schema(self) -> None:
        source = _read_layout_structured_data()
        assert '"@type": "FAQPage"' in source
        assert source.count('"@type": "Question"') >= 2


class TestFaqCiteability:
    """AC9: FAQ citeability - answers are self-contained and keyword-rich."""

    def test_faq_answers_are_self_contained_sentences(self) -> None:
        # AC9: FAQ citeability
        source = _read_structured_data_file()
        faq_data = _parse_faq_from_source(source)
        for entry in faq_data:
            answer_text = entry["answer"]
            assert len(answer_text) > 50, (
                f"FAQ answer too short for citeability ({len(answer_text)} chars): "
                f"{answer_text[:40]}..."
            )
            assert answer_text.endswith("。") or answer_text.endswith("."), (
                f"FAQ answer should end with a sentence terminator: {answer_text[-20:]}"
            )

    def test_faq_answers_contain_relevant_keywords(self) -> None:
        # AC9: FAQ citeability
        source = _read_structured_data_file()
        faq_data = _parse_faq_from_source(source)
        required_keywords_per_answer = [
            ["聖地巡礼", "アニメ"],
            ["作品", "スポット"],
            ["ルート", "スポット"],
        ]
        for entry, keywords in zip(faq_data, required_keywords_per_answer, strict=True):
            for kw in keywords:
                assert kw in entry["answer"], (
                    f"FAQ answer missing keyword '{kw}': {entry['answer'][:60]}..."
                )


# --- helpers for structured-data.ts parsing ---


def _read_layout_structured_data() -> str:
    """Read the structured-data module (JSON-LD source of truth)."""
    return (FRONTEND_DIR / "lib" / "structured-data.ts").read_text()


def _read_structured_data_file() -> str:
    return (FRONTEND_DIR / "lib" / "structured-data.ts").read_text()


def _parse_faq_from_source(source: str) -> list[dict[str, str]]:
    """Extract FAQ question/answer pairs from the TS source."""
    block_pattern = re.compile(
        r'"@type":\s*"Question".*?name:\s*"([^"]+)".*?text:\s*"([^"]+)"',
        re.DOTALL,
    )
    return [{"question": q, "answer": a} for q, a in block_pattern.findall(source)]
