"""Generate A2UI (v0.8) messages from Seichijunrei session state.

This is intentionally deterministic: it reads the ADK session state and
produces A2UI surfaces (candidate picker / route view) without requiring the
LLM to emit UI JSON.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any
from urllib.parse import quote


def build_a2ui_response(state: dict[str, Any]) -> tuple[str, list[dict[str, Any]]]:
    """Return (assistant_text, a2ui_messages) for the current session state."""
    lang = _state_language(state)

    if state.get("route_plan"):
        assistant_text = _t(
            lang,
            zh="路线已生成。你可以查看推荐顺序与点位详情。",
            en="Route generated. You can review the recommended order and point details.",
            ja="ルートを作成しました。おすすめ順とスポットの詳細を確認できます。",
        )
        return assistant_text, _route_view_messages(state, lang)

    if state.get("bangumi_candidates"):
        assistant_text = _t(
            lang,
            zh="请选择一个作品开始规划路线。",
            en="Please pick one title to start planning.",
            ja="作品を1つ選んでルート作成を開始してください。",
        )
        return assistant_text, _candidates_view_messages(state, lang)

    assistant_text = _t(
        lang,
        zh="请输入作品名（也可以加上出发地/车站）。",
        en="Tell me the anime title (optionally with a starting station/area).",
        ja="作品名（必要なら出発地/駅）を入力してください。",
    )
    return assistant_text, _welcome_view_messages(lang)


def build_a2ui_error_response(
    state: dict[str, Any], *, error_message: str
) -> tuple[str, list[dict[str, Any]]]:
    """Return an error UI for unexpected failures during agent execution."""
    lang = _state_language(state)
    assistant_text = _t(
        lang,
        zh=f"出错了：{error_message}",
        en=f"Error: {error_message}",
        ja=f"エラー：{error_message}",
    )
    return assistant_text, _error_view_messages(lang, error_message)


def _welcome_view_messages(lang: str) -> list[dict[str, Any]]:
    surface_id = "main"

    header_id = "welcome-header"
    hint_id = "welcome-hint"
    examples_row_id = "welcome-examples-row"

    example_texts = [
        _t(lang, zh="灌篮高手 镰仓", en="Slam Dunk Kamakura", ja="スラムダンク 鎌倉"),
        _t(
            lang,
            zh="孤独摇滚 下北泽",
            en="Bocchi the Rock Shimokitazawa",
            ja="ぼっち・ざ・ろっく！ 下北沢",
        ),
        _t(
            lang,
            zh="青春猪头 镰仓",
            en="Bunny Girl Senpai Kamakura",
            ja="青春ブタ野郎 鎌倉",
        ),
    ]

    components: list[dict[str, Any]] = []
    components.append(
        _column(
            "root",
            [
                header_id,
                hint_id,
                "divider-1",
                examples_row_id,
            ],
            alignment="stretch",
        )
    )
    components.append(
        _text(
            header_id,
            _t(
                lang,
                zh="Seichijunrei 聖地巡礼助手",
                en="Seichijunrei Pilgrimage Assistant",
                ja="聖地巡礼アシスタント",
            ),
            usage_hint="h2",
        )
    )
    components.append(
        _text(
            hint_id,
            _t(
                lang,
                zh="输入动画作品名（可选：加上出发地/车站），然后从候选中点选一部作品。",
                en="Type an anime title (optionally with a starting station/area), then pick a candidate.",
                ja="作品名（必要なら出発地/駅）を入力し、候補から選択してください。",
            ),
            usage_hint="body",
        )
    )
    components.append(_divider("divider-1"))

    example_button_ids: list[str] = []
    for idx, text in enumerate(example_texts, start=1):
        button_id = f"example-btn-{idx}"
        example_button_ids.append(button_id)
        components.extend(
            _button_with_text(
                button_id,
                label=text,
                action_name=f"send_text:{text}",
                primary=(idx == 1),
            )
        )

    components.append(_row(examples_row_id, example_button_ids, distribution="start"))

    return _surface_messages(surface_id, components, root_id="root")


def _error_view_messages(lang: str, error_message: str) -> list[dict[str, Any]]:
    surface_id = "main"

    components: list[dict[str, Any]] = []
    components.append(
        _column(
            "root",
            [
                "error-header",
                "divider-1",
                "error-card",
                "divider-2",
                "error-controls",
            ],
            alignment="stretch",
        )
    )
    components.append(
        _text(
            "error-header",
            _t(
                lang,
                zh="发生错误",
                en="Something went wrong",
                ja="エラーが発生しました",
            ),
            usage_hint="h2",
        )
    )
    components.append(_divider("divider-1"))

    components.append(_card("error-card", "error-card-content"))
    components.append(
        _column("error-card-content", ["error-message"], alignment="stretch")
    )
    components.append(_text("error-message", error_message, usage_hint="body"))
    components.append(_divider("divider-2"))

    controls_ids = ["error-reset"]
    components.append(_row("error-controls", controls_ids, distribution="end"))
    components.extend(
        _button_with_text(
            "error-reset",
            label=_t(lang, zh="重新开始", en="Reset", ja="リセット"),
            action_name="reset",
            primary=True,
        )
    )

    return _surface_messages(surface_id, components, root_id="root")


def _candidates_view_messages(state: dict[str, Any], lang: str) -> list[dict[str, Any]]:
    surface_id = "main"

    header_id = "cand-header"
    controls_row_id = "cand-controls-row"

    candidates_data = state.get("bangumi_candidates") or {}
    candidates = candidates_data.get("candidates") or []
    query = candidates_data.get("query") or ""

    components: list[dict[str, Any]] = []
    components.append(
        _column(
            "root",
            [
                header_id,
                "divider-1",
                "cand-list",
                "divider-2",
                controls_row_id,
            ],
            alignment="stretch",
        )
    )

    header_text = _t(
        lang,
        zh=f"候选作品（关键词：{query}）",
        en=f"Candidates (query: {query})",
        ja=f"候補（キーワード：{query}）",
    )
    components.append(_text(header_id, header_text, usage_hint="h3"))
    components.append(_divider("divider-1"))

    cand_item_ids: list[str] = []
    for idx, cand in enumerate(candidates, start=1):
        card_id = f"cand-card-{idx}"
        cand_item_ids.append(card_id)

        title = (
            (cand.get("title_cn") if lang == "zh-CN" else None)
            or cand.get("title")
            or ""
        )
        jp_title = cand.get("title") or ""
        air = cand.get("air_date") or ""
        summary = cand.get("summary") or ""

        content_id = f"{card_id}-content"
        title_id = f"{card_id}-title"
        subtitle_id = f"{card_id}-subtitle"
        summary_id = f"{card_id}-summary"
        actions_row_id = f"{card_id}-actions"
        select_button_id = f"{card_id}-select"

        subtitle_parts = [p for p in [jp_title, air] if p]
        subtitle = " · ".join(subtitle_parts)

        components.append(_card(card_id, content_id))
        components.append(
            _column(
                content_id,
                [
                    title_id,
                    subtitle_id,
                    summary_id,
                    actions_row_id,
                ],
                alignment="stretch",
            )
        )
        components.append(_text(title_id, f"{idx}. {title}", usage_hint="h4"))
        if subtitle:
            components.append(_text(subtitle_id, subtitle, usage_hint="caption"))
        else:
            components.append(_text(subtitle_id, "", usage_hint="caption"))
        components.append(_text(summary_id, summary, usage_hint="body"))

        components.append(_row(actions_row_id, [select_button_id], distribution="end"))
        components.extend(
            _button_with_text(
                select_button_id,
                label=_t(lang, zh="选择", en="Select", ja="選択"),
                action_name=f"select_candidate_{idx}",
                primary=True,
            )
        )

    components.append(_column("cand-list", cand_item_ids, alignment="stretch"))
    components.append(_divider("divider-2"))

    controls_button_ids = ["cand-reset"]
    components.append(_row(controls_row_id, controls_button_ids, distribution="end"))
    components.extend(
        _button_with_text(
            "cand-reset",
            label=_t(lang, zh="重新开始", en="Reset", ja="リセット"),
            action_name="reset",
            primary=False,
        )
    )

    return _surface_messages(surface_id, components, root_id="root")


def _route_view_messages(state: dict[str, Any], lang: str) -> list[dict[str, Any]]:
    surface_id = "main"

    extraction = state.get("extraction_result") or {}
    selected = state.get("selected_bangumi") or {}
    route_plan = state.get("route_plan") or {}
    points_selection = state.get("points_selection_result") or {}

    origin = extraction.get("location") if isinstance(extraction, dict) else ""
    origin = origin if isinstance(origin, str) else ""

    title_cn = selected.get("bangumi_title_cn")
    title_jp = selected.get("bangumi_title") or ""
    display_title = (
        (title_cn if lang == "zh-CN" else None) or title_jp or title_cn or ""
    )
    header = _t(
        lang,
        zh=f"{display_title} 巡礼路线",
        en=f"{display_title} Pilgrimage Route",
        ja=f"{display_title} 巡礼ルート",
    )

    duration = route_plan.get("estimated_duration") or ""
    distance = route_plan.get("estimated_distance") or ""
    transport = route_plan.get("transport_tips") or ""
    route_description = route_plan.get("route_description") or ""
    special_notes = route_plan.get("special_notes") or []
    recommended_order = route_plan.get("recommended_order") or []
    selected_points = points_selection.get("selected_points") or []
    selection_rationale = points_selection.get("selection_rationale") or ""
    total_available = points_selection.get("total_available")
    rejected_count = points_selection.get("rejected_count")

    ordered_points_for_maps = _points_in_planner_order(selected_points)
    directions_url = _build_google_maps_directions_url(
        origin=origin, points=ordered_points_for_maps
    )

    components: list[dict[str, Any]] = []
    root_children: list[str] = [
        "route-header",
        "route-subheader",
        "divider-1",
        "route-steps",
    ]
    if route_description:
        root_children.append("route-desc-card")
    root_children.append("divider-2")
    root_children.append("points-header")
    if isinstance(total_available, int) or isinstance(rejected_count, int):
        root_children.append("points-meta")
    if isinstance(selection_rationale, str) and selection_rationale.strip():
        root_children.append("points-rationale-card")
    root_children.extend(["points-list", "divider-3", "route-controls"])

    components.append(_column("root", root_children, alignment="stretch"))
    components.append(_text("route-header", header, usage_hint="h2"))

    meta = " · ".join([p for p in [duration, distance] if p])
    components.append(_text("route-subheader", meta, usage_hint="caption"))
    components.append(_divider("divider-1"))

    step_ids: list[str] = []
    for idx, name in enumerate(recommended_order, start=1):
        step_id = f"route-step-{idx}"
        step_ids.append(step_id)
        components.append(_text(step_id, f"{idx}. {name}", usage_hint="body"))
    if not step_ids:
        components.append(
            _text(
                "route-step-empty",
                _t(
                    lang,
                    zh="（暂无推荐顺序）",
                    en="(No route order)",
                    ja="（順序なし）",
                ),
                usage_hint="body",
            )
        )
        step_ids = ["route-step-empty"]
    components.append(_column("route-steps", step_ids, alignment="stretch"))

    if route_description:
        components.append(_card("route-desc-card", "route-desc-content"))
        components.append(
            _column("route-desc-content", ["route-desc-text"], alignment="stretch")
        )
        components.append(
            _text(
                "route-desc-text",
                route_description,
                usage_hint="body",
            )
        )

    components.append(_divider("divider-2"))

    components.append(
        _text(
            "points-header",
            _t(lang, zh="推荐点位", en="Selected Points", ja="選定スポット"),
            usage_hint="h3",
        )
    )

    if isinstance(total_available, int) or isinstance(rejected_count, int):
        selected_count = (
            len(selected_points) if isinstance(selected_points, list) else 0
        )
        total = total_available if isinstance(total_available, int) else "?"
        rejected = rejected_count if isinstance(rejected_count, int) else "?"
        components.append(
            _text(
                "points-meta",
                _t(
                    lang,
                    zh=f"已选 {selected_count} / 可用 {total} · 未选 {rejected}",
                    en=f"Selected {selected_count} / Available {total} · Rejected {rejected}",
                    ja=f"選択 {selected_count} / 利用可能 {total} · 未選択 {rejected}",
                ),
                usage_hint="caption",
            )
        )

    if isinstance(selection_rationale, str) and selection_rationale.strip():
        components.append(_card("points-rationale-card", "points-rationale-content"))
        components.append(
            _column(
                "points-rationale-content",
                ["points-rationale-text"],
                alignment="stretch",
            )
        )
        components.append(
            _text(
                "points-rationale-text",
                selection_rationale.strip(),
                usage_hint="body",
            )
        )

    point_card_ids: list[str] = []
    for idx, p in enumerate(selected_points, start=1):
        card_id = f"pt-card-{idx}"
        point_card_ids.append(card_id)

        content_id = f"{card_id}-content"
        image_id = f"{card_id}-image"
        title_id = f"{card_id}-title"
        subtitle_id = f"{card_id}-subtitle"
        actions_row_id = f"{card_id}-actions"
        map_button_id = f"{card_id}-map"
        remove_button_id = f"{card_id}-remove"

        name = (p.get("cn_name") if lang == "zh-CN" else None) or p.get("name") or ""
        jp_name = p.get("name") or ""
        episode = p.get("episode")
        address = p.get("address") or ""
        screenshot_url = p.get("screenshot_url") or ""
        lat = p.get("lat")
        lng = p.get("lng")

        subtitle_parts: list[str] = []
        if jp_name and jp_name != name:
            subtitle_parts.append(jp_name)
        if isinstance(episode, int):
            subtitle_parts.append(
                _t(lang, zh=f"第{episode}话", en=f"Ep {episode}", ja=f"第{episode}話")
            )
        if address:
            subtitle_parts.append(address)

        components.append(_card(card_id, content_id))
        # Image is optional; only render if present to avoid broken UI.
        content_children: list[str] = []
        if screenshot_url:
            components.append(_image(image_id, screenshot_url))
            content_children.append(image_id)
        content_children.extend([title_id, subtitle_id, actions_row_id])

        components.append(_column(content_id, content_children, alignment="stretch"))
        components.append(_text(title_id, f"{idx}. {name}", usage_hint="h4"))
        components.append(
            _text(subtitle_id, " · ".join(subtitle_parts), usage_hint="caption")
        )

        action_button_ids: list[str] = []
        if isinstance(lat, (int, float)) and isinstance(lng, (int, float)):
            point_maps_url = (
                f"https://www.google.com/maps/search/?api=1&query={lat},{lng}"
            )
            action_button_ids.append(map_button_id)
            components.extend(
                _button_with_text(
                    map_button_id,
                    label=_t(lang, zh="地图", en="Map", ja="地図"),
                    action_name=f"open_url:{point_maps_url}",
                    primary=False,
                )
            )

        action_button_ids.append(remove_button_id)
        components.extend(
            _button_with_text(
                remove_button_id,
                label=_t(lang, zh="移除", en="Remove", ja="削除"),
                action_name=f"remove_point_{idx}",
                primary=False,
            )
        )
        components.append(_row(actions_row_id, action_button_ids, distribution="end"))

    if not point_card_ids:
        components.append(
            _text(
                "points-empty",
                _t(
                    lang, zh="（暂无点位信息）", en="(No points)", ja="（スポットなし）"
                ),
                usage_hint="body",
            )
        )
        point_card_ids = ["points-empty"]

    components.append(_column("points-list", point_card_ids, alignment="stretch"))
    components.append(_divider("divider-3"))

    # Controls: back / reset
    controls_ids: list[str] = []
    if directions_url:
        controls_ids.append("route-open-maps")
    controls_ids.extend(["route-back", "route-reset"])
    components.append(_row("route-controls", controls_ids, distribution="end"))
    if directions_url:
        components.extend(
            _button_with_text(
                "route-open-maps",
                label=_t(
                    lang,
                    zh="在 Google 地图中打开路线",
                    en="Open route in Google Maps",
                    ja="Google マップでルートを開く",
                ),
                action_name=f"open_url:{directions_url}",
                primary=True,
            )
        )
    components.extend(
        _button_with_text(
            "route-back",
            label=_t(lang, zh="重新选择作品", en="Back", ja="選び直す"),
            action_name="back",
            primary=False,
        )
    )
    components.extend(
        _button_with_text(
            "route-reset",
            label=_t(lang, zh="重新开始", en="Reset", ja="リセット"),
            action_name="reset",
            primary=False,
        )
    )

    # Add a lightweight tips section as plain text in chat (assistant_text) instead.
    # But we still show transport tips if present as a card-like text block.
    if transport or special_notes:
        tips_id = "route-tips-card"
        tips_content_id = "route-tips-content"
        tips_text_id = "route-tips-text"
        tips_parts: list[str] = []
        if transport:
            tips_parts.append(
                _t(lang, zh="交通建议：", en="Transport tips:", ja="交通：")
            )
            tips_parts.append(transport)
        if special_notes:
            tips_parts.append(_t(lang, zh="注意事项：", en="Notes:", ja="注意："))
            tips_parts.extend(str(x) for x in special_notes)

        components.append(_card(tips_id, tips_content_id))
        components.append(_column(tips_content_id, [tips_text_id], alignment="stretch"))
        components.append(_text(tips_text_id, "\n".join(tips_parts), usage_hint="body"))

        # Insert tips card right after route steps divider.
        root = components[0]["component"]["Column"]["children"]["explicitList"]
        insert_at = root.index("divider-2") + 1
        root[insert_at:insert_at] = [tips_id]

    return _surface_messages(surface_id, components, root_id="root")


def _surface_messages(
    surface_id: str, components: list[dict[str, Any]], *, root_id: str
) -> list[dict[str, Any]]:
    # Message ordering requirement: surfaceUpdate(s) → beginRendering.
    return [
        {"surfaceUpdate": {"surfaceId": surface_id, "components": components}},
        {"beginRendering": {"surfaceId": surface_id, "root": root_id}},
    ]


def _state_language(state: dict[str, Any]) -> str:
    extraction = state.get("extraction_result") or {}
    lang = extraction.get("user_language")
    if isinstance(lang, str) and lang:
        return lang
    return "zh-CN"


def _t(lang: str, *, zh: str, en: str, ja: str) -> str:
    if lang == "en":
        return en
    if lang == "ja":
        return ja
    return zh


def _value_literal_string(text: str) -> dict[str, Any]:
    return {"literalString": text}


def _text(
    component_id: str, text: str, *, usage_hint: str | None = None
) -> dict[str, Any]:
    payload: dict[str, Any] = {"text": _value_literal_string(text)}
    if usage_hint:
        payload["usageHint"] = usage_hint
    return {"id": component_id, "component": {"Text": payload}}


def _divider(component_id: str) -> dict[str, Any]:
    return {"id": component_id, "component": {"Divider": {"axis": "horizontal"}}}


def _image(component_id: str, url: str) -> dict[str, Any]:
    return {
        "id": component_id,
        "component": {"Image": {"url": _value_literal_string(url)}},
    }


def _row(
    component_id: str,
    children: Iterable[str],
    *,
    distribution: str | None = None,
    alignment: str | None = None,
) -> dict[str, Any]:
    row: dict[str, Any] = {"children": {"explicitList": list(children)}}
    if distribution:
        row["distribution"] = distribution
    if alignment:
        row["alignment"] = alignment
    return {"id": component_id, "component": {"Row": row}}


def _column(
    component_id: str,
    children: Iterable[str],
    *,
    distribution: str | None = None,
    alignment: str | None = None,
) -> dict[str, Any]:
    col: dict[str, Any] = {"children": {"explicitList": list(children)}}
    if distribution:
        col["distribution"] = distribution
    if alignment:
        col["alignment"] = alignment
    return {"id": component_id, "component": {"Column": col}}


def _card(component_id: str, child_id: str) -> dict[str, Any]:
    return {"id": component_id, "component": {"Card": {"child": child_id}}}


def _button_with_text(
    button_id: str,
    *,
    label: str,
    action_name: str,
    primary: bool,
) -> list[dict[str, Any]]:
    text_id = f"{button_id}-text"
    return [
        _text(text_id, label, usage_hint="body"),
        {
            "id": button_id,
            "component": {
                "Button": {
                    "child": text_id,
                    "primary": primary,
                    "action": {"name": action_name},
                }
            },
        },
    ]


def _points_in_planner_order(points: Any) -> list[dict[str, Any]]:
    if not isinstance(points, list):
        return []
    normalized: list[dict[str, Any]] = [p for p in points if isinstance(p, dict)]
    return sorted(normalized, key=_point_sort_key)


def _point_sort_key(p: dict[str, Any]) -> tuple[int, int]:
    episode = p.get("episode")
    if not isinstance(episode, int):
        episode = 99
    time_seconds = p.get("time_seconds")
    if not isinstance(time_seconds, int):
        time_seconds = 0
    return episode, time_seconds


def _build_google_maps_directions_url(
    *, origin: str, points: list[dict[str, Any]]
) -> str:
    coords: list[str] = []
    for p in points:
        lat = p.get("lat")
        lng = p.get("lng")
        if isinstance(lat, (int, float)) and isinstance(lng, (int, float)):
            coords.append(f"{lat},{lng}")

    if not coords:
        return ""

    origin_param = origin.strip() if isinstance(origin, str) else ""
    if not origin_param:
        origin_param = coords[0]

    destination = coords[-1]
    waypoints = coords[1:-1]

    params: list[str] = []
    params.append("api=1")
    params.append(f"origin={quote(origin_param)}")
    params.append(f"destination={quote(destination, safe=',')}")
    if waypoints:
        params.append(f"waypoints={quote('|'.join(waypoints), safe='|,')}")
    params.append("travelmode=transit")

    return "https://www.google.com/maps/dir/?" + "&".join(params)
