/**
 * Server-authored answers for deterministic selections. These turns never
 * reach a model; unsupported locales use the English copy.
 */

/** The three languages the copy is authored in; anything else reads `en`. */
const COPY_LOCALES = ["en", "ja", "zh"] as const;
type CopyLocale = (typeof COPY_LOCALES)[number];

/** How a multi-work pick ended: the route was built, no work had spots, some work is still syncing,
 * too many spots to route, or the catalog could not answer. */
export type MultiOutcome = "ok" | "empty" | "partial" | "too_large" | "error";

/** How a place pick ended. */
export type PlaceOutcome = "ok" | "empty" | "error";

const SELECTED: Record<CopyLocale, string> = {
  en: "Created a route with {count} selected stops.",
  ja: "{count}件の選択スポットでルートを作成しました。",
  zh: "已为{count}处选定取景地规划路线。",
};

const MULTI: Record<CopyLocale, Record<MultiOutcome, string>> = {
  en: {
    ok: "Selected works were merged and routed.",
    empty: "No catalog spots exist for those works yet; choose different ones.",
    partial:
      "Those works are still syncing. Results are shown, but route planning is not ready yet; retry shortly.",
    too_large: "That selection has too many spots; narrow your selection.",
    error: "The catalog could not load those works; please retry.",
  },
  ja: {
    ok: "選択した作品のスポットをまとめてルートを作成しました。",
    empty: "選択した作品にはまだスポットがありません。別の作品を選んでください。",
    partial:
      "選択した作品は同期中です。結果は表示できますが、ルート作成はまだできません。しばらくしてからもう一度お試しください。",
    too_large: "スポットが多すぎます。選択する作品を減らしてください。",
    error: "作品データを取得できませんでした。もう一度お試しください。",
  },
  zh: {
    ok: "已合并所选作品的地点并规划路线。",
    empty: "所选作品暂时没有收录地点，请改选其他作品。",
    partial: "所选作品仍在同步中。当前可显示结果，但暂时不能规划路线，请稍后重试。",
    too_large: "地点过多，请减少所选作品。",
    error: "暂时无法载入这些作品，请重试。",
  },
};

const OMITTED: Record<CopyLocale, string> = {
  en: " Omitted works: {ids}.",
  ja: " 対象外の作品: {ids}。",
  zh: " 未纳入的作品：{ids}。",
};

const PLACE: Record<CopyLocale, Record<PlaceOutcome, string>> = {
  en: {
    ok: "Nearby search complete.",
    empty: "No pilgrimage spots were found near that place.",
    error: "Nearby search failed; please retry.",
  },
  ja: {
    ok: "周辺の聖地を検索しました。",
    empty: "その場所の周辺には聖地が見つかりませんでした。",
    error: "周辺検索に失敗しました。もう一度お試しください。",
  },
  zh: {
    ok: "已完成附近圣地搜索。",
    empty: "该地点附近没有找到巡礼地。",
    error: "附近搜索失败，请重试。",
  },
};

/** Python's `language = locale if locale in table else "en"`. */
function copyLocale(locale: string): CopyLocale {
  return COPY_LOCALES.find((known) => known === locale) ?? "en";
}

/** The wrapper around a route built from the points the user picked. */
export function selectedRouteMessage(locale: string, count: number): string {
  return SELECTED[copyLocale(locale)].replace("{count}", String(count));
}

/** The terminal sentence of a multi-work pick, disclosing what it left out. */
export function multiMessage(locale: string, outcome: MultiOutcome, omitted: readonly string[] = []): string {
  const language = copyLocale(locale);
  const message = MULTI[language][outcome];
  if (omitted.length === 0) return message;
  return message + OMITTED[language].replace("{ids}", omitted.join(", "));
}

/** The terminal sentence of a place pick. */
export function placeMessage(locale: string, outcome: PlaceOutcome): string {
  return PLACE[copyLocale(locale)][outcome];
}

/** Public refusal messages retain parity with the Python selection handlers. */
export const SELECTION_EXPIRED = "This choice expired; please try again.";
export const SELECTION_WRONG_MODE = "This clarification requires a different response mode.";
export const PLACE_SELECTION_EXPIRED = "This place choice expired; please try again.";
export const CATALOG_ROUTE_UNAVAILABLE = "Catalog route unavailable";
export const NO_CATALOG_ROUTE_DATA = "No catalog route data";
