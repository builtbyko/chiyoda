"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { buildLocationData, geolocationErrorMessage } from "./geolocation";
import { createLazyGeoJsonLoader } from "./lazyGeoJson";

type AreaLayer = "population" | "daytime" | "landUse" | "zoning" | "fire" | "flood" | "none";
type OverlayKey =
  | "roads"
  | "rail"
  | "parks"
  | "landPrices"
  | "shelters"
  | "boundaries"
  | "districtPlans"
  | "heightDistricts"
  | "specialZones"
  | "redevelopment"
  | "chiyodaRegions"
  | "landscapeProperties";
type PhotoEpoch = "latest" | "1987" | "1984" | "1979" | "1974" | "1961" | "1945" | "1936";

type GeoFeature = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
};

type GeoCollection = {
  type: "FeatureCollection";
  features: GeoFeature[];
};

type DatasetKey =
  | "towns"
  | "zoning"
  | "fire"
  | "flood"
  | "parks"
  | "landPrices"
  | "shelters"
  | "roads"
  | "rail"
  | "stations"
  | "districtPlans"
  | "heightDistricts"
  | "specialZones"
  | "redevelopment"
  | "chiyodaRegions"
  | "landscapeProperties";

type AtlasData = {
  meta: {
    populationDate: string;
    population: number;
    households: number;
    chiyodaArea: number;
    chiyodaPopulation: number;
    chiyodaDaytimePopulation: number;
    chiyodaDayNightRatio: number;
    daytimeYear: string;
    landUseYear: string;
    districtPlanDate: string;
    heightDistrictDate: string;
    specialZoneDate: string;
    redevelopmentDate: string;
    chiyodaRegionDate: string;
    landscapePropertyDate: string;
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
    districtPlanCount: number;
    heightDistrictCount: number;
    specialZoneCount: number;
    redevelopmentCount: number;
    chiyodaRegionCount: number;
    landscapePropertyCount: number;
  };
  scope: GeoFeature;
  city: GeoFeature;
  wards: GeoCollection;
  searchTypes: {
    d: DatasetKey;
    k: SearchItem["kind"];
    l: string;
  }[];
  search: [name: string, ward: string, typeIndex: number, featureIndex: number][];
};

type SearchItem = {
  name: string;
  ward: string;
  kind: "町丁目" | "駅" | "公園" | "地区計画" | "特例地区" | "再開発" | "7地域" | "景観重要物件";
  layerId: string;
  dataset: DatasetKey;
  featureIndex: number;
};

type Detail = {
  eyebrow: string;
  title: string;
  rows: { label: string; value: string }[];
  note?: string;
  sources?: { label: string; url: string }[];
  items?: {
    name: string;
    type: string;
    address: string;
    date: string;
    url: string;
  }[];
};

const ROAD_LAYER_IDS = ["roads-casing", "roads-line", "roads-hit"];
const RAIL_LAYER_IDS = ["rail-casing", "rail-line", "rail-hit", "stations", "station-core"];
const PARK_LAYER_IDS = ["parks-fill", "parks-outline"];
const LAND_PRICE_LAYER_IDS = ["land-prices-hit", "land-prices-halo", "land-prices"];
const SHELTER_LAYER_IDS = ["shelters-hit", "shelters-halo", "shelters"];
const DISTRICT_PLAN_LAYER_IDS = ["district-plans-casing", "district-plans-line", "district-plans-hit"];
const HEIGHT_DISTRICT_LAYER_IDS = ["height-districts-fill", "height-districts-line"];
const SPECIAL_ZONE_LAYER_IDS = ["special-zones-fill", "special-zones-line", "special-zones-hit"];
const REDEVELOPMENT_LAYER_IDS = ["redevelopment-hit", "redevelopment-halo", "redevelopment-points"];
const CHIYODA_REGION_LAYER_IDS = ["chiyoda-regions-fill", "chiyoda-regions-line", "chiyoda-regions-label"];
const LANDSCAPE_PROPERTY_LAYER_IDS = ["landscape-properties-hit", "landscape-properties-halo", "landscape-properties-points"];

const EMPTY_COLLECTION: GeoCollection = { type: "FeatureCollection", features: [] };

const DATASET_FILES: Record<DatasetKey, string> = {
  towns: "towns.json",
  zoning: "zoning.json",
  fire: "fire.json",
  flood: "flood.json",
  parks: "parks.json",
  landPrices: "land-prices.json",
  shelters: "shelters.json",
  roads: "roads.json",
  rail: "rail.json",
  stations: "stations.json",
  districtPlans: "district-plans.json",
  heightDistricts: "height-districts.json",
  specialZones: "special-zones.json",
  redevelopment: "redevelopment.json",
  chiyodaRegions: "chiyoda-regions.json",
  landscapeProperties: "landscape-properties.json",
};

const DATASET_SOURCES: Record<DatasetKey, string> = {
  towns: "towns",
  zoning: "zoning",
  fire: "fire",
  flood: "flood",
  parks: "parks",
  landPrices: "land-prices",
  shelters: "shelters",
  roads: "roads",
  rail: "rail",
  stations: "stations",
  districtPlans: "district-plans",
  heightDistricts: "height-districts",
  specialZones: "special-zones",
  redevelopment: "redevelopment",
  chiyodaRegions: "chiyoda-regions",
  landscapeProperties: "landscape-properties",
};

const AREA_DATASETS: Partial<Record<AreaLayer, DatasetKey>> = {
  population: "towns",
  daytime: "towns",
  landUse: "towns",
  zoning: "zoning",
  fire: "fire",
  flood: "flood",
};

const OVERLAY_DATASETS: Record<OverlayKey, DatasetKey[]> = {
  roads: ["roads"],
  rail: ["rail", "stations"],
  parks: ["parks"],
  landPrices: ["landPrices"],
  shelters: ["shelters"],
  boundaries: ["towns"],
  districtPlans: ["districtPlans"],
  heightDistricts: ["heightDistricts"],
  specialZones: ["specialZones"],
  redevelopment: ["redevelopment"],
  chiyodaRegions: ["chiyodaRegions"],
  landscapeProperties: ["landscapeProperties"],
};

const LAYER_LABELS: Record<AreaLayer | OverlayKey, string> = {
  population: "住民密度",
  daytime: "昼間人口",
  landUse: "実土地利用",
  zoning: "用途地域",
  fire: "防火指定",
  flood: "洪水浸水",
  none: "面表示",
  roads: "主要道路",
  rail: "鉄道・駅",
  parks: "公園・緑地",
  landPrices: "地価公示",
  shelters: "指定避難所",
  boundaries: "町丁目境界",
  districtPlans: "地区計画",
  heightDistricts: "高度地区",
  specialZones: "容積・再開発等の特例",
  redevelopment: "事業中の再開発",
  chiyodaRegions: "千代田区の7地域",
  landscapeProperties: "景観まちづくり重要物件",
};

const DATASET_LABELS: Record<DatasetKey, string> = {
  towns: "町丁目",
  zoning: "用途地域",
  fire: "防火指定",
  flood: "洪水浸水",
  parks: "公園・緑地",
  landPrices: "地価公示",
  shelters: "指定避難所",
  roads: "主要道路",
  rail: "鉄道",
  stations: "駅",
  districtPlans: "地区計画",
  heightDistricts: "高度地区",
  specialZones: "容積・再開発等の特例",
  redevelopment: "事業中の再開発",
  chiyodaRegions: "千代田区の7地域",
  landscapeProperties: "景観まちづくり重要物件",
};

const PHOTO_OPTIONS: { value: PhotoEpoch; label: string; tile: string; maxzoom: number }[] = [
  { value: "latest", label: "最新", tile: "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg", maxzoom: 18 },
  { value: "1987", label: "1987–1990年", tile: "https://cyberjapandata.gsi.go.jp/xyz/gazo4/{z}/{x}/{y}.jpg", maxzoom: 17 },
  { value: "1984", label: "1984–1986年", tile: "https://cyberjapandata.gsi.go.jp/xyz/gazo3/{z}/{x}/{y}.jpg", maxzoom: 17 },
  { value: "1979", label: "1979–1983年", tile: "https://cyberjapandata.gsi.go.jp/xyz/gazo2/{z}/{x}/{y}.jpg", maxzoom: 17 },
  { value: "1974", label: "1974–1978年", tile: "https://cyberjapandata.gsi.go.jp/xyz/gazo1/{z}/{x}/{y}.jpg", maxzoom: 17 },
  { value: "1961", label: "1961–1969年", tile: "https://cyberjapandata.gsi.go.jp/xyz/ort_old10/{z}/{x}/{y}.png", maxzoom: 17 },
  { value: "1945", label: "1945–1950年", tile: "https://cyberjapandata.gsi.go.jp/xyz/ort_USA10/{z}/{x}/{y}.png", maxzoom: 17 },
  { value: "1936", label: "1936–1942年頃", tile: "https://cyberjapandata.gsi.go.jp/xyz/ort_riku10/{z}/{x}/{y}.png", maxzoom: 18 },
];

const POPULATION_LEGEND = [
  ["0", "#f4f1e8"],
  ["1–4,999", "#fff7bc"],
  ["5,000–9,999", "#fec44f"],
  ["10,000–19,999", "#fe9929"],
  ["20,000–29,999", "#e34a33"],
  ["30,000以上", "#b30000"],
];

const DAYTIME_LEGEND = [
  ["1万人未満", "#e8f6ff"],
  ["1–3万人", "#b9e3f7"],
  ["3–6万人", "#73c7e6"],
  ["6–12万人", "#2f9dcc"],
  ["12–20万人", "#176ca4"],
  ["20万人以上", "#0b3d73"],
];

const LAND_USE_LEGEND = [
  ["公共・文教", "#ffd166"],
  ["業務・商業", "#e83e8c"],
  ["住宅", "#35c4a5"],
  ["工業・物流", "#8b5cf6"],
  ["屋外利用・未利用", "#f97316"],
  ["公園・緑地", "#57b657"],
];

const LAND_USE_LABELS: Record<string, string> = {
  public: "公共・文教",
  business: "業務・商業",
  residential: "住宅",
  industrial: "工業・物流",
  open: "屋外利用・未利用",
  green: "公園・緑地",
};

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

const DISTRICT_PLAN_LEGEND = [["地区計画区域", "#00c2d7"]];

const HEIGHT_DISTRICT_LEGEND = [
  ["第一種", "#d8ccff"],
  ["第二種", "#a78bfa"],
  ["第三種", "#6d28d9"],
  ["数値指定", "#f59e0b"],
];

const SPECIAL_ZONE_LEGEND = [
  ["再開発等促進区", "#f97316"],
  ["高度利用地区", "#9333ea"],
  ["特定街区", "#eab308"],
  ["都市再生特別地区", "#e11d48"],
];

const REDEVELOPMENT_LEGEND = [["市街地再開発事業（事業中）", "#ff553d"]];

const CHIYODA_REGION_LEGEND = [
  ["麹町・番町", "#f2b134"],
  ["飯田橋・富士見", "#2aa89a"],
  ["神保町", "#4f7dd8"],
  ["神田公園", "#8756b3"],
  ["万世橋", "#d45783"],
  ["和泉橋", "#df6d3e"],
  ["大手町・丸の内・有楽町・永田町", "#b73e52"],
];

const LANDSCAPE_PROPERTY_LEGEND = [
  ["建築物等", "#ff6b35"],
  ["橋梁", "#16a89a"],
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
  const visibility = visible ? "visible" : "none";
  ids.forEach((id) => {
    if (!map.getLayer(id)) return;
    const current = map.getLayoutProperty(id, "visibility") ?? "visible";
    if (current !== visibility) map.setLayoutProperty(id, "visibility", visibility);
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

function detailFor(
  layerId: string,
  properties: Record<string, unknown>,
  meta: AtlasData["meta"] | null = null,
): Detail {
  const p = properties;
  if (layerId.includes("chiyoda-region")) {
    return {
      eyebrow: "Master plan region",
      title: String(p.n ?? "千代田区の地域区分"),
      rows: [],
      sources: [{
        label: "千代田区都市計画マスタープラン",
        url: String(p.u ?? "https://www.city.chiyoda.lg.jp/documents/17862/toshimasu-4_2.pdf"),
      }],
    };
  }
  if (layerId.includes("landscape-propert")) {
    return {
      eyebrow: "Important landscape property",
      title: String(p.n ?? "景観まちづくり重要物件"),
      rows: [
        { label: "種別", value: textValue(p.t) },
        { label: "所在地", value: textValue(p.a) },
        { label: "指定年月日", value: textValue(p.d) },
      ],
      note: p.p === "block" ? "位置は公式住所を国土地理院住所検索で位置化した代表点です。" : undefined,
      sources: [{ label: "千代田区公式情報", url: String(p.u) }],
    };
  }
  if (layerId === "town-place") {
    return {
      eyebrow: "Place",
      title: String(p.n ?? "町丁目"),
      rows: [
        { label: "区", value: textValue(p.w) },
        { label: `住民人口 ${meta?.populationDate.slice(0, 4) ?? "2026"}`, value: numberValue(p.p, " 人") },
        { label: "昼間人口 2020", value: numberValue(p.dp, " 人") },
        { label: "昼夜間比 2020", value: p.dr == null ? "—" : `${NUMBER.format(Number(p.dr))}%` },
        { label: "主な土地利用", value: LAND_USE_LABELS[String(p.lu)] ?? textValue(p.lu) },
        { label: "面積", value: `${(Number(p.a ?? 0) / 1_000_000).toFixed(3)} km²` },
      ],
      note: "住民人口と昼間人口は基準年が異なるため、増減比較には使えません。",
      sources: [
        { label: "東京都・住民基本台帳人口", url: "https://www.toukei.metro.tokyo.lg.jp/juukiy/ju-index.htm" },
        { label: "東京都・2020年昼間人口", url: "https://www.toukei.metro.tokyo.lg.jp/tyukanj/2020/tj-20index.htm" },
      ],
    };
  }
  if (layerId.includes("daytime")) {
    return {
      eyebrow: "Daytime population",
      title: String(p.n ?? "町丁目"),
      rows: [
        { label: "区", value: textValue(p.w) },
        { label: "昼間人口", value: numberValue(p.dp, " 人") },
        { label: "同年の常住人口", value: numberValue(p.rp, " 人") },
        { label: "昼夜間人口比率", value: p.dr == null ? "—" : `${NUMBER.format(Number(p.dr))}%` },
        { label: "昼間人口密度", value: numberValue(p.dd, " 人/km²") },
      ],
      note: "昼間人口は経済センサス等を用いた推計値です。",
      sources: [{ label: "東京都・2020年国勢調査による昼間人口", url: "https://www.toukei.metro.tokyo.lg.jp/tyukanj/2020/tj-20index.htm" }],
    };
  }
  if (layerId.includes("land-use")) {
    return {
      eyebrow: "Actual land use",
      title: String(p.n ?? "町丁目"),
      rows: [
        { label: "区", value: textValue(p.w) },
        { label: "主用途", value: LAND_USE_LABELS[String(p.lu)] ?? "—" },
        { label: "構成1位", value: p.u1 ? `${p.u1} ${p.s1}%` : "—" },
        { label: "構成2位", value: p.u2 ? `${p.u2} ${p.s2}%` : "—" },
      ],
      note: "町丁目単位の集計です。色は道路・鉄道・水面を除く主要用途を示します。",
      sources: [{ label: "東京都・2021年度土地利用現況調査", url: "https://www.toshiseibi.metro.tokyo.lg.jp/about/chousa/tochi_c/tochi_kekka_r3" }],
    };
  }
  if (layerId.includes("district-plan")) {
    return {
      eyebrow: "District plan",
      title: String(p.n ?? "地区計画"),
      rows: [
        { label: "区", value: textValue(p.w) },
        { label: "計画面積", value: numberValue(p.a, " ha") },
        { label: "当初決定", value: textValue(p.i) },
        { label: "最終決定", value: textValue(p.d) },
        { label: "照会先", value: textValue(p.o) },
      ],
      note: "区域の概況表示です。個別敷地の制限は計画書・計画図で確認してください。",
      sources: [{ label: "東京都・都市計画GIS", url: "https://catalog.data.metro.tokyo.lg.jp/dataset/t000008d0000000028" }],
    };
  }
  if (layerId.includes("height-district")) {
    const rows = [
      { label: "区", value: textValue(p.w) },
      { label: "種別", value: textValue(p.n) },
      ...(p.mn ? [{ label: "最低限高度", value: numberValue(p.mn, " m") }] : []),
      ...(p.mx ? [{ label: "最高限高度", value: numberValue(p.mx, " m") }] : []),
    ];
    return {
      eyebrow: "Height district",
      title: String(p.n ?? "高度地区"),
      rows,
      note: "種別と数値指定を表示しています。敷地ごとの適用は公式都市計画図書で確認してください。",
      sources: [{ label: "東京都・都市計画GIS（2025-03-31）", url: "https://catalog.data.metro.tokyo.lg.jp/dataset/t000008d0000000028" }],
    };
  }
  if (layerId.includes("special-zone")) {
    return {
      eyebrow: "Planning exception",
      title: String(p.n ?? "容積・再開発等の特例"),
      rows: [
        { label: "制度", value: textValue(p.t) },
        { label: "区", value: textValue(p.w) },
        { label: "面積", value: numberValue(p.a, " ha") },
        { label: "決定・変更", value: textValue(p.d) },
        ...(p.b ? [{ label: "基準容積率", value: numberValue(p.b, "%") }] : []),
        ...(p.f ? [{ label: "指定容積率", value: numberValue(p.f, "%") }] : []),
        ...(p.mx ? [{ label: "最高高さ", value: `${p.mx} m` }] : []),
      ],
      note: "制度区域を重ねて表示します。重なりから実効容積率・高さは算定していません。",
      sources: [{ label: "東京都・都市計画GIS", url: "https://catalog.data.metro.tokyo.lg.jp/dataset/t000008d0000000028" }],
    };
  }
  if (layerId.includes("redevelopment")) {
    return {
      eyebrow: "Active redevelopment",
      title: String(p.n ?? "市街地再開発事業"),
      rows: [
        { label: "関係区", value: textValue(p.w) },
        { label: "進捗", value: textValue(p.s) },
        { label: "施行者", value: textValue(p.o) },
        { label: "面積", value: numberValue(p.a, " ha") },
        { label: "都市計画決定", value: textValue(p.d) },
        { label: "事業計画認可", value: textValue(p.p) },
      ],
      note: "点は町丁目内の代表位置で、事業区域そのものではありません。",
      sources: [{ label: `東京都・市街地再開発事業（${meta?.redevelopmentDate ?? "2025-10-31"}）`, url: "https://www.toshiseibi.metro.tokyo.lg.jp/machizukuri/shigaichi_seibi/sai-kai/saikaihatsu" }],
    };
  }
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

function landscapeGroupDetail(properties: Record<string, unknown>[]): Detail {
  return {
    eyebrow: "Important landscape properties",
    title: `同じ位置の${properties.length}物件`,
    rows: [],
    note: "公式GISの同一点に登録された物件をまとめて表示しています。",
    items: properties.map((item) => ({
      name: textValue(item.n),
      type: textValue(item.t),
      address: textValue(item.a),
      date: textValue(item.d),
      url: textValue(item.u),
    })),
  };
}

export function MapAtlas() {
  const mapElement = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const scopeRef = useRef<GeoFeature | null>(null);
  const [datasetLoader] = useState(() =>
    createLazyGeoJsonLoader<DatasetKey, GeoCollection>({
      files: DATASET_FILES,
      labels: DATASET_LABELS,
    }),
  );
  const loadingOverlaysRef = useRef(new Set<OverlayKey>());
  const areaActionRef = useRef(0);
  const noticeActionRef = useRef(0);
  const locationRequestRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [layerNotice, setLayerNotice] = useState<{ kind: "loading" | "error"; message: string } | null>(null);
  const [locationState, setLocationState] = useState<{
    status: "idle" | "locating" | "shown" | "error";
    message: string;
  }>({ status: "idle", message: "" });
  const [areaLayer, setAreaLayer] = useState<AreaLayer>("none");
  const [overlays, setOverlays] = useState<Record<OverlayKey, boolean>>({
    roads: false,
    rail: false,
    parks: false,
    landPrices: false,
    shelters: false,
    boundaries: false,
    districtPlans: false,
    heightDistricts: false,
    specialZones: false,
    redevelopment: false,
    chiyodaRegions: false,
    landscapeProperties: false,
  });
  const [photoEpoch, setPhotoEpoch] = useState<PhotoEpoch>("latest");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [searchItems, setSearchItems] = useState<SearchItem[]>([]);
  const [query, setQuery] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [atlasInfoOpen, setAtlasInfoOpen] = useState(false);
  const [meta, setMeta] = useState<AtlasData["meta"] | null>(null);

  const ensureDataset = useCallback((key: DatasetKey) => (
    datasetLoader.ensure(key, (datasetKey) => {
      const source = mapRef.current?.getSource(DATASET_SOURCES[datasetKey]) as GeoJSONSource | undefined;
      return source ? { setData: (data) => source.setData(data as never) } : undefined;
    })
  ), [datasetLoader]);

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
    const loadingOverlays = loadingOverlaysRef.current;

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
          renderWorldCopies: false,
          pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
          maxTileCacheZoomLevels: 2,
          refreshExpiredTiles: false,
          fadeDuration: 0,
          attributionControl: false,
          style: {
            version: 8,
            sources: Object.fromEntries(PHOTO_OPTIONS.map((option) => [
              `photo-${option.value}`,
              {
                type: "raster",
                tiles: [option.tile],
                tileSize: 256,
                minzoom: option.value === "1936" ? 13 : 10,
                maxzoom: option.maxzoom,
                attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">国土地理院</a>',
              },
            ])) as never,
            layers: PHOTO_OPTIONS.map((option) => ({
                id: `base-photo-${option.value}`,
                type: "raster",
                source: `photo-${option.value}`,
                layout: { visibility: option.value === "latest" ? "visible" : "none" },
                paint: {
                  "raster-saturation": option.value === "latest" ? -0.36 : -0.16,
                  "raster-contrast": -0.08,
                  "raster-brightness-max": 0.92,
                  "raster-fade-duration": 0,
                },
              })) as never,
          },
        });

        mapRef.current = map;
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
        map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

        map.on("load", () => {
          map.addSource("towns", {
            type: "geojson",
            data: EMPTY_COLLECTION as never,
            attribution: '人口・土地利用：<a href="https://catalog.data.metro.tokyo.lg.jp/" target="_blank">東京都</a>',
          });
          map.addSource("zoning", { type: "geojson", data: EMPTY_COLLECTION as never });
          map.addSource("fire", {
            type: "geojson",
            data: EMPTY_COLLECTION as never,
            attribution: '防火指定：<a href="https://www.mlit.go.jp/toshi/tosiko/toshi_tosiko_tk_000087.html" target="_blank">国土交通省</a>',
          });
          map.addSource("flood", {
            type: "geojson",
            data: EMPTY_COLLECTION as never,
            attribution: '洪水浸水：<a href="https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A31a-2025.html" target="_blank">国土数値情報</a>',
          });
          map.addSource("parks", {
            type: "geojson",
            data: EMPTY_COLLECTION as never,
            attribution: '公園・緑地：<a href="https://catalog.data.metro.tokyo.lg.jp/dataset/t000008d2000000024" target="_blank">東京都</a>',
          });
          map.addSource("land-prices", {
            type: "geojson",
            data: EMPTY_COLLECTION as never,
            attribution: '地価公示：<a href="https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-L01-2026.html" target="_blank">国土数値情報</a>',
          });
          map.addSource("shelters", {
            type: "geojson",
            data: EMPTY_COLLECTION as never,
            attribution: '指定避難所：<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">国土地理院</a>',
          });
          map.addSource("roads", {
            type: "geojson",
            data: EMPTY_COLLECTION as never,
            attribution: '道路 © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a>',
          });
          map.addSource("rail", { type: "geojson", data: EMPTY_COLLECTION as never });
          map.addSource("stations", { type: "geojson", data: EMPTY_COLLECTION as never });
          map.addSource("wards", { type: "geojson", data: data.wards as never });
          map.addSource("city", { type: "geojson", data: data.city as never });
          map.addSource("district-plans", {
            type: "geojson",
            data: EMPTY_COLLECTION as never,
            attribution: '地区計画：<a href="https://catalog.data.metro.tokyo.lg.jp/dataset/t000008d0000000028" target="_blank">東京都</a>',
          });
          map.addSource("height-districts", { type: "geojson", data: EMPTY_COLLECTION as never });
          map.addSource("special-zones", { type: "geojson", data: EMPTY_COLLECTION as never });
          map.addSource("redevelopment", {
            type: "geojson",
            data: EMPTY_COLLECTION as never,
            attribution: '再開発：<a href="https://www.toshiseibi.metro.tokyo.lg.jp/machizukuri/shigaichi_seibi/sai-kai/saikaihatsu" target="_blank">東京都</a>',
          });
          map.addSource("chiyoda-regions", {
            type: "geojson",
            data: EMPTY_COLLECTION as never,
            attribution: '7地域：<a href="https://www.city.chiyoda.lg.jp/documents/17862/toshimasu-4_2.pdf" target="_blank">千代田区都市計画マスタープラン</a>',
          });
          map.addSource("landscape-properties", {
            type: "geojson",
            data: EMPTY_COLLECTION as never,
            attribution: '景観重要物件：<a href="https://www.city.chiyoda.lg.jp/koho/machizukuri/kekan/ichiranhyo.html" target="_blank">千代田区</a>',
          });
          map.addSource("selection", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
          map.addSource("user-location-accuracy", {
            type: "geojson",
            data: EMPTY_COLLECTION as never,
          });
          map.addSource("user-location", {
            type: "geojson",
            data: EMPTY_COLLECTION as never,
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
            id: "daytime-fill",
            type: "fill",
            source: "towns",
            layout: { visibility: "none" },
            paint: {
              "fill-color": [
                "step", ["coalesce", ["get", "dd"], 0],
                "#e8f6ff",
                10000, "#b9e3f7",
                30000, "#73c7e6",
                60000, "#2f9dcc",
                120000, "#176ca4",
                200000, "#0b3d73",
              ],
              "fill-opacity": 0.55,
              "fill-outline-color": "rgba(255,255,255,0.62)",
            },
          });
          map.addLayer({
            id: "land-use-fill",
            type: "fill",
            source: "towns",
            layout: { visibility: "none" },
            paint: {
              "fill-color": [
                "match", ["get", "lu"],
                "public", "#ffd166",
                "business", "#e83e8c",
                "residential", "#35c4a5",
                "industrial", "#8b5cf6",
                "open", "#f97316",
                "green", "#57b657",
                "#9ca3af",
              ],
              "fill-opacity": 0.5,
              "fill-outline-color": "rgba(255,255,255,0.72)",
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
            id: "chiyoda-regions-fill",
            type: "fill",
            source: "chiyoda-regions",
            layout: { visibility: "none" },
            paint: {
              "fill-color": [
                "match", ["get", "i"],
                1, "#f2b134",
                2, "#2aa89a",
                3, "#4f7dd8",
                4, "#8756b3",
                5, "#d45783",
                6, "#df6d3e",
                7, "#b73e52",
                "#64748b",
              ],
              "fill-opacity": 0.13,
            },
          });
          map.addLayer({
            id: "chiyoda-regions-line",
            type: "line",
            source: "chiyoda-regions",
            layout: { visibility: "none" },
            paint: {
              "line-color": [
                "match", ["get", "i"],
                1, "#f2b134",
                2, "#2aa89a",
                3, "#4f7dd8",
                4, "#8756b3",
                5, "#d45783",
                6, "#df6d3e",
                7, "#b73e52",
                "#64748b",
              ],
              "line-width": 2.2,
              "line-opacity": 0.92,
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
            id: "height-districts-fill",
            type: "fill",
            source: "height-districts",
            layout: { visibility: "none" },
            paint: {
              "fill-color": [
                "match", ["get", "c"],
                1, "#d8ccff",
                2, "#a78bfa",
                3, "#6d28d9",
                4, "#f59e0b",
                "#9ca3af",
              ],
              "fill-opacity": 0.35,
            },
          });
          map.addLayer({
            id: "height-districts-line",
            type: "line",
            source: "height-districts",
            layout: { visibility: "none" },
            paint: {
              "line-color": "rgba(255,255,255,0.86)",
              "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.7, 17, 1.4],
            },
          });
          map.addLayer({
            id: "special-zones-fill",
            type: "fill",
            source: "special-zones",
            layout: { visibility: "none" },
            paint: {
              "fill-color": [
                "match", ["get", "c"],
                "redevelopmentPlan", "#f97316",
                "highUse", "#9333ea",
                "specialBlock", "#eab308",
                "urbanRegeneration", "#e11d48",
                "#64748b",
              ],
              "fill-opacity": 0.34,
            },
          });
          map.addLayer({
            id: "special-zones-line",
            type: "line",
            source: "special-zones",
            layout: { visibility: "none" },
            paint: {
              "line-color": [
                "match", ["get", "c"],
                "redevelopmentPlan", "#f97316",
                "highUse", "#9333ea",
                "specialBlock", "#eab308",
                "urbanRegeneration", "#e11d48",
                "#64748b",
              ],
              "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.4, 17, 3],
            },
          });
          map.addLayer({
            id: "special-zones-hit",
            type: "fill",
            source: "special-zones",
            layout: { visibility: "none" },
            paint: { "fill-color": "#ffffff", "fill-opacity": 0.01 },
          });
          map.addLayer({
            id: "district-plans-casing",
            type: "line",
            source: "district-plans",
            layout: { visibility: "none" },
            paint: {
              "line-color": "#102a35",
              "line-width": ["interpolate", ["linear"], ["zoom"], 11, 3.2, 17, 5.2],
              "line-opacity": 0.9,
            },
          });
          map.addLayer({
            id: "district-plans-line",
            type: "line",
            source: "district-plans",
            layout: { visibility: "none" },
            paint: {
              "line-color": "#00c2d7",
              "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.7, 17, 3.2],
              "line-dasharray": [2.2, 1.3],
            },
          });
          map.addLayer({
            id: "district-plans-hit",
            type: "fill",
            source: "district-plans",
            layout: { visibility: "none" },
            paint: { "fill-color": "#ffffff", "fill-opacity": 0.01 },
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
            id: "redevelopment-hit",
            type: "circle",
            source: "redevelopment",
            layout: { visibility: "none" },
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 15, 16, 20],
              "circle-color": "#ffffff",
              "circle-opacity": 0.01,
            },
          });
          map.addLayer({
            id: "redevelopment-halo",
            type: "circle",
            source: "redevelopment",
            layout: { visibility: "none" },
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 6, 16, 10],
              "circle-color": "#111916",
              "circle-opacity": 0.92,
            },
          });
          map.addLayer({
            id: "redevelopment-points",
            type: "circle",
            source: "redevelopment",
            layout: { visibility: "none" },
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3.8, 16, 7.2],
              "circle-color": "#ff553d",
              "circle-stroke-color": "#fffdf8",
              "circle-stroke-width": 1.4,
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
            id: "landscape-properties-hit",
            type: "circle",
            source: "landscape-properties",
            layout: { visibility: "none" },
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 14, 16, 19],
              "circle-color": "#ffffff",
              "circle-opacity": 0.01,
            },
          });
          map.addLayer({
            id: "landscape-properties-halo",
            type: "circle",
            source: "landscape-properties",
            layout: { visibility: "none" },
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 5.6, 16, 9],
              "circle-color": "#17211f",
              "circle-opacity": 0.9,
            },
          });
          map.addLayer({
            id: "landscape-properties-points",
            type: "circle",
            source: "landscape-properties",
            layout: { visibility: "none" },
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3.6, 16, 6.8],
              "circle-color": [
                "match", ["get", "t"],
                "建築物等", "#ff6b35",
                "橋梁", "#16a89a",
                "#64748b",
              ],
              "circle-stroke-color": "#fffdf8",
              "circle-stroke-width": 1.35,
            },
          });
          map.addLayer({
            id: "chiyoda-regions-label",
            type: "symbol",
            source: "chiyoda-regions",
            layout: {
              visibility: "none",
              "text-field": ["get", "s"],
              "text-size": ["interpolate", ["linear"], ["zoom"], 11, 10, 14, 13],
              "text-max-width": 11,
              "text-letter-spacing": 0.04,
            },
            paint: {
              "text-color": "#fffdf8",
              "text-halo-color": "rgba(22, 31, 30, 0.92)",
              "text-halo-width": 1.4,
            },
          });
          map.addLayer({
            id: "selection-fill",
            type: "fill",
            source: "selection",
            paint: { "fill-color": "#00c2d7", "fill-opacity": 0.22 },
          });
          map.addLayer({
            id: "selection-line",
            type: "line",
            source: "selection",
            paint: { "line-color": "#00c2d7", "line-width": 4 },
          });
          map.addLayer({
            id: "selection-point",
            type: "circle",
            source: "selection",
            filter: ["==", ["geometry-type"], "Point"],
            paint: {
              "circle-radius": 8,
              "circle-color": "#fffdf8",
              "circle-stroke-color": "#111916",
              "circle-stroke-width": 3,
            },
          });
          map.addLayer({
            id: "user-location-accuracy-fill",
            type: "fill",
            source: "user-location-accuracy",
            paint: {
              "fill-color": "#1479ff",
              "fill-opacity": 0.14,
            },
          }, "ward-boundaries-halo");
          map.addLayer({
            id: "user-location-accuracy-line",
            type: "line",
            source: "user-location-accuracy",
            paint: {
              "line-color": "#1479ff",
              "line-width": 1.6,
              "line-opacity": 0.9,
            },
          }, "ward-boundaries-halo");
          map.addLayer({
            id: "user-location-point",
            type: "circle",
            source: "user-location",
            paint: {
              "circle-radius": 7,
              "circle-color": "#1479ff",
              "circle-stroke-color": "#fffdf8",
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

          const allSearch: SearchItem[] = data.search.map(([name, ward, typeIndex, featureIndex]) => {
            const searchType = data.searchTypes[typeIndex];
            return {
              name,
              ward,
              kind: searchType.k,
              layerId: searchType.l,
              dataset: searchType.d,
              featureIndex,
            };
          });
          setSearchItems(allSearch);

          const clickable = [
            "landscape-properties-points", "landscape-properties-halo", "landscape-properties-hit",
            "redevelopment-points", "redevelopment-hit",
            "shelters", "shelters-hit", "land-prices", "land-prices-hit",
            "station-core", "stations", "rail-hit", "roads-hit",
            "district-plans-hit", "district-plans-line", "special-zones-hit", "special-zones-fill",
            "chiyoda-regions-label", "chiyoda-regions-line", "chiyoda-regions-fill",
            "height-districts-fill", "parks-fill", "flood-fill", "fire-fill", "zoning-fill",
            "land-use-fill", "daytime-fill", "population-fill",
          ];
          let cursorFrame = 0;
          map.on("mousemove", (event) => {
            if (cursorFrame) return;
            const point = event.point;
            cursorFrame = window.requestAnimationFrame(() => {
              cursorFrame = 0;
              if (disposed) return;
              const hit = map.queryRenderedFeatures(point, { layers: clickable }).length > 0;
              map.getCanvas().style.cursor = hit ? "pointer" : "";
            });
          });
          map.on("click", (event) => {
            const rendered = map.queryRenderedFeatures(event.point, { layers: clickable });
            const feature =
              rendered.find((item) => item.layer.id === "chiyoda-regions-label") ??
              rendered.find((item) => !item.layer.id.startsWith("chiyoda-regions")) ??
              rendered[0];
            const source = map.getSource("selection") as GeoJSONSource;
            if (!feature) {
              setDetail(null);
              source.setData({ type: "FeatureCollection", features: [] });
              return;
            }
            if (feature.layer.id.startsWith("landscape-properties")) {
              const coordinates = JSON.stringify(feature.geometry.coordinates);
              const seen = new Set<string>();
              const properties = rendered
                .filter((item) => (
                  item.layer.id.startsWith("landscape-properties") &&
                  JSON.stringify(item.geometry.coordinates) === coordinates
                ))
                .map((item) => item.properties ?? {})
                .filter((item) => {
                  const id = String(item.i ?? "");
                  if (!id || seen.has(id)) return false;
                  seen.add(id);
                  return true;
                });
              setDetail(
                properties.length > 1
                  ? landscapeGroupDetail(properties)
                  : detailFor(feature.layer.id, feature.properties ?? {}, data.meta),
              );
            } else {
              setDetail(detailFor(feature.layer.id, feature.properties ?? {}, data.meta));
            }
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
      locationRequestRef.current += 1;
      loadingOverlays.clear();
      datasetLoader.reset();
    };
  }, [datasetLoader]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setLayerVisibility(map, ["population-fill"], areaLayer === "population");
    setLayerVisibility(map, ["daytime-fill"], areaLayer === "daytime");
    setLayerVisibility(map, ["land-use-fill"], areaLayer === "landUse");
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
    setLayerVisibility(map, DISTRICT_PLAN_LAYER_IDS, overlays.districtPlans);
    setLayerVisibility(map, HEIGHT_DISTRICT_LAYER_IDS, overlays.heightDistricts);
    setLayerVisibility(map, SPECIAL_ZONE_LAYER_IDS, overlays.specialZones);
    setLayerVisibility(map, REDEVELOPMENT_LAYER_IDS, overlays.redevelopment);
    setLayerVisibility(map, CHIYODA_REGION_LAYER_IDS, overlays.chiyodaRegions);
    setLayerVisibility(map, LANDSCAPE_PROPERTY_LAYER_IDS, overlays.landscapeProperties);
  }, [overlays, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    PHOTO_OPTIONS.forEach((option) => {
      setLayerVisibility(map, [`base-photo-${option.value}`], option.value === photoEpoch);
    });
    if (photoEpoch === "1936" && map.getZoom() < 13) {
      map.easeTo({ zoom: 13, duration: 450 });
    }
  }, [photoEpoch, ready]);

  const clearSelection = () => {
    setDetail(null);
    const source = mapRef.current?.getSource("selection") as GeoJSONSource | undefined;
    source?.setData({ type: "FeatureCollection", features: [] });
  };

  const changeArea = async (value: AreaLayer) => {
    const areaAction = ++areaActionRef.current;
    clearSelection();
    if (value === "none") {
      setAreaLayer(value);
      setLayerNotice(null);
      return;
    }
    if (!ready) return;

    const dataset = AREA_DATASETS[value];
    if (!dataset) return;
    const noticeAction = ++noticeActionRef.current;
    setLayerNotice({ kind: "loading", message: `${LAYER_LABELS[value]}を読み込み中…` });
    try {
      await ensureDataset(dataset);
      if (areaAction !== areaActionRef.current) return;
      setAreaLayer(value);
      if (noticeAction === noticeActionRef.current) setLayerNotice(null);
    } catch (reason: unknown) {
      if (areaAction !== areaActionRef.current) return;
      setLayerNotice({
        kind: "error",
        message: reason instanceof Error ? reason.message : `${LAYER_LABELS[value]}を読み込めませんでした`,
      });
    }
  };

  const toggleOverlay = async (key: OverlayKey) => {
    clearSelection();
    if (overlays[key]) {
      setOverlays((current) => ({ ...current, [key]: false }));
      return;
    }
    if (!ready || loadingOverlaysRef.current.has(key)) return;

    loadingOverlaysRef.current.add(key);
    const noticeAction = ++noticeActionRef.current;
    setLayerNotice({ kind: "loading", message: `${LAYER_LABELS[key]}を読み込み中…` });
    try {
      await Promise.all(OVERLAY_DATASETS[key].map(ensureDataset));
      setOverlays((current) => ({ ...current, [key]: true }));
      if (noticeAction === noticeActionRef.current) setLayerNotice(null);
    } catch (reason: unknown) {
      setLayerNotice({
        kind: "error",
        message: reason instanceof Error ? reason.message : `${LAYER_LABELS[key]}を読み込めませんでした`,
      });
    } finally {
      loadingOverlaysRef.current.delete(key);
    }
  };

  const locateUser = () => {
    if (!ready || locationState.status === "locating") return;
    clearSelection();

    if (typeof window === "undefined" || !window.isSecureContext) {
      setLocationState({
        status: "error",
        message: "現在地はHTTPS接続でのみ利用できます。",
      });
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationState({
        status: "error",
        message: "このブラウザでは位置情報を利用できません。",
      });
      return;
    }

    const request = ++locationRequestRef.current;
    setLocationState({ status: "locating", message: "現在地を取得しています。" });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (request !== locationRequestRef.current) return;
        const map = mapRef.current;
        const pointSource = map?.getSource("user-location") as GeoJSONSource | undefined;
        const accuracySource = map?.getSource("user-location-accuracy") as GeoJSONSource | undefined;
        if (!map || !pointSource || !accuracySource) {
          setLocationState({ status: "error", message: "現在地の表示準備ができていません。" });
          return;
        }

        const { longitude, latitude, accuracy } = position.coords;
        const location = buildLocationData(longitude, latitude, accuracy);
        pointSource.setData(location.point as never);
        accuracySource.setData(location.accuracyArea as never);
        map.fitBounds(location.bounds, { padding: 90, maxZoom: 16.5, duration: 650 });

        const roundedAccuracy = Number.isFinite(accuracy) ? Math.max(Math.round(accuracy), 0) : 0;
        const accuracyText = roundedAccuracy >= 1_000
          ? `${(roundedAccuracy / 1_000).toFixed(1)} km`
          : `${roundedAccuracy} m`;
        setLocationState({
          status: "shown",
          message: `現在地を表示しました。精度は約${accuracyText}です。`,
        });
      },
      (locationError) => {
        if (request !== locationRequestRef.current) return;
        setLocationState({
          status: "error",
          message: geolocationErrorMessage(locationError.code),
        });
      },
      {
        enableHighAccuracy: true,
        timeout: 10_000,
        maximumAge: 30_000,
      },
    );
  };

  const cancelPendingLocation = () => {
    if (locationState.status !== "locating") return;
    locationRequestRef.current += 1;
    setLocationState({ status: "idle", message: "" });
  };

  const resetMap = () => {
    cancelPendingLocation();
    if (!mapRef.current || !scopeRef.current) return;
    mapRef.current.fitBounds(boundsFor(scopeRef.current), { padding: 42, duration: 600 });
  };

  const selectSearchItem = async (item: SearchItem) => {
    cancelPendingLocation();
    const map = mapRef.current;
    if (!map) return;
    setQuery("");
    setPanelOpen(false);
    const action = ++noticeActionRef.current;
    setLayerNotice({ kind: "loading", message: `${DATASET_LABELS[item.dataset]}を読み込み中…` });
    try {
      const collection = await ensureDataset(item.dataset);
      if (noticeActionRef.current !== action) return;
      const feature = collection.features[item.featureIndex];
      if (!feature) throw new Error("検索した地物を読み込めませんでした");
      setLayerNotice(null);
      if (feature.geometry.type === "Point") {
        const coordinate = feature.geometry.coordinates as [number, number];
        map.flyTo({ center: coordinate, zoom: 15.5, duration: 650 });
      } else {
        map.fitBounds(boundsFor(feature), { padding: 90, maxZoom: 15.2, duration: 650 });
      }
      setDetail(detailFor(item.layerId, feature.properties, meta));
      const source = map.getSource("selection") as GeoJSONSource;
      source?.setData({ type: "FeatureCollection", features: [feature] } as never);
    } catch (reason) {
      if (noticeActionRef.current !== action) return;
      setLayerNotice({
        kind: "error",
        message: reason instanceof Error ? reason.message : "地図データを読み込めませんでした",
      });
      setPanelOpen(true);
    }
  };

  const legendGroups = useMemo(() => {
    const groups: { title: string; items: string[][] }[] = [];
    if (areaLayer === "population") groups.push({ title: "住民人口密度（人/km²）", items: POPULATION_LEGEND });
    if (areaLayer === "daytime") groups.push({ title: "昼間人口密度（人/km²）", items: DAYTIME_LEGEND });
    if (areaLayer === "landUse") groups.push({ title: "町丁目の主な実土地利用", items: LAND_USE_LEGEND });
    if (areaLayer === "zoning") groups.push({ title: "用途地域", items: ZONING_LEGEND });
    if (areaLayer === "fire") groups.push({ title: "防火指定", items: FIRE_LEGEND });
    if (areaLayer === "flood") groups.push({ title: "洪水浸水想定", items: FLOOD_LEGEND });
    if (overlays.roads) groups.push({ title: "主要道路", items: ROAD_LEGEND });
    if (overlays.rail) groups.push({ title: "鉄道", items: RAIL_LEGEND });
    if (overlays.parks) groups.push({ title: "公園・緑地", items: PARK_LEGEND });
    if (overlays.landPrices) groups.push({ title: "地価公示（円/m²）", items: LAND_PRICE_LEGEND });
    if (overlays.shelters) groups.push({ title: "指定避難所", items: SHELTER_LEGEND });
    if (overlays.districtPlans) groups.push({ title: "地区計画", items: DISTRICT_PLAN_LEGEND });
    if (overlays.heightDistricts) groups.push({ title: "高度地区（千代田・中央は指定なし）", items: HEIGHT_DISTRICT_LEGEND });
    if (overlays.specialZones) groups.push({ title: "容積・再開発等の特例", items: SPECIAL_ZONE_LEGEND });
    if (overlays.redevelopment) groups.push({ title: "事業中の再開発", items: REDEVELOPMENT_LEGEND });
    if (overlays.chiyodaRegions) groups.push({ title: "千代田区の7地域", items: CHIYODA_REGION_LEGEND });
    if (overlays.landscapeProperties) groups.push({ title: "景観まちづくり重要物件", items: LANDSCAPE_PROPERTY_LEGEND });
    return groups;
  }, [areaLayer, overlays]);

  const activeGuides = useMemo(() => {
    const items: { label: string; text: string; asOf: string; source: string; url: string }[] = [];
    const add = (label: string, text: string, asOf: string, source: string, url: string) => {
      items.push({ label, text, asOf, source, url });
    };
    if (areaLayer === "population") add("住民密度", "住む人の分布。昼間の都市活動とは別に読む。", meta?.populationDate ?? "2026-01-01", "東京都", "https://www.toukei.metro.tokyo.lg.jp/juukiy/ju-index.htm");
    if (areaLayer === "daytime") add("昼間人口", "働く・学ぶ人が集まる場所。比率は2020年内で比較。", meta?.daytimeYear ?? "2020年", "東京都", "https://www.toukei.metro.tokyo.lg.jp/tyukanj/2020/tj-20index.htm");
    if (areaLayer === "landUse") add("実土地利用", "町丁目の主な都市機能。道路・鉄道・水面は主用途判定から除外。", meta?.landUseYear ?? "2021年度", "東京都", "https://www.toshiseibi.metro.tokyo.lg.jp/about/chousa/tochi_c/tochi_kekka_r3");
    if (areaLayer === "zoning") add("用途地域", "建て方の基本ルール。クリックして容積率・建ぺい率を見る。", meta?.zoningYear ?? "2025年度", "国土交通省", "https://www.mlit.go.jp/toshi/tosiko/toshi_tosiko_tk_000087.html");
    if (areaLayer === "fire") add("防火指定", "市街地の防火上の指定。敷地判断は公式図で再確認。", meta?.fireYear ?? "2025年度", "国土交通省", "https://www.mlit.go.jp/toshi/tosiko/toshi_tosiko_tk_000087.html");
    if (areaLayer === "flood") add("洪水浸水", "想定最大規模の最大深を概観。避難判断には使わない。", meta?.floodYear ?? "2025年度", "国土交通省", "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A31a-2025.html");
    if (overlays.roads) add("主要道路", "都市の軸と区を越える連続性を見る。", meta?.roadsDate ?? "取得時点", "OpenStreetMap", "https://www.openstreetmap.org/copyright");
    if (overlays.rail) add("鉄道・駅", "駅勢圏と乗換拠点を道路・土地利用に重ねて読む。", meta?.railDate ?? "2025年", "国土交通省", "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html");
    if (overlays.districtPlans) add("地区計画", "区域を入口に、計画書・計画図へたどる。", meta?.districtPlanDate ?? "2025-05-02", "東京都", "https://catalog.data.metro.tokyo.lg.jp/dataset/t000008d0000000028");
    if (overlays.heightDistricts) add("高度地区", "千代田区・中央区は指定なし。隣接4区の種別と数値指定を用途地域と合わせて確認。", meta?.heightDistrictDate ?? "2025-03-31", "東京都", "https://catalog.data.metro.tokyo.lg.jp/dataset/t000008d0000000028");
    if (overlays.specialZones) add("容積・再開発等の特例", "制度の重なりを発見する層。実効値は個別図書で確認。", meta?.specialZoneDate ?? "2024–2025", "東京都", "https://catalog.data.metro.tokyo.lg.jp/dataset/t000008d0000000028");
    if (overlays.redevelopment) add("事業中の再開発", "現在動いている事業の所在を点で把握。区域は資料参照。", meta?.redevelopmentDate ?? "2025-10-31", "東京都", "https://www.toshiseibi.metro.tokyo.lg.jp/machizukuri/shigaichi_seibi/sai-kai/saikaihatsu");
    if (overlays.chiyodaRegions) add("千代田区の7地域", "都市計画マスタープランが地域別に示す将来像の単位。", meta?.chiyodaRegionDate ?? "2021-05", "千代田区", "https://www.city.chiyoda.lg.jp/documents/17862/toshimasu-4_2.pdf");
    if (overlays.landscapeProperties) add("景観まちづくり重要物件", "区指定の建築物等と橋梁。重複地点はクリック時にまとめて表示。", meta?.landscapePropertyDate ?? "2024-12", "千代田区", "https://www.city.chiyoda.lg.jp/koho/machizukuri/kekan/ichiranhyo.html");
    if (overlays.parks) add("公園・緑地", "まとまりとネットワークを周辺区まで連続して見る。", meta?.parksDate ?? "公開時点", "東京都", "https://catalog.data.metro.tokyo.lg.jp/dataset/t000008d2000000024");
    if (overlays.landPrices) add("地価公示", "標準地の点比較。個別不動産の価格ではない。", meta?.landPriceDate ?? "2026-01-01", "国土交通省", "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-L01-2026.html");
    if (overlays.shelters) add("指定避難所", "概略位置を確認し、実際の避難時は各区の最新案内を見る。", meta?.sheltersDate ?? "取得時点", "国土地理院", "https://maps.gsi.go.jp/development/ichiran.html");
    if (overlays.boundaries) add("町丁目境界", "統計の集計単位を確認する補助線。", `${meta?.boundaryYear ?? 2020}年国勢調査`, "CODH", "https://geoshape.ex.nii.ac.jp/ka/resource/");
    const photo = PHOTO_OPTIONS.find((option) => option.value === photoEpoch);
    add("航空写真", "年代ごとの市街地の変化を見る。古い写真は未整備箇所が空白になる。", photo?.label ?? "最新", "国土地理院", "https://maps.gsi.go.jp/development/ichiran.html");
    return items;
  }, [areaLayer, overlays, photoEpoch, meta]);

  return (
    <div className="atlas-shell">
      <header className="topbar">
        <div className="brand">
          <h1>CHiYODA ATLAS</h1>
        </div>
        <button
          className={`atlas-info-toggle ${atlasInfoOpen ? "is-open" : ""}`}
          onClick={() => setAtlasInfoOpen((current) => !current)}
          aria-controls="atlas-info-panel"
          aria-expanded={atlasInfoOpen}
          aria-label={atlasInfoOpen ? "統計と地図情報を閉じる" : "統計と地図情報を表示"}
          title="統計と地図情報"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 19V11M12 19V5M19 19v-9M3 19h18" />
          </svg>
        </button>
        {atlasInfoOpen && (
          <aside id="atlas-info-panel" className="atlas-info-panel" aria-label="千代田区の統計と地図情報">
            <div className="metrics" aria-label="千代田区の基礎指標">
              <Metric label="面積" value={meta ? meta.chiyodaArea.toFixed(2) : "—"} unit="km²" />
              <Metric label="住民人口 2026" value={meta ? NUMBER.format(meta.chiyodaPopulation) : "—"} unit="人" />
              <Metric label="昼間人口 2020" value={meta ? NUMBER.format(meta.chiyodaDaytimePopulation) : "—"} unit="人" />
              <Metric label="昼夜間比 2020" value={meta ? NUMBER.format(meta.chiyodaDayNightRatio) : "—"} unit="%" />
            </div>
            <div className="guide-list" aria-live="polite">
              {activeGuides.map((item) => (
                <div className="guide-item" key={item.label}>
                  <strong>{item.label}</strong>
                  <p>{item.text}</p>
                  <a href={item.url} target="_blank" rel="noreferrer">{item.source} · {item.asOf}</a>
                </div>
              ))}
            </div>
            <p className="atlas-info-note">対象：千代田・中央・港・新宿・文京・台東。学習・概況把握用です。行政上の確認は各公式図書で行ってください。</p>
          </aside>
        )}
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
            <div className="sidebar-close-row">
              <button
                className="close-panel"
                onClick={() => setPanelOpen(false)}
                aria-label="閉じる"
                aria-controls="layer-panel"
                aria-expanded={panelOpen}
              >×</button>
            </div>

            <section className="search-wrap">
              <div className="search-field">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="町丁目・駅・地域・物件を検索"
                  aria-label="場所や計画を検索"
                  autoComplete="off"
                />
              </div>
              {filteredSearch.length > 0 && (
                <div className="search-results">
                  {filteredSearch.map((item, index) => (
                    <button className="search-result" key={`${item.kind}-${item.ward}-${item.name}-${index}`} onClick={() => void selectSearchItem(item)}>
                      <span>{item.name}</span><small>{item.kind} · {item.ward}</small>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section>
              <label className="section-title" htmlFor="photo-epoch">航空写真</label>
              <select
                id="photo-epoch"
                className="photo-select"
                value={photoEpoch}
                onChange={(event) => setPhotoEpoch(event.target.value as PhotoEpoch)}
              >
                {PHOTO_OPTIONS.map((option) => (
                  <option value={option.value} key={option.value}>{option.label}</option>
                ))}
              </select>
            </section>

            <section>
              <h2 className="section-title">人口</h2>
              <div className="area-choice-grid">
                <AreaButton label="住民密度" active={areaLayer === "population"} onClick={() => changeArea("population")} />
                <AreaButton label="昼間人口" active={areaLayer === "daytime"} onClick={() => changeArea("daytime")} />
              </div>
            </section>

            <section>
              <h2 className="section-title">土地・制度</h2>
              <div className="area-choice-grid">
                <AreaButton label="実土地利用" active={areaLayer === "landUse"} onClick={() => changeArea("landUse")} />
                <AreaButton label="用途地域" active={areaLayer === "zoning"} onClick={() => changeArea("zoning")} />
                <AreaButton label="防火指定" active={areaLayer === "fire"} onClick={() => changeArea("fire")} />
                <AreaButton label="洪水浸水" active={areaLayer === "flood"} onClick={() => changeArea("flood")} />
                <AreaButton label="表示なし" active={areaLayer === "none"} onClick={() => changeArea("none")} wide />
              </div>
            </section>

            <section>
              <h2 className="section-title">都市構造</h2>
              <div className="toggle-list">
                <Toggle label="主要道路" active={overlays.roads} onClick={() => toggleOverlay("roads")} />
                <Toggle label="鉄道・駅" active={overlays.rail} onClick={() => toggleOverlay("rail")} />
                <Toggle label="町丁目境界" active={overlays.boundaries} onClick={() => toggleOverlay("boundaries")} />
              </div>
            </section>

            <section>
              <h2 className="section-title">計画・変化</h2>
              <div className="toggle-list">
                <Toggle label="千代田区の7地域" active={overlays.chiyodaRegions} onClick={() => toggleOverlay("chiyodaRegions")} />
                <Toggle label="地区計画" active={overlays.districtPlans} onClick={() => toggleOverlay("districtPlans")} />
                <Toggle label="高度地区" active={overlays.heightDistricts} onClick={() => toggleOverlay("heightDistricts")} />
                <Toggle label="容積・再開発等の特例" active={overlays.specialZones} onClick={() => toggleOverlay("specialZones")} />
                <Toggle label="事業中の再開発" active={overlays.redevelopment} onClick={() => toggleOverlay("redevelopment")} />
              </div>
            </section>

            <section>
              <h2 className="section-title">暮らし・景観</h2>
              <div className="toggle-list">
                <Toggle label="景観まちづくり重要物件" active={overlays.landscapeProperties} onClick={() => toggleOverlay("landscapeProperties")} />
                <Toggle label="公園・緑地" active={overlays.parks} onClick={() => toggleOverlay("parks")} />
                <Toggle label="地価公示" active={overlays.landPrices} onClick={() => toggleOverlay("landPrices")} />
                <Toggle label="指定避難所" active={overlays.shelters} onClick={() => toggleOverlay("shelters")} />
              </div>
            </section>

            {layerNotice && (
              <div className={`layer-notice ${layerNotice.kind === "error" ? "is-error" : ""}`} role="status" aria-live="polite">
                {layerNotice.message}
              </div>
            )}

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
            <button
              className="map-action"
              onClick={locateUser}
              disabled={!ready || locationState.status === "locating"}
              aria-label={locationState.status === "shown" ? "現在地を更新" : "現在地を表示"}
            >{locationState.status === "locating" ? "取得中…" : "現在地"}</button>
            <button className="map-action" onClick={resetMap}>6区全体へ戻る</button>
          </div>
          {locationState.status === "error" && (
            <div className="map-location-error" role="alert">{locationState.message}</div>
          )}
          {locationState.status !== "error" && (
            <div className="sr-only" role="status" aria-live="polite">{locationState.message}</div>
          )}

          {legendGroups.length > 0 && (
            <aside className={`legend-card ${legendOpen ? "is-open" : ""}`} aria-label="凡例">
              <button className="legend-toggle" onClick={() => setLegendOpen((current) => !current)} aria-expanded={legendOpen}>
                <span>凡例</span><span aria-hidden="true">{legendOpen ? "−" : "+"}</span>
              </button>
              {legendOpen && (
                <div className="legend-body">
                  {legendGroups.map((group) => (
                    <div className="legend-group" key={group.title}>
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
                </div>
              )}
            </aside>
          )}

          {detail && (
            <aside className="detail-card" aria-live="polite">
              <button className="detail-close" onClick={clearSelection} aria-label="詳細を閉じる">×</button>
              <div className="detail-eyebrow">{detail.eyebrow}</div>
              <h2 className="detail-title">{detail.title}</h2>
              <dl className="detail-grid">
                {detail.rows.map((row) => (
                  <div className="detail-item" key={row.label}>
                    <dt>{row.label}</dt><dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
              {detail.note && <p className="detail-note">{detail.note}</p>}
              {detail.items && (
                <div className="detail-related">
                  {detail.items.map((item, index) => (
                    <article className="detail-related-item" key={`${item.name}-${index}`}>
                      <a href={item.url} target="_blank" rel="noreferrer">{item.name}</a>
                      <span>{item.type} · {item.address}</span>
                      {item.date !== "—" && <small>{item.date}</small>}
                    </article>
                  ))}
                </div>
              )}
              {detail.sources && (
                <div className="detail-sources">
                  {detail.sources.map((source) => (
                    <a href={source.url} target="_blank" rel="noreferrer" key={source.url}>{source.label}</a>
                  ))}
                </div>
              )}
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

function AreaButton({ label, active, onClick, wide = false }: { label: string; active: boolean; onClick: () => void; wide?: boolean }) {
  return (
    <button
      className={`segment-button ${active ? "active" : ""} ${wide ? "is-wide" : ""}`}
      onClick={onClick}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}
