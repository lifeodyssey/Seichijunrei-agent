/* ── Landing page static data ── */

import type React from "react";

/** Shared image-error fallback: hides <img> and applies gradient to parent. */
export function handleImageError(e: React.SyntheticEvent<HTMLImageElement>) {
  const target = e.currentTarget;
  target.style.display = "none";
  const parent = target.parentElement;
  if (parent) {
    parent.style.background =
      "linear-gradient(135deg, oklch(88% 0.04 240), oklch(82% 0.06 260))";
  }
}

/* ── Anitabi floating photo cards ── */
export interface FloatCard {
  src: string;
  label: string;
  ep: string;
  cls: string;
  rotate: string;
}

export const FLOAT_CARDS: FloatCard[] = [
  {
    src: "https://image.anitabi.cn/points/115908/qys7fu.jpg?plan=h160",
    label: "京都コンサートホール",
    ep: "EP1",
    cls: "fc-1",
    rotate: "-3deg",
  },
  {
    src: "https://image.anitabi.cn/points/160209/al3yeri_1770054618536.jpg?plan=h160",
    label: "マンション桂",
    ep: "君の名は。",
    cls: "fc-2",
    rotate: "2deg",
  },
  {
    src: "https://image.anitabi.cn/points/115908/7evkbmy2.jpg?plan=h160",
    label: "あじろぎの道",
    ep: "EP1",
    cls: "fc-3",
    rotate: "-1deg",
  },
  {
    src: "https://image.anitabi.cn/points/160209/3ik9kj0e.jpg?plan=h160",
    label: "信濃町歩道橋",
    ep: "君の名は。",
    cls: "fc-4",
    rotate: "3deg",
  },
  {
    src: "https://image.anitabi.cn/points/115908/7eyih3xg.jpg?plan=h160",
    label: "莵道高",
    ep: "EP1",
    cls: "fc-5",
    rotate: "-2deg",
  },
  {
    src: "https://image.anitabi.cn/points/160209/3ik9kjew.jpg?plan=h160",
    label: "LABI新宿東口館前",
    ep: "君の名は。",
    cls: "fc-6",
    rotate: "1deg",
  },
];

/* ── Anime gallery ── */
export interface AnimeGalleryItem {
  bangumiId: string;
  title: string;
  count: string;
}

export const ANIME_GALLERY: AnimeGalleryItem[] = [
  { bangumiId: "115908", title: "響け！ユーフォニアム", count: "156 スポット · 宇治市" },
  { bangumiId: "160209", title: "君の名は。", count: "89 スポット · 新宿/飛騨" },
  { bangumiId: "269235", title: "天気の子", count: "72 スポット · 東京" },
  { bangumiId: "485", title: "涼宮ハルヒの憂鬱", count: "134 スポット · 西宮市" },
  { bangumiId: "1424", title: "けいおん！", count: "98 スポット · 京都/豊郷" },
  { bangumiId: "362577", title: "すずめの戸締まり", count: "65 スポット · 九州〜東北" },
  { bangumiId: "55113", title: "たまこまーけっと", count: "47 スポット · 出町柳" },
  { bangumiId: "27364", title: "氷菓", count: "82 スポット · 高山市" },
];

/* ── Float card position styles ── */
export const FLOAT_CARD_STYLES: Record<string, React.CSSProperties> = {
  "fc-1": { top: "18%", left: "8%", width: 140, height: 95 },
  "fc-2": { top: "28%", right: "12%", width: 160, height: 108 },
  "fc-3": { bottom: "30%", left: "6%", width: 130, height: 88 },
  "fc-4": { bottom: "22%", right: "8%", width: 150, height: 100 },
  "fc-5": { top: "50%", left: "18%", width: 120, height: 80 },
  "fc-6": { top: "14%", left: "35%", width: 110, height: 75 },
};

export const FLOAT_DELAYS: Record<string, string> = {
  "fc-1": "0.2s",
  "fc-2": "0.4s",
  "fc-3": "0.6s",
  "fc-4": "0.8s",
  "fc-5": "1.0s",
  "fc-6": "0.3s",
};
