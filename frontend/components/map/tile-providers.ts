/**
 * Map tile providers — centralized configuration for switching between
 * Mapbox, OpenStreetMap, AMap (高德), or other tile sources.
 *
 * To switch provider: change the `defaultProvider` export, or pass
 * `provider` prop to BaseMap.
 */

export type TileProvider = "mapbox" | "osm" | "amap";

interface TileConfig {
  url: string;
  attribution: string;
  tileSize: number;
  zoomOffset: number;
  maxZoom: number;
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

const providers: Record<TileProvider, TileConfig> = {
  mapbox: {
    url: `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}?access_token=${MAPBOX_TOKEN}`,
    attribution: '© <a href="https://www.mapbox.com/">Mapbox</a> © <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    tileSize: 512,
    zoomOffset: -1,
    maxZoom: 19,
  },
  osm: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    tileSize: 256,
    zoomOffset: 0,
    maxZoom: 19,
  },
  amap: {
    url: "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}",
    attribution: '© <a href="https://amap.com/">高德地图</a>',
    tileSize: 256,
    zoomOffset: 0,
    maxZoom: 18,
  },
};

/** Default provider — change this to switch globally */
export const defaultProvider: TileProvider = MAPBOX_TOKEN ? "mapbox" : "osm";

export function getTileConfig(provider?: TileProvider): TileConfig {
  return providers[provider ?? defaultProvider];
}
