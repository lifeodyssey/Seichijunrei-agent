/**
 * Rough bounding-box lookup for Japan prefectures/cities.
 * Returns the nearest city name for a lat/lng pair.
 * No API calls — baked-in data for the ~20 most common pilgrimage areas.
 *
 * Used to resolve "不明" (unknown) place names in Anitabi spot data.
 */

interface Region {
  name: string;
  nameJa: string;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

const REGIONS: Region[] = [
  { name: "Uji, Kyoto", nameJa: "宇治市", minLat: 34.87, maxLat: 34.93, minLng: 135.78, maxLng: 135.84 },
  { name: "Kyoto City", nameJa: "京都市", minLat: 34.93, maxLat: 35.08, minLng: 135.68, maxLng: 135.82 },
  { name: "Tokyo 23 Wards", nameJa: "東京都区部", minLat: 35.62, maxLat: 35.82, minLng: 139.60, maxLng: 139.92 },
  { name: "Kamakura", nameJa: "鎌倉市", minLat: 35.28, maxLat: 35.35, minLng: 139.50, maxLng: 139.58 },
  { name: "Chichibu", nameJa: "秩父市", minLat: 35.93, maxLat: 36.05, minLng: 138.95, maxLng: 139.12 },
  { name: "Numazu", nameJa: "沼津市", minLat: 35.05, maxLat: 35.15, minLng: 138.83, maxLng: 138.93 },
  { name: "Takayama", nameJa: "高山市", minLat: 36.10, maxLat: 36.20, minLng: 137.20, maxLng: 137.30 },
  { name: "Hida", nameJa: "飛騨市", minLat: 36.20, maxLat: 36.35, minLng: 137.15, maxLng: 137.30 },
  { name: "Onomichi", nameJa: "尾道市", minLat: 34.38, maxLat: 34.45, minLng: 133.15, maxLng: 133.25 },
  { name: "Nikko", nameJa: "日光市", minLat: 36.72, maxLat: 36.80, minLng: 139.58, maxLng: 139.72 },
  { name: "Hakodate", nameJa: "函館市", minLat: 41.72, maxLat: 41.82, minLng: 140.70, maxLng: 140.82 },
  { name: "Otaru", nameJa: "小樽市", minLat: 43.17, maxLat: 43.22, minLng: 140.95, maxLng: 141.02 },
  { name: "Nara", nameJa: "奈良市", minLat: 34.65, maxLat: 34.72, minLng: 135.78, maxLng: 135.85 },
  { name: "Osaka", nameJa: "大阪市", minLat: 34.60, maxLat: 34.72, minLng: 135.45, maxLng: 135.55 },
  { name: "Kobe", nameJa: "神戸市", minLat: 34.65, maxLat: 34.72, minLng: 135.15, maxLng: 135.25 },
  { name: "Yokohama", nameJa: "横浜市", minLat: 35.40, maxLat: 35.50, minLng: 139.58, maxLng: 139.72 },
  { name: "Nagoya", nameJa: "名古屋市", minLat: 35.10, maxLat: 35.22, minLng: 136.85, maxLng: 137.00 },
  { name: "Sapporo", nameJa: "札幌市", minLat: 43.00, maxLat: 43.12, minLng: 141.28, maxLng: 141.42 },
  { name: "Enoshima", nameJa: "江ノ島", minLat: 35.29, maxLat: 35.32, minLng: 139.47, maxLng: 139.50 },
  { name: "Tama / Chofu", nameJa: "調布市", minLat: 35.63, maxLat: 35.68, minLng: 139.52, maxLng: 139.58 },
];

export function resolveUnknownName(
  lat: number,
  lng: number,
  locale: "ja" | "zh" | "en" = "ja"
): string | null {
  for (const r of REGIONS) {
    if (lat >= r.minLat && lat <= r.maxLat && lng >= r.minLng && lng <= r.maxLng) {
      return locale === "en" ? r.name : r.nameJa;
    }
  }
  return null;
}
