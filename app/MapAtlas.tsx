"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";

type AreaLayer = "population" | "zoning" | "fire" | "flood" | "none";
type OverlayKey = "roads" | "rail" | "parks" | "landPrices" | "shelters" | "boundaries";

type GeoFeature = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
};

type GeoCollection = {
  type: "FeatureCollection";
  features: GeoFeature[];
};

type AtlasData = {
  meta: {
    populationDate: string;
    population: number;
    households: number;
    wardCount: number;
    townCount: number;
    stationCount: number;
    scopeArea: number;
    boundaryYear: number;
    zoningYear: string;
    railDate: string;
    roadsDate: string;
    fireYear: string;
    floodYear: string;
    parksDate: string;
    landPriceDate: string;
    sheltersDate: string;
    parkCount: number;
    landPriceCount: number;
    shelterCount: number;
  };
  scope: GeoFeature;
  city: GeoFeature;
  wards: GeoCollection;
  towns: GeoCollection;
  zoning: GeoCollection;
  fire: GeoCollection;
  flood: GeoCollection;
  parks: GeoCollection;
  landPrices: GeoCollection;
  shelters: GeoCollection;
  roads: GeoCollection;
  rail: GeoCollection;
  stations: GeoCollection;
};

type SearchItem = {
  name: string;
  ward: string;
  kind: "町丁目" | "駅";
  feature: GeoFeature;
};

type Detail = {
  eyebrow: string;
  title: string;
  rows: { label: string; value: string }[];
};

const ROAD_LAYER_IDS = ["roads-casing", "roads-line", "roads-hit"];
const RAIL_LAYER_IDS = ["rail-casing", "rail-line", "rail-hit", "stations", "station-core"];
const PARK_LAYER_IDS = ["parks-fill", "parks-outline"];
const LAND_PRICE_LAYER_IDS = ["land-prices-hit", "land-prices-halo", "land-prices"];
const SHELTER_LAYER_IDS = ["shelters-hit", "shelters-halo", "shelters"];

const POPULATION_LEGEND = [
  ["0", "#f4f1e8"],
  ["1–4,999", "#fff7bc"],
  ["5,000–9,999", "#fec44f"],
  ["10,000–19,999", "#fe9929"],
  ["20,000–29,999", "#e34a33"],
  ["30,000以上", "#b30000"],
];

const ZONING_LEGEND = [
  ["低層住居系", "#8fd694"],
  ["中高層住居系", "#4fb477"],
  ["住居系", "#ffd166"],
  ["近隣商業", "#f8961e"],
  ["商業", "#d81b60"],
  ["工業系", "#8b5cf6"],
];

const ROAD_LEGEND = [
  ["首都高速", "#cc79a7"],
  ["国道", "#d55e00"],
  ["都道・幹線", "#e69f00"],
  ["地区幹線", "#64748b"],
];

const RAIL_LEGEND = [
  ["JR", "#009e73"],
  ["東京メトロ", "#0072b2"],
  ["都営地下鉄", "#56b4e9"],
  ["その他", "#6f4e37"],
];

const FIRE_LEGEND = [
  ["防火地域", "#dc2626"],
  ["準防火地域", "#f59e0b"],
];

const FLOOD_LEGEND = [
  ["0.5m未満", "#d9f0ff"],
  ["0.5–3m", "#9bd7f0"],
  ["3–5m", "#4aa8d8"],
  ["5–10m", "#1479b8"],
  ["10–20m", "#7651a8"],
  ["20m以上", "#4b1d6b"],
];

const PARK_LEGEND = [
  ["公園", "#22a06b"],
  ["海上公園", "#008c95"],
];

const LAND_PRICE_LEGEND = [
  ["100万円未満", "#e9d5ff"],
  ["100–300万円", "#c084fc"],
  ["300–1,000万円", "#9333ea"],
  ["1,000万円以上", "#5b21b6"],
];

const SHELTER_LEGEND = [
  ["一般の指定避難所", "#0f766e"],
  ["福祉避難所", "#be185d"],
];

const FLOOD_DEPTH: Record<string, string> = {
  "1": "0.5m未満",
  "2": "0.5m以上3m未満",
  "3": "3m以上5m未満",
  "4": "5m以上10m未満",
  "5": "10m以上20m未満",
  "6": "20m以上",
};

const NUMBER = new Intl.NumberFormat("ja-JP");

function setLayerVisibility(map: MapLibreMap, ids: string[], visible: boolean) {
  ids.forEach((id) => {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
    }
  });
}

function boundsFor(feature: GeoFeature): [[number, number], [number, number]] {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  const visit = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (
      value.length >= 2 &&
      typeof value[0] === "number" &&
      typeof value[1] === "number"
    ) {
      west = Math.min(west, value[0]);
      south = Math.min(south, value[1]);
      east = Math.max(east, value[0]);
      north = Math.max(north, value[1]);
      return;
    }
    value.forEach(visit);
  };

  visit(feature.geometry.coordinates);
  return [[west, south], [east, north]];
}

function arrayValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [value];
  } catch {
    return [value];
  }
}

function textValue(value: unknown): string {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function numberValue(value: unknown, unit = ""): string {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${NUMBER.format(numeric)}${unit}` : "—";
}

function percentValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return `${numeric > 0 ? "+" : ""}${numeric.toFixed(1)}%`;
}

function detailFor(layerId: string, properties: Record<string, unknown>): Detail {
  const p = properties;
  if (layerId.includes("shelter")) {
    const kinds: Record<string, string> = { general: "一般の指定避難所", welfare: "福祉避難所" };
    return {
      eyebrow: "Shelter",
      title: String(p.n ?? "指定避難所"),
      rows: [
        { label: "区分", value: kinds[String(p.c)] ?? textValue(p.c) },
        { label: "区", value: textValue(p.w) },
        { label: "所在地", value: textValue(p.a) },
        { label: "受入対象者", value: textValue(p.t) },
        { label: "必要事項", value: textValue(p.m) },
        { label: "備考", value: textValue(p.r) },
      ],
    };
  }
  if (layerId.includes("land-price")) {
    return {
      eyebrow: "Land price",
      title: String(p.n ?? "地価公示地点"),
      rows: [
        { label: "区", value: textValue(p.w) },
        { label: "価格", value: numberValue(p.p, " 円/m²") },
        { label: "前年比", value: percentValue(p.q) },
        { label: "敷地面積", value: numberValue(p.a, " m²") },
        { label: "利用現況", value: textValue(p.u) },
        { label: "最寄駅", value: textValue(p.s) },
        { label: "駅距離", value: numberValue(p.d, " m") },
        { label: "用途地域", value: textValue(p.z) },
      ],
    };
  }
  if (layerId.includes("park")) {
    const kinds: Record<string, string> = { park: "公園", garden: "庭園", waterfront: "海上公園" };
    return {
      eyebrow: "Park",
      title: String(p.n ?? "公園・緑地"),
      rows: [
        { label: "区", value: textValue(p.w) },
        { label: "区分", value: kinds[String(p.c)] ?? textValue(p.t) },
        { label: "種別", value: textValue(p.t) },
        { label: "面積", value: numberValue(p.a, " m²") },
        { label: "所管", value: textValue(p.o) },
      ],
    };
  }
  if (layerId.includes("flood")) {
    return {
      eyebrow: "Flood",
      title: String(p.n ?? "洪水浸水想定区域"),
      rows: [
        { label: "浸水深", value: FLOOD_DEPTH[String(p.c)] ?? "—" },
        { label: "想定", value: textValue(p.s) },
      ],
    };
  }
  if (layerId.includes("fire")) {
    const kinds: Record<string, string> = { fire: "防火地域", semi: "準防火地域" };
    return {
      eyebrow: "Fire prevention",
      title: kinds[String(p.c)] ?? String(p.n ?? "防火指定"),
      rows: [
        { label: "区", value: textValue(p.w) },
        { label: "指定", value: String(p.n ?? kinds[String(p.c)] ?? "—") },
      ],
    };
  }
  if (layerId.includes("station")) {
    return {
      eyebrow: "Station",
      title: String(p.n ?? "駅"),
      rows: [
        { label: "所在", value: String(p.w ?? "—") },
        { label: "路線", value: arrayValue(p.r).join("・") || "—" },
        { label: "事業者", value: arrayValue(p.o).join("・") || "—" },
      ],
    };
  }
  if (layerId.includes("rail")) {
    return {
      eyebrow: "Railway",
      title: String(p.n ?? "鉄道路線"),
      rows: [{ label: "事業者", value: String(p.o ?? "—") }],
    };
  }
  if (layerId.includes("road")) {
    const classes: Record<string, string> = {
      x: "首都高速",
      n: "国道",
      m: "都道・幹線",
      d: "地区幹線",
    };
    return {
      eyebrow: "Road",
      title: String(p.n ?? "主要道路"),
      rows: [
        { label: "区分", value: classes[String(p.c)] ?? "主要道路" },
        { label: "路線番号", value: String(p.r || "—") },
      ],
    };
  }
  if (layerId.includes("zoning")) {
    return {
      eyebrow: "Zoning",
      title: String(p.n ?? "用途地域"),
      rows: [
        { label: "区", value: String(p.w ?? "—") },
        { label: "容積率", value: `${NUMBER.format(Number(p.f ?? 0))}%` },
        { label: "建ぺい率", value: `${NUMBER.format(Number(p.b ?? 0))}%` },
      ],
    };
  }
  return {
    eyebrow: "Population",
    title: String(p.n ?? "町丁目"),
    rows: [
      { label: "区", value: String(p.w ?? "—") },
      { label: "人口", value: `${NUMBER.format(Number(p.p ?? 0))} 人` },
      { label: "世帯", value: `${NUMBER.format(Number(p.h ?? 0))} 世帯` },
      { label: "人口密度", value: `${NUMBER.format(Math.round(Number(p.d ?? 0)))} 人/km²` },
      { label: "面積", value: `${(Number(p.a ?? 0) / 1_000_000).toFixed(3)} km²` },
    ],
  };
}

export function MapAtlas() {
  const mapElement = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const scopeRef = useRef<GeoFeature | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [areaLayer, setAreaLayer] = useState<AreaLayer>("none");
  const [overlays, setOverlays] = useState<Record<OverlayKey, boolean>>({
    roads: false,
    rail: false,
    parks: false,
    landPrices: false,
    shelters: false,
    boundaries: false,
  });
  const [detail, setDetail] = useState<Detail | null>(null);
  const [searchItems, setSearchItems] = useState<SearchItem[]>([]);
  const [query, setQuery] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [meta, setMeta] = useState<AtlasData["meta"] | null>(null);

  const filteredSearch = useMemo(() => {
    const value = query.trim().toLocaleLowerCase("ja");
    if (!value) return [];
    return searchItems
      .filter((item) => `${item.name}${item.ward}`.toLocaleLowerCase("ja").includes(value))
      .sort((a, b) => {
        const score = (item: SearchItem) => {
          const name = item.name.toLocaleLowerCase("ja");
          if (name === value) return 0;
          if (name.startsWith(value)) return 1;
          return 2;
        };
        return score(a) - score(b) || a.name.localeCompare(b.name, "ja");
      })
      .slice(0, 7);
  }, [query, searchItems]);

  useEffect(() => {
    if (!mapElement.current || mapRef.current) return;
    let disposed = false;

    Promise.all([
      import("maplibre-gl"),
      fetch("data/map-data.json").then((response) => {
        if (!response.ok) throw new Error("地図データを読み込めませんでした");
        return response.json() as Promise<AtlasData>;
      }),
    ])
      .then(([maplibregl, data]) => {
        if (disposed || !mapElement.current) return;
        scopeRef.current = data.scope;
        setMeta(data.meta);

        const map = new maplibregl.Map({
          container: mapElement.current,
          center: [139.754, 35.689],
          zoom: 12.8,
          minZoom: 10,
          maxZoom: 18.5,
          pitchWithRotate: false,
          dragRotate: false,
          attributionControl: false,
          style: {
            version: 8,
            sources: {
              photo: {
                type: "raster",
                tiles: ["https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg"],
                tileSize: 256,
                maxzoom: 18,
                attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">国土地理院</a>',
              },
            },
            layers: [
              {
                id: "base-photo",
                type: "raster",
                source: "photo",
                paint: {
                  "raster-saturation": -0.42,
                  "raster-contrast": -0.1,
                  "raster-brightness-max": 0.9,
                },
              },
            ],
          },
        });

        mapRef.current = map;
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
        map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

        map.on("load", () => {
          map.addSource("towns", { type: "geojson", data: data.towns as never });
          map.addSource("zoning", { type: "geojson", data: data.zoning as never });
          map.addSource("fire", {
            type: "geojson",
            data: data.fire as never,
            attribution: '防火指定：<a href="https://www.mlit.go.jp/toshi/tosiko/toshi_tosiko_tk_000087.html" target="_blank">国土交通省</a>',
          });
          map.addSource("flood", {
            type: "geojson",
            data: data.flood as never,
            attribution: '洪水浸水：<a href="https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A31a-2025.html" target="_blank">国土数値情報</a>',
          });
          map.addSource("parks", {
            type: "geojson",
            data: data.parks as never,
            attribution: '公園・緑地：<a href="https://catalog.data.metro.tokyo.lg.jp/dataset/t000008d2000000024" target="_blank">東京都</a>',
          });
          map.addSource("land-prices", {
            type: "geojson",
            data: data.landPrices as never,
            attribution: '地価公示：<a href="https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-L01-2026.html" target="_blank">国土数値情報</a>',
          });
          map.addSource("shelters", {
            type: "geojson",
            data: data.shelters as never,
            attribution: '指定避難所：<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">国土地理院</a>',
          });
          map.addSource("roads", {
            type: "geojson",
            data: data.roads as never,
            attribution: '道路 © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a>',
          });
          map.addSource("rail", { type: "geojson", data: data.rail as never });
          map.addSource("stations", { type: "geojson", data: data.stations as never });
          map.addSource("wards", { type: "geojson", data: data.wards as never });
          map.addSource("city", { type: "geojson", data: data.city as never });
          map.addSource("selection", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });

          map.addLayer({
            id: "population-fill",
            type: "fill",
            source: "towns",
            layout: { visibility: "none" },
            paint: {
              "fill-color": [
                "interpolate", ["linear"], ["get", "d"],
                0, "#f4f1e8", 1, "#fff7bc", 5000, "#fec44f",
                10000, "#fe9929", 20000, "#e34a33", 30000, "#b30000",
              ],
              "fill-opacity": [
                "interpolate", ["linear"], ["get", "d"],
                0, 0.1, 1, 0.34, 10000, 0.44, 30000, 0.54, 60000, 0.6,
              ],
              "fill-outline-color": "rgba(255,255,255,0.62)",
            },
          });
          map.addLayer({
            id: "zoning-fill",
            type: "fill",
            source: "zoning",
            layout: { visibility: "none" },
            paint: {
              "fill-color": [
                "match", ["get", "g"],
                "low", "#8fd694",
                "mid", "#4fb477",
                "residential", "#ffd166",
                "neighborhood", "#f8961e",
                "commercial", "#d81b60",
                "industrial", "#8b5cf6",
                "#9ca3af",
              ],
              "fill-opacity": 0.46,
              "fill-outline-color": "rgba(255,255,255,0.72)",
            },
          });
          map.addLayer({
            id: "fire-fill",
            type: "fill",
            source: "fire",
            layout: { visibility: "none" },
            paint: {
              "fill-color": [
                "match", ["get", "c"],
                "fire", "#dc2626",
                "semi", "#f59e0b",
                "#9ca3af",
              ],
              "fill-opacity": 0.3,
              "fill-outline-color": "rgba(255,255,255,0.62)",
            },
          });
          map.addLayer({
            id: "flood-fill",
            type: "fill",
            source: "flood",
            layout: { visibility: "none" },
            paint: {
              "fill-color": [
                "match", ["get", "c"],
                1, "#d9f0ff",
                2, "#9bd7f0",
                3, "#4aa8d8",
                4, "#1479b8",
                5, "#7651a8",
                6, "#4b1d6b",
                "#9bd7f0",
              ],
              "fill-opacity": 0.38,
              "fill-outline-color": "rgba(255,255,255,0.35)",
            },
          });
          map.addLayer({
            id: "parks-fill",
            type: "fill",
            source: "parks",
            layout: { visibility: "none" },
            paint: {
              "fill-color": [
                "match", ["get", "c"],
                "park", "#22a06b",
                "garden", "#72a83b",
                "waterfront", "#008c95",
                "#22a06b",
              ],
              "fill-opacity": 0.48,
            },
          });
          map.addLayer({
            id: "parks-outline",
            type: "line",
            source: "parks",
            layout: { visibility: "none" },
            paint: {
              "line-color": "rgba(255,255,255,0.92)",
              "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.7, 17, 1.5],
            },
          });
          map.addLayer({
            id: "town-boundaries",
            type: "line",
            source: "towns",
            layout: { visibility: "none" },
            paint: {
              "line-color": "#ffffff",
              "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.8, 16, 1.5],
              "line-opacity": 0.86,
              "line-dasharray": [2, 1.5],
            },
          });
          map.addLayer({
            id: "roads-casing",
            type: "line",
            source: "roads",
            layout: { visibility: "none" },
            paint: {
              "line-color": "#fffdf8",
              "line-width": [
                "interpolate", ["linear"], ["zoom"],
                11, ["match", ["get", "c"], "x", 4.8, "n", 4.5, "m", 3.9, 3.1],
                17, ["match", ["get", "c"], "x", 9, "n", 8, "m", 6.8, 5.1],
              ],
              "line-opacity": 0.94,
            },
          });
          map.addLayer({
            id: "roads-line",
            type: "line",
            source: "roads",
            layout: { visibility: "none" },
            paint: {
              "line-color": [
                "match", ["get", "c"],
                "x", "#cc79a7", "n", "#d55e00", "m", "#e69f00", "#64748b",
              ],
              "line-width": [
                "interpolate", ["linear"], ["zoom"],
                11, ["match", ["get", "c"], "x", 3, "n", 2.8, "m", 2.3, 1.7],
                17, ["match", ["get", "c"], "x", 7, "n", 6, "m", 4.8, 3.3],
              ],
              "line-opacity": 0.98,
            },
          });
          map.addLayer({
            id: "roads-hit",
            type: "line",
            source: "roads",
            layout: { visibility: "none" },
            paint: { "line-color": "#ffffff", "line-width": 14, "line-opacity": 0.01 },
          });
          map.addLayer({
            id: "rail-casing",
            type: "line",
            source: "rail",
            layout: { visibility: "none" },
            paint: {
              "line-color": "#fffdf8",
              "line-width": ["interpolate", ["linear"], ["zoom"], 11, 5, 17, 8],
              "line-opacity": 0.96,
            },
          });
          map.addLayer({
            id: "rail-line",
            type: "line",
            source: "rail",
            layout: { visibility: "none" },
            paint: {
              "line-color": [
                "match", ["get", "c"],
                "jr", "#009e73", "metro", "#0072b2", "toei", "#56b4e9", "#6f4e37",
              ],
              "line-width": ["interpolate", ["linear"], ["zoom"], 11, 3, 17, 5.4],
              "line-opacity": 0.98,
            },
          });
          map.addLayer({
            id: "rail-hit",
            type: "line",
            source: "rail",
            layout: { visibility: "none" },
            paint: { "line-color": "#ffffff", "line-width": 15, "line-opacity": 0.01 },
          });
          map.addLayer({
            id: "stations",
            type: "circle",
            source: "stations",
            layout: { visibility: "none" },
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3.8, 16, 6],
              "circle-color": "#fffdf8",
              "circle-stroke-color": "#17211f",
              "circle-stroke-width": 2,
            },
          });
          map.addLayer({
            id: "station-core",
            type: "circle",
            source: "stations",
            layout: { visibility: "none" },
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 1.5, 16, 2.6],
              "circle-color": "#c95535",
            },
          });
          map.addLayer({
            id: "land-prices-hit",
            type: "circle",
            source: "land-prices",
            layout: { visibility: "none" },
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 14, 16, 18],
              "circle-color": "#ffffff",
              "circle-opacity": 0.01,
            },
          });
          map.addLayer({
            id: "land-prices-halo",
            type: "circle",
            source: "land-prices",
            layout: { visibility: "none" },
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 4.5, 16, 8],
              "circle-color": "#17211f",
              "circle-opacity": 0.88,
            },
          });
          map.addLayer({
            id: "land-prices",
            type: "circle",
            source: "land-prices",
            layout: { visibility: "none" },
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3.1, 16, 6.2],
              "circle-color": [
                "step", ["to-number", ["get", "p"]],
                "#e9d5ff",
                1000000, "#c084fc",
                3000000, "#9333ea",
                10000000, "#5b21b6",
              ],
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 1.2,
            },
          });
          map.addLayer({
            id: "shelters-hit",
            type: "circle",
            source: "shelters",
            layout: { visibility: "none" },
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 14, 16, 18],
              "circle-color": "#ffffff",
              "circle-opacity": 0.01,
            },
          });
          map.addLayer({
            id: "shelters-halo",
            type: "circle",
            source: "shelters",
            layout: { visibility: "none" },
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 5, 16, 8.5],
              "circle-color": "#17211f",
              "circle-opacity": 0.9,
            },
          });
          map.addLayer({
            id: "shelters",
            type: "circle",
            source: "shelters",
            layout: { visibility: "none" },
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3.5, 16, 6.7],
              "circle-color": [
                "match", ["get", "c"],
                "general", "#0f766e",
                "welfare", "#be185d",
                "#0f766e",
              ],
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 1.2,
            },
          });
          map.addLayer({
            id: "ward-boundaries-halo",
            type: "line",
            source: "wards",
            paint: {
              "line-color": "#101827",
              "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2.8, 17, 4.2],
              "line-opacity": 0.68,
            },
          });
          map.addLayer({
            id: "ward-boundaries",
            type: "line",
            source: "wards",
            paint: {
              "line-color": "#ffffff",
              "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.1, 17, 1.8],
              "line-opacity": 0.96,
            },
          });
          map.addLayer({
            id: "city-outline-halo",
            type: "line",
            source: "city",
            paint: {
              "line-color": "#101827",
              "line-width": ["interpolate", ["linear"], ["zoom"], 10, 4.8, 17, 7],
              "line-opacity": 0.92,
            },
          });
          map.addLayer({
            id: "city-outline",
            type: "line",
            source: "city",
            paint: {
              "line-color": "#fde047",
              "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2.3, 17, 3.6],
              "line-opacity": 1,
            },
          });
          map.addLayer({
            id: "selection-fill",
            type: "fill",
            source: "selection",
            paint: { "fill-color": "#d7ff45", "fill-opacity": 0.3 },
          });
          map.addLayer({
            id: "selection-line",
            type: "line",
            source: "selection",
            paint: { "line-color": "#111916", "line-width": 4 },
          });
          map.addLayer({
            id: "selection-point",
            type: "circle",
            source: "selection",
            filter: ["==", ["geometry-type"], "Point"],
            paint: {
              "circle-radius": 9,
              "circle-color": "#d7ff45",
              "circle-stroke-color": "#111916",
              "circle-stroke-width": 3,
            },
          });

          data.wards.features.forEach((feature) => {
            const element = document.createElement("div");
            element.className = `ward-map-label${feature.properties.f ? " is-focus" : ""}`;
            element.textContent = String(feature.properties.n);
            element.setAttribute("aria-hidden", "true");
            new maplibregl.Marker({ element, anchor: "center" })
              .setLngLat([Number(feature.properties.x), Number(feature.properties.y)])
              .addTo(map);
          });

          const allSearch: SearchItem[] = [
            ...data.towns.features.map((feature) => ({
              name: String(feature.properties.n),
              ward: String(feature.properties.w ?? ""),
              kind: "町丁目" as const,
              feature,
            })),
            ...data.stations.features.map((feature) => ({
              name: String(feature.properties.n),
              ward: String(feature.properties.w ?? ""),
              kind: "駅" as const,
              feature,
            })),
          ].sort((a, b) => a.name.localeCompare(b.name, "ja"));
          setSearchItems(allSearch);

          const clickable = [
            "shelters", "shelters-hit", "land-prices", "land-prices-hit",
            "station-core", "stations", "rail-hit", "roads-hit",
            "parks-fill", "flood-fill", "fire-fill", "zoning-fill", "population-fill",
          ];
          map.on("mousemove", (event) => {
            const hit = map.queryRenderedFeatures(event.point, { layers: clickable }).length > 0;
            map.getCanvas().style.cursor = hit ? "pointer" : "";
          });
          map.on("click", (event) => {
            const feature = map.queryRenderedFeatures(event.point, { layers: clickable })[0];
            const source = map.getSource("selection") as GeoJSONSource;
            if (!feature) {
              setDetail(null);
              source.setData({ type: "FeatureCollection", features: [] });
              return;
            }
            setDetail(detailFor(feature.layer.id, feature.properties ?? {}));
            source.setData(
              feature.layer.id === "flood-fill"
                ? { type: "FeatureCollection", features: [] }
                : {
                    type: "FeatureCollection",
                    features: [{ type: "Feature", properties: {}, geometry: feature.geometry }],
                  },
            );
          });

          map.fitBounds(boundsFor(data.scope), { padding: 42, duration: 0 });
          setReady(true);
        });

        map.on("error", (event) => {
          if (String(event.error?.message ?? "").includes("tile")) return;
        });
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "地図の初期化に失敗しました");
      });

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setLayerVisibility(map, ["population-fill"], areaLayer === "population");
    setLayerVisibility(map, ["zoning-fill"], areaLayer === "zoning");
    setLayerVisibility(map, ["fire-fill"], areaLayer === "fire");
    setLayerVisibility(map, ["flood-fill"], areaLayer === "flood");
  }, [areaLayer, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setLayerVisibility(map, ROAD_LAYER_IDS, overlays.roads);
    setLayerVisibility(map, RAIL_LAYER_IDS, overlays.rail);
    setLayerVisibility(map, PARK_LAYER_IDS, overlays.parks);
    setLayerVisibility(map, LAND_PRICE_LAYER_IDS, overlays.landPrices);
    setLayerVisibility(map, SHELTER_LAYER_IDS, overlays.shelters);
    setLayerVisibility(map, ["town-boundaries"], overlays.boundaries);
  }, [overlays, ready]);

  const clearSelection = () => {
    setDetail(null);
    const source = mapRef.current?.getSource("selection") as GeoJSONSource | undefined;
    source?.setData({ type: "FeatureCollection", features: [] });
  };

  const changeArea = (value: AreaLayer) => {
    setAreaLayer(value);
    clearSelection();
  };

  const toggleOverlay = (key: OverlayKey) => {
    setOverlays((current) => ({ ...current, [key]: !current[key] }));
    clearSelection();
  };

  const resetMap = () => {
    if (!mapRef.current || !scopeRef.current) return;
    mapRef.current.fitBounds(boundsFor(scopeRef.current), { padding: 42, duration: 600 });
  };

  const selectSearchItem = (item: SearchItem) => {
    const map = mapRef.current;
    if (!map) return;
    setQuery("");
    setPanelOpen(false);
    if (item.feature.geometry.type === "Point") {
      const coordinate = item.feature.geometry.coordinates as [number, number];
      map.flyTo({ center: coordinate, zoom: 15.5, duration: 650 });
      setDetail(detailFor("station-core", item.feature.properties));
    } else {
      map.fitBounds(boundsFor(item.feature), { padding: 90, maxZoom: 15.2, duration: 650 });
      setDetail(detailFor("population-fill", item.feature.properties));
    }
    const source = map.getSource("selection") as GeoJSONSource;
    source?.setData({ type: "FeatureCollection", features: [item.feature] } as never);
  };

  const legendGroups = useMemo(() => {
    const groups: { title: string; items: string[][] }[] = [];
    if (areaLayer === "population") groups.push({ title: "人口密度（人/km²）", items: POPULATION_LEGEND });
    if (areaLayer === "zoning") groups.push({ title: "用途地域", items: ZONING_LEGEND });
    if (areaLayer === "fire") groups.push({ title: "防火指定", items: FIRE_LEGEND });
    if (areaLayer === "flood") groups.push({ title: "洪水浸水想定", items: FLOOD_LEGEND });
    if (overlays.roads) groups.push({ title: "主要道路", items: ROAD_LEGEND });
    if (overlays.rail) groups.push({ title: "鉄道", items: RAIL_LEGEND });
    if (overlays.parks) groups.push({ title: "公園・緑地", items: PARK_LEGEND });
    if (overlays.landPrices) groups.push({ title: "地価公示（円/m²）", items: LAND_PRICE_LEGEND });
    if (overlays.shelters) groups.push({ title: "指定避難所", items: SHELTER_LEGEND });
    return groups;
  }, [areaLayer, overlays]);

  return (
    <div className="atlas-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-kicker">Chiyoda &amp; neighbors · Base atlas</div>
          <h1>千代田区＋隣接区ベースアトラス</h1>
        </div>
        <div className="metrics" aria-label="対象地域の基礎指標">
          <Metric label="対象" value={meta ? NUMBER.format(meta.wardCount) : "—"} unit="区" />
          <Metric label="人口" value={meta ? NUMBER.format(meta.population) : "—"} unit="人" />
          <Metric label="町丁目" value={meta ? NUMBER.format(meta.townCount) : "—"} unit="地区" />
          <Metric label="駅" value={meta ? NUMBER.format(meta.stationCount) : "—"} unit="駅" />
        </div>
      </header>

      <main className="workspace">
        <button
          className={`panel-scrim ${panelOpen ? "is-open" : ""}`}
          onClick={() => setPanelOpen(false)}
          aria-label="操作パネルを閉じる"
          aria-hidden={!panelOpen}
          tabIndex={panelOpen ? 0 : -1}
        />
        <aside id="layer-panel" className={`sidebar ${panelOpen ? "is-open" : ""}`} aria-label="地図の操作">
          <div className="sidebar-inner">
            <div className="sidebar-header">
              <div>
                <h2 className="section-title">Explore the city</h2>
                <p>見たい情報だけを、航空写真に重ねます。</p>
              </div>
              <button
                className="close-panel"
                onClick={() => setPanelOpen(false)}
                aria-label="閉じる"
                aria-controls="layer-panel"
                aria-expanded={panelOpen}
              >×</button>
            </div>

            <section className="search-wrap">
              <h2 className="section-title">町丁目・駅を探す</h2>
              <div className="search-field">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="例：神田、新宿、上野"
                  aria-label="町丁目・駅を検索"
                  autoComplete="off"
                />
              </div>
              {filteredSearch.length > 0 && (
                <div className="search-results">
                  {filteredSearch.map((item, index) => (
                    <button className="search-result" key={`${item.kind}-${item.ward}-${item.name}-${index}`} onClick={() => selectSearchItem(item)}>
                      <span>{item.name}</span><small>{item.kind} · {item.ward}</small>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h2 className="section-title">面の情報</h2>
              <div className="segment-control">
                {(["population", "zoning", "fire", "flood", "none"] as AreaLayer[]).map((value) => (
                  <button
                    key={value}
                    className={`segment-button ${areaLayer === value ? "active" : ""}`}
                    onClick={() => changeArea(value)}
                    aria-pressed={areaLayer === value}
                  >
                    {{ population: "人口密度", zoning: "用途地域", fire: "防火指定", flood: "洪水浸水", none: "表示なし" }[value]}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h2 className="section-title">重ねる情報</h2>
              <div className="toggle-list">
                <Toggle label="主要道路" active={overlays.roads} onClick={() => toggleOverlay("roads")} />
                <Toggle label="鉄道・駅" active={overlays.rail} onClick={() => toggleOverlay("rail")} />
                <Toggle label="公園・緑地" active={overlays.parks} onClick={() => toggleOverlay("parks")} />
                <Toggle label="地価公示" active={overlays.landPrices} onClick={() => toggleOverlay("landPrices")} />
                <Toggle label="指定避難所" active={overlays.shelters} onClick={() => toggleOverlay("shelters")} />
                <Toggle label="町丁目境界" active={overlays.boundaries} onClick={() => toggleOverlay("boundaries")} />
              </div>
            </section>

            <div className="source-line">
              対象：千代田・中央・港・新宿・文京・台東／人口：東京都（2026-01-01）／境界：2020年国勢調査／用途地域・防火指定・洪水・地価・鉄道：国土交通省／公園・緑地：東京都／指定避難所・航空写真：
              <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">国土地理院</a>
              ／道路：© OpenStreetMap contributors
            </div>
          </div>
        </aside>

        <section className="map-stage" aria-label="千代田区と隣接5区の地図">
          <div ref={mapElement} className="map-canvas" />
          {!ready && (
            <div className={`map-loading ${error ? "map-error" : ""}`} role="status">
              <div className="loading-inner">{error || "MAP DATA LOADING"}</div>
            </div>
          )}
          <button
            className="mobile-controls"
            onClick={() => setPanelOpen(true)}
            aria-controls="layer-panel"
            aria-expanded={panelOpen}
          >☰ レイヤー</button>
          <div className="map-top-actions">
            <button className="map-action" onClick={resetMap}>6区全体へ戻る</button>
          </div>

          {legendGroups.length > 0 && (
            <aside className="legend-card" aria-label="凡例">
              {legendGroups.map((group) => (
                <div key={group.title} style={{ marginBottom: 9 }}>
                  <h2 className="legend-title">{group.title}</h2>
                  <div className="legend-list">
                    {group.items.map(([label, color]) => (
                      <div className="legend-item" key={label}>
                        <span className="legend-swatch" style={{ background: color }} />
                        <span>{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </aside>
          )}

          {detail && (
            <aside className="detail-card" aria-live="polite">
              <div className="detail-eyebrow">{detail.eyebrow}</div>
              <h2 className="detail-title">{detail.title}</h2>
              <dl className="detail-grid">
                {detail.rows.map((row) => (
                  <div className="detail-item" key={row.label}>
                    <dt>{row.label}</dt><dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </aside>
          )}
        </section>
      </main>
    </div>
  );
}

function Metric({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}<span className="metric-unit">{unit}</span></span>
    </div>
  );
}

function Toggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={`toggle-row ${active ? "active" : ""}`} onClick={onClick} aria-pressed={active}>
      <span>{label}</span><span className="switch" aria-hidden="true" />
    </button>
  );
}
