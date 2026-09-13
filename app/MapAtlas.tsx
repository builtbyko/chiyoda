"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { buildLocationData, geolocationErrorMessage } from "./geolocation";
import { createLazyGeoJsonLoader } from "./lazyGeoJson";

type AreaLayer = "population" | "daytime" | "landUse" | "zoning" | "fire" | "flood" | "none";
type OverlayKey =
  | "roads"
  | "urbanPlanningRoads"
  | "rail"
  | "stationEntrances"
  | "undergroundWalkways"
  | "parks"
  | "landPrices"
  | "shelters"
  | "boundaries"
  | "districtPlans"
  | "heightDistricts"
  | "specialZones"
  | "redevelopment"
  | "chiyodaRegions"
  | "functionalKaiwai"
  | "openSpaces"
  | "areaManagement"
  | "planningMovements"
  | "memoryPlates"
  | "culturalAssets"
  | "terrain"
  | "buildingHeight";
type PhotoEpoch = "pale" | "latest" | "1987" | "1984" | "1979" | "1974" | "1961" | "1945" | "1936";

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
  | "urbanPlanningRoads"
  | "rail"
  | "stations"
  | "stationEntrances"
  | "undergroundWalkways"
  | "districtPlans"
  | "districtPlanSubareas"
  | "heightDistricts"
  | "specialZones"
  | "redevelopment"
  | "chiyodaRegions"
  | "functionalKaiwai"
  | "openSpaces"
  | "areaManagement"
  | "memoryPlates"
  | "culturalAssets"
  | "planningMovements";

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
    urbanChangeDate?: string;
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
    urbanPlanningRoadYear: string;
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
    urbanPlanningRoadCount: number;
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
  kind: "町丁目" | "駅" | "公園" | "地区計画" | "特例地区" | "都市更新" | "7地域" | "文化・歴史資源";
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
const URBAN_PLANNING_ROAD_LAYER_IDS = ["urban-planning-roads-casing", "urban-planning-roads-line", "urban-planning-roads-hit"];
const RAIL_LAYER_IDS = ["rail-casing", "rail-line", "rail-hit", "stations", "station-core"];
const STATION_ENTRANCE_LAYER_IDS = ["station-entrances-hit", "station-entrances-points"];
const UNDERGROUND_WALKWAY_LAYER_IDS = ["underground-walkways-line", "underground-walkways-hit"];
const PARK_LAYER_IDS = ["parks-fill", "parks-outline"];
const LAND_PRICE_LAYER_IDS = ["land-prices-hit", "land-prices-halo", "land-prices"];
const SHELTER_LAYER_IDS = ["shelters-hit", "shelters-halo", "shelters"];
const DISTRICT_PLAN_LAYER_IDS = ["district-plans-casing", "district-plans-line", "district-plans-hit", "district-plan-subareas-fill", "district-plan-subareas-line", "district-plan-subareas-label"];
const PLANNING_MOVEMENT_LAYER_IDS = ["planning-movements-hit", "planning-movements-points"];
const HEIGHT_DISTRICT_LAYER_IDS = ["height-districts-fill", "height-districts-line"];
const SPECIAL_ZONE_LAYER_IDS = ["special-zones-fill", "special-zones-line", "special-zones-hit"];
const URBAN_CHANGE_TIERS = [
  { suffix: "", minzoom: 12.5, filter: ["any", ["!=", ["get", "category"], "large_building"], ["in", ["get", "scale"], ["literal", ["XL", "XXL"]]]] },
  { suffix: "-l", minzoom: 13, filter: ["all", ["==", ["get", "category"], "large_building"], ["==", ["get", "scale"], "L"]] },
  { suffix: "-m", minzoom: 14, filter: ["all", ["==", ["get", "category"], "large_building"], ["==", ["get", "scale"], "M"]] },
];
const REDEVELOPMENT_LAYER_IDS = URBAN_CHANGE_TIERS.flatMap(({ suffix }) => ["hit", "halo", "points"].map((kind) => `redevelopment-${kind}${suffix}`));
const URBAN_CHANGE_IS_CHIYODA = ["in", "千代田区", ["coalesce", ["get", "w"], ""]];
const URBAN_CHANGE_RADIUS = ["*", ["case", ["all", ["==", ["get", "category"], "legal_redevelopment"], ["!", ["has", "grossFloorArea"]]], 5,
  ["interpolate", ["linear"], ["coalesce", ["get", "grossFloorArea"], 3000], 3000, 3.5, 10000, 4.5, 50000, 6, 100000, 7, 600000, 9]], ["case", URBAN_CHANGE_IS_CHIYODA, 1, 0.8]];
const URBAN_CHANGE_COLOR = ["match", ["get", "category"], "legal_redevelopment", "#d1ad7c", "planning_proposal", "#c6bdca", "#a7bcc4"];
const CHIYODA_REGION_LAYER_IDS = ["chiyoda-regions-fill", "chiyoda-regions-line", "chiyoda-regions-label"];
const FUNCTIONAL_KAIWAI_LAYER_IDS = ["functional-kaiwai-fill", "functional-kaiwai-line", "functional-kaiwai-label"];
const OPEN_SPACE_LAYER_IDS = ["open-spaces-fill", "open-spaces-line"];
const AREA_MANAGEMENT_LAYER_IDS = ["area-management-fill", "area-management-line", "area-management-points", "area-management-hit"];
const MEMORY_PLATE_LAYER_IDS = ["memory-plates-hit", "memory-plates-halo", "memory-plates-points"];
const CULTURAL_ASSET_LAYER_IDS = ["cultural-assets-hit", "cultural-assets-halo", "cultural-assets-points", "cultural-assets-fill", "cultural-assets-line"];
const OFFICIAL_ELEMENT_SOURCE = "https://www.city.chiyoda.lg.jp/koho/machizukuri/toshi/walkable/yoso-bumpujokyo.html";
const PLATEAU_BUILDING_SOURCE = "https://github.com/indigo-lab/plateau-tokyo23ku-building-mvt-2020";
const OSM_REFERENCE_SOURCE = "https://www.openstreetmap.org/copyright";
const UNDERGROUND_WALKWAY_NOTE = "OpenStreetMap上の地下・屋内歩行リンク。網羅性は保証されません。";
const DISTRICT_PLAN_SUBAREA_SOURCE = "https://tokei-gis2.chiyodatoshikei.jp/server/rest/services/Map_services/chikukeikaku/MapServer/6";
const PLANNING_MOVEMENT_SOURCE = "https://www.city.chiyoda.lg.jp/";

const AREA_INTERACTIVE_LAYERS: Record<Exclude<AreaLayer, "none">, string[]> = {
  population: ["population-fill"],
  daytime: ["daytime-fill"],
  landUse: ["land-use-fill"],
  zoning: ["zoning-fill"],
  fire: ["fire-fill"],
  flood: ["flood-fill"],
};

const OVERLAY_INTERACTIVE_LAYERS: Partial<Record<OverlayKey, string[]>> = {
  roads: ["roads-hit"],
  urbanPlanningRoads: ["urban-planning-roads-hit"],
  rail: ["stations", "rail-hit"],
  stationEntrances: ["station-entrances-hit"],
  undergroundWalkways: ["underground-walkways-hit"],
  parks: ["parks-fill"],
  landPrices: ["land-prices-hit"],
  shelters: ["shelters-hit"],
  districtPlans: ["district-plans-hit", "district-plan-subareas-fill", "district-plan-subareas-label"],
  heightDistricts: ["height-districts-fill"],
  specialZones: ["special-zones-hit"],
  redevelopment: URBAN_CHANGE_TIERS.map(({ suffix }) => `redevelopment-hit${suffix}`),
  chiyodaRegions: ["chiyoda-regions-label", "chiyoda-regions-fill"],
  functionalKaiwai: ["functional-kaiwai-fill"],
  openSpaces: ["open-spaces-fill"],
  areaManagement: ["area-management-hit", "area-management-fill"],
  planningMovements: ["planning-movements-hit"],
  memoryPlates: ["memory-plates-hit"],
  culturalAssets: ["cultural-assets-hit", "cultural-assets-fill"],
  buildingHeight: ["plateau-building-height-fill"],
};

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
  urbanPlanningRoads: "urban-planning-roads.json",
  rail: "rail.json",
  stations: "stations.json",
  stationEntrances: "station-entrances.json",
  undergroundWalkways: "underground-walkways.json",
  districtPlans: "district-plans.json",
  districtPlanSubareas: "district-plan-subareas.json",
  heightDistricts: "height-districts.json",
  specialZones: "special-zones.json",
  redevelopment: "urban-change-projects.json",
  chiyodaRegions: "chiyoda-regions.json",
  functionalKaiwai: "functional-kaiwai.json",
  openSpaces: "open-spaces.json",
  areaManagement: "area-management.json",
  planningMovements: "planning-movements.json",
  memoryPlates: "memory-plates.json",
  culturalAssets: "cultural-assets.json",
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
  urbanPlanningRoads: "urban-planning-roads",
  rail: "rail",
  stations: "stations",
  stationEntrances: "station-entrances",
  undergroundWalkways: "underground-walkways",
  districtPlans: "district-plans",
  districtPlanSubareas: "district-plan-subareas",
  heightDistricts: "height-districts",
  specialZones: "special-zones",
  redevelopment: "redevelopment",
  chiyodaRegions: "chiyoda-regions",
  functionalKaiwai: "functional-kaiwai",
  openSpaces: "open-spaces",
  areaManagement: "area-management",
  planningMovements: "planning-movements",
  memoryPlates: "memory-plates",
  culturalAssets: "cultural-assets",
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
  urbanPlanningRoads: ["urbanPlanningRoads"],
  rail: ["rail", "stations"],
  stationEntrances: ["stationEntrances"],
  undergroundWalkways: ["undergroundWalkways"],
  parks: ["parks"],
  landPrices: ["landPrices"],
  shelters: ["shelters"],
  boundaries: ["towns"],
  districtPlans: ["districtPlans", "districtPlanSubareas"],
  heightDistricts: ["heightDistricts"],
  specialZones: ["specialZones"],
  redevelopment: ["redevelopment"],
  chiyodaRegions: ["chiyodaRegions"],
  functionalKaiwai: ["functionalKaiwai"],
  openSpaces: ["openSpaces"],
  areaManagement: ["areaManagement"],
  planningMovements: ["planningMovements"],
  memoryPlates: ["memoryPlates"],
  culturalAssets: ["culturalAssets"],
  terrain: [],
  buildingHeight: [],
};

const LAYER_LABELS: Record<AreaLayer | OverlayKey, string> = {
  population: "住民密度",
  daytime: "昼間人口",
  landUse: "実土地利用",
  zoning: "用途地域",
  fire: "防火指定",
  flood: "洪水浸水",
  none: "面表示",
  terrain: "地形・陰影",
  buildingHeight: "建物高さ",
  roads: "主要道路",
  urbanPlanningRoads: "都市計画道路",
  rail: "鉄道・駅",
  stationEntrances: "駅出入口",
  undergroundWalkways: "地下歩行ネットワーク",
  parks: "公園・緑地",
  landPrices: "地価公示",
  shelters: "指定避難所",
  boundaries: "町丁目境界",
  districtPlans: "地区計画",
  heightDistricts: "高度地区",
  specialZones: "容積・再開発等の特例",
  redevelopment: "都市更新",
  chiyodaRegions: "千代田区の7地域",
  functionalKaiwai: "街の個性",
  openSpaces: "公開空地",
  areaManagement: "まちづくり団体",
  planningMovements: "まちづくりの動き",
  memoryPlates: "まちの記憶",
  culturalAssets: "文化・歴史資源",
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
  urbanPlanningRoads: "都市計画道路",
  rail: "鉄道",
  stations: "駅",
  stationEntrances: "駅出入口",
  undergroundWalkways: "地下歩行ネットワーク",
  districtPlans: "地区計画",
  districtPlanSubareas: "地区計画内部区分",
  heightDistricts: "高度地区",
  specialZones: "容積・再開発等の特例",
  redevelopment: "都市更新",
  chiyodaRegions: "千代田区の7地域",
  functionalKaiwai: "街の個性",
  openSpaces: "公開空地",
  areaManagement: "まちづくり団体",
  planningMovements: "まちづくりの動き",
  memoryPlates: "まちの記憶",
  culturalAssets: "文化・歴史資源",
};

const PHOTO_OPTIONS: { value: PhotoEpoch; label: string; tile: string; maxzoom: number }[] = [
  { value: "pale", label: "淡色地図", tile: "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png", maxzoom: 18 },
  { value: "latest", label: "最新航空写真", tile: "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg", maxzoom: 18 },
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

const URBAN_PLANNING_ROAD_LEGEND = [
  ["一般道の計画線", "#ff55b5"],
  ["高速道路・立体（計画）", "#b99bff"],
  ["交通・駅付近広場", "#55e0cc"],
];

const URBAN_PLANNING_ROAD_SOURCE = "https://www.geospatial.jp/ckan/dataset/plateau-tokyo23ku-3dtiles-2020";

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

const REDEVELOPMENT_LEGEND = [["市街地再開発", "#d1ad7c"], ["大規模建替え・新築", "#a7bcc4"], ["構想・都市計画提案（輪郭）", "#c6bdca"]];

const CHIYODA_REGION_LEGEND = [
  ["麹町・番町", "#f2b134"],
  ["飯田橋・富士見", "#2aa89a"],
  ["神保町", "#4f7dd8"],
  ["神田公園", "#8756b3"],
  ["万世橋", "#d45783"],
  ["和泉橋", "#df6d3e"],
  ["大手町・丸の内・有楽町・永田町", "#b73e52"],
];

const CULTURAL_ASSET_LEGEND = [
  ["国文化財", "#856a50"],
  ["東京都文化財", "#687e97"],
  ["千代田区文化財", "#658375"],
  ["景観資源", "#9d6e77"],
];
const BUILDING_HEIGHT_LEGEND = [
  ["15m未満", "#e9ecef"], ["15–30m", "#d8c3a5"], ["30–60m", "#c08a5b"],
  ["60–100m", "#a85f42"], ["100–180m", "#7a3e48"], ["180m以上", "#4f2c55"],
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

function addTileOverlay(map: MapLibreMap, key: "terrain" | "buildingHeight") {
  if (key === "terrain" && !map.getSource("terrain-hillshade")) {
    map.addSource("terrain-hillshade", {
      type: "raster",
      tiles: ["https://cyberjapandata.gsi.go.jp/xyz/hillshademap/{z}/{x}/{y}.png"],
      tileSize: 256, minzoom: 2, maxzoom: 16,
      attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">国土地理院・陰影起伏</a>',
    });
    map.addLayer({
      id: "terrain-hillshade", type: "raster", source: "terrain-hillshade",
      layout: { visibility: "none" },
      paint: { "raster-opacity": 0.34, "raster-contrast": 0.08, "raster-saturation": -1, "raster-fade-duration": 0 },
    }, map.getLayer("plateau-building-height-fill") ? "plateau-building-height-fill" : "population-fill");
  }
  if (key === "buildingHeight" && !map.getSource("plateau-buildings")) {
    map.addSource("plateau-buildings", {
      type: "vector",
      tiles: ["https://indigo-lab.github.io/plateau-tokyo23ku-building-mvt-2020/{z}/{x}/{y}.pbf"],
      minzoom: 10, maxzoom: 16,
      attribution: `<a href="https://www.mlit.go.jp/plateau/" target="_blank">Project PLATEAU（2020年度）</a> / <a href="${PLATEAU_BUILDING_SOURCE}" target="_blank">indigo-lab MVT・CC BY 4.0</a>`,
    });
    map.addLayer({
      id: "plateau-building-height-fill", type: "fill", source: "plateau-buildings",
      "source-layer": "bldg",
      layout: { visibility: "none" },
      paint: {
        "fill-color": [
          "interpolate", ["linear"], ["coalesce", ["to-number", ["get", "measuredHeight"], 0], 0],
          0, "#e9ecef", 15, "#d8c3a5", 30, "#c08a5b", 60, "#a85f42",
          100, "#7a3e48", 180, "#4f2c55",
        ],
        "fill-opacity": 0.52, "fill-outline-color": "rgba(255,255,255,0.22)",
      },
    }, "population-fill");
  }
}

function mapPixelRatioForViewport(container: HTMLElement, moving = false) {
  const deviceRatio = window.devicePixelRatio || 1;
  if (window.innerWidth <= 760) return Math.min(deviceRatio, 1.5);
  const viewportPixels = Math.max(
    (container.clientWidth || window.innerWidth) *
      (container.clientHeight || window.innerHeight),
    1,
  );
  const pixelBudget = moving ? 1_200_000 : 4_000_000;
  const desktopRatio = Math.sqrt(pixelBudget / viewportPixels);
  const minimumRatio = moving ? 0.5 : 1;
  const maximumRatio = moving ? 0.65 : 1.25;
  return Math.round(Math.min(deviceRatio, Math.max(minimumRatio, Math.min(maximumRatio, desktopRatio))) * 100) / 100;
}

function configureMapResolution(map: MapLibreMap, getContainer: () => HTMLElement | null) {
  let idleTimer = 0;
  let resizeTimer = 0;
  let updatingRatio = false;
  let inputHeld = false;
  const applyRatio = (moving: boolean) => {
    const container = getContainer();
    if (!container || updatingRatio || map.isMoving() || (!moving && inputHeld)) return;
    const ratio = mapPixelRatioForViewport(container, moving);
    if (Math.abs(map.getPixelRatio() - ratio) < 0.05) return;
    // setPixelRatio calls resize, which itself emits movement events.
    updatingRatio = true;
    try {
      map.setPixelRatio(ratio);
    } finally {
      updatingRatio = false;
    }
  };
  const beginMovement = () => {
    if (updatingRatio) return;
    window.clearTimeout(idleTimer);
  };
  const finishMovement = () => {
    if (updatingRatio) return;
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      if (!inputHeld && !map.isMoving()) applyRatio(false);
    }, 260);
  };
  const resizeViewport = () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => applyRatio(false), 160);
  };
  const inputTarget = map.getCanvasContainer();
  const inputEvents = ["mousedown", "touchstart", "wheel", "keydown"];
  const prepareInput = (event: Event) => {
    if (updatingRatio) return;
    window.clearTimeout(idleTimer);
    // Resize before MapLibre starts a gesture, never during an active drag.
    applyRatio(true);
    if (event.type === "mousedown" || event.type === "touchstart") {
      inputHeld = true;
    } else {
      finishMovement();
    }
  };
  const releaseInput = () => {
    if (!inputHeld) return;
    inputHeld = false;
    finishMovement();
  };
  const releaseEvents = ["mouseup", "touchend", "touchcancel", "blur"];
  inputEvents.forEach((type) => inputTarget.addEventListener(type, prepareInput, { capture: true, passive: true }));
  releaseEvents.forEach((type) => window.addEventListener(type, releaseInput, { capture: true, passive: true }));
  map.on("movestart", beginMovement);
  map.on("moveend", finishMovement);
  window.addEventListener("resize", resizeViewport, { passive: true });
  return () => {
    window.clearTimeout(idleTimer);
    window.clearTimeout(resizeTimer);
    map.off("movestart", beginMovement);
    map.off("moveend", finishMovement);
    inputEvents.forEach((type) => inputTarget.removeEventListener(type, prepareInput, true));
    releaseEvents.forEach((type) => window.removeEventListener(type, releaseInput, true));
    window.removeEventListener("resize", resizeViewport);
  };
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
  if (["functional-kaiwai", "open-spaces", "area-management", "memory-plates", "cultural-assets"].some((id) => layerId.startsWith(id))) {
    const culture = layerId.startsWith("cultural-assets");
    const rows = [
      ...(culture ? [{ label: "区分", value: textValue(p._category) }] : []),
      { label: "種別", value: textValue(p.t) },
      { label: "所在地", value: textValue(p.a) },
      { label: "指定年月日等", value: textValue(p.d) },
      ...(layerId.startsWith("area-management") && p["団体名2"] ? [{ label: "関連団体", value: [p["団体名2"], p["団体名3"], p["団体名4"]].filter(Boolean).join("・") }] : []),
    ].filter((row) => row.value !== "—");
    return {
      eyebrow: culture ? "Culture & history" : "Chiyoda official GIS",
      title: String(p.n ?? "千代田区の地域資源"),
      rows,
      note: p._coordinate_quality === "block" ? "位置は公式所在地から位置化した街区等の代表点です。" : undefined,
      sources: [{ label: "千代田区公式情報", url: String(p._source_url ?? OFFICIAL_ELEMENT_SOURCE) }],
    };
  }
  if (layerId === "plateau-building-height-fill") {
    const height = p.measuredHeight == null || p.measuredHeight === "" ? NaN : Number(p.measuredHeight);
    return {
      eyebrow: "PLATEAU 2020",
      title: Number.isFinite(height) ? `建物高さ ${height.toFixed(1)} m` : "建物高さ不明",
      rows: [],
      note: "2020年度の高さ構造を学ぶレイヤーです。最新の建物情報ではありません。",
      sources: [{ label: "PLATEAU 2020・MVT配信元", url: PLATEAU_BUILDING_SOURCE }],
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
  if (layerId.startsWith("planning-movements")) {
    const values = [["現在の状態", p.status], ["検討内容", p.summary], ["次のステップ", p.next], ["基準日", p.sourceDate]];
    return {
      eyebrow: "Planning movement",
      title: String(p.n ?? p.name ?? "まちづくりの動き"),
      rows: values.filter(([, value]) => value != null && value !== "").map(([label, value]) => ({ label: String(label), value: String(value) })),
      note: `基準日時点の情報です。位置は町丁目の代表点（参考位置）です。事業敷地や対象区域を示していません。${p.anchorResolution === "town_name_only" ? "町名のみ指定され、丁目は未特定です。" : ""}`,
      sources: [{ label: "千代田区公式情報", url: String(p.sourceUrl ?? p._source_url ?? PLANNING_MOVEMENT_SOURCE) }],
    };
  }
  if (layerId.startsWith("district-plan-subareas")) {
    const values = [["地区計画", p.planName ?? p["名称"]], ["内部区分", p.n ?? p["区分"]], ["最終決定日", p["最終決定日"]], ["告示番号", p["最終決定告示番号"]]];
    return {
      eyebrow: "District plan subarea",
      title: String(p.n ?? p["区分"] ?? "地区計画内部区分"),
      rows: values.filter(([, value]) => value != null && value !== "").map(([label, value]) => ({ label: String(label), value: String(value) })),
      note: "公式GISの内部区分です。個別敷地の制限は計画書・計画図で確認してください。",
      sources: [
        { label: "千代田区公式ArcGIS", url: String(p._source_url ?? DISTRICT_PLAN_SUBAREA_SOURCE) },
        ...(p["詳細資料"] ? [{ label: "千代田区・地区計画資料", url: String(p["詳細資料"]) }] : []),
      ],
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
    const values = [
      ["区分", p.categoryLabel], ["状況", p.status], ["関係区", p.w], ["所在地", p.address],
      ["延べ面積", p.grossFloorArea == null ? undefined : numberValue(p.grossFloorArea, " ㎡")],
      ["用途", p.uses], ["工事種別", p.constructionType], ["竣工予定", p.completion],
      ["施行者", p.operator], ["区域面積", p.areaHa == null ? undefined : numberValue(p.areaHa, " ha")],
      ["都市計画決定", p.urbanPlanDate], ["事業計画認可", p.approvalDate], ["出典基準日", p.sourceDate],
    ];
    const quality = String(p.locationQuality ?? "");
    return {
      eyebrow: "Urban change",
      title: String(p.n ?? "都市更新"),
      rows: values.filter(([, value]) => value != null && value !== "").map(([label, value]) => ({ label: String(label), value: String(value) })),
      note: `${quality === "gsi_geocode" ? "国土地理院の住所検索による参考位置です。" : ["town_centroid", "町丁目代表点"].includes(quality) ? "位置は町丁目の代表点です。" : "位置精度は未確認の参考点です。"}点は敷地境界・事業区域を示しません。情報は出典基準日時点で、竣工予定は実際の完成を意味しません。`,
      sources: [
        { label: String(p.sourceName ?? "公式情報"), url: String(p.sourceUrl ?? p._source_url ?? "https://www.city.chiyoda.lg.jp/koho/machizukuri/toshi/yotochiiki/saikaihatsu.html") },
        ...(p.proposalUrl ? [{ label: "東京都・提案書", url: String(p.proposalUrl) }] : []),
      ],
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
  if (layerId.startsWith("station-entrances") || layerId.startsWith("underground-walkways")) {
    const entrance = layerId.startsWith("station-entrances");
    const wheelchair = { yes: "対応（OSM）", no: "非対応（OSM）", limited: "一部対応（OSM）" };
    const values = [
      ["出口番号", p.ref],
      ["駅", p.station],
      ["事業者", p.operator],
      ["ネットワーク", p.network],
      ["車いす", p.wheelchair ? wheelchair[String(p.wheelchair) as keyof typeof wheelchair] ?? p.wheelchair : undefined],
      ["階", p.level],
    ];
    const osmType = String(p._osm_type ?? "");
    const osmId = Number(p._osm_id);
    return {
      eyebrow: entrance ? "Station entrance" : "Underground walkway",
      title: String(p.n ?? (entrance ? "駅出入口" : "地下歩行リンク")),
      rows: values.filter(([, value]) => value != null && value !== "").map(([label, value]) => ({ label: String(label), value: String(value) })),
      note: entrance ? "OpenStreetMapの参考位置・属性です。最新の出口・バリアフリー情報は駅の案内で確認してください。" : UNDERGROUND_WALKWAY_NOTE,
      sources: [{ label: "OpenStreetMap（参考）", url: ["node", "way"].includes(osmType) && Number.isSafeInteger(osmId) && osmId > 0 ? `https://www.openstreetmap.org/${osmType}/${osmId}` : OSM_REFERENCE_SOURCE }],
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
  if (layerId.includes("urban-planning-road")) {
    return {
      eyebrow: "Urban planning road",
      title: "都市計画道路",
      rows: [
        { label: "区", value: textValue(p.w) },
        { label: "分類", value: textValue(p.t) },
        { label: "データ年度", value: meta?.urbanPlanningRoadYear ?? "2020年度" },
      ],
      note: "整備状況を示す線ではありません。路線名・計画幅員・最新の計画区域は各区・東京都の公式図書で確認してください。",
      sources: [
        { label: "国土交通省PLATEAU・東京都23区（2020年度）", url: URBAN_PLANNING_ROAD_SOURCE },
        { label: "東京都・都市計画情報", url: "https://www2.wagmap.jp/tokyo_tokeizu/Portal" },
      ],
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

function culturalGroupDetail(properties: Record<string, unknown>[]): Detail {
  return {
    eyebrow: "Culture & history",
    title: `同じ位置の${properties.length}物件`,
    rows: [],
    note: "公式GISの同一点に登録された物件をまとめて表示しています。",
    items: properties.map((item) => ({
      name: textValue(item.n),
      type: textValue(item.t),
      address: textValue(item.a),
      date: textValue(item.d),
      url: String(item._source_url ?? OFFICIAL_ELEMENT_SOURCE),
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
      fetcher: (url) => fetch(url, url.endsWith("urban-change-projects.json") ? { cache: "no-cache" } : undefined),
    }),
  );
  const loadingOverlaysRef = useRef(new Set<OverlayKey>());
  const interactiveLayersRef = useRef<string[]>([]);
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
    urbanPlanningRoads: false,
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
    stationEntrances: false,
    undergroundWalkways: false,
    functionalKaiwai: false,
    openSpaces: false,
    areaManagement: false,
    planningMovements: false,
    memoryPlates: false,
    culturalAssets: false,
    terrain: false,
    buildingHeight: false,
  });
  const [photoEpoch, setPhotoEpoch] = useState<PhotoEpoch>("pale");
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
    const layers = areaLayer === "none" ? [] : [...AREA_INTERACTIVE_LAYERS[areaLayer]];
    for (const [key, enabled] of Object.entries(overlays) as [OverlayKey, boolean][]) {
      if (enabled) layers.push(...(OVERLAY_INTERACTIVE_LAYERS[key] ?? []));
    }
    interactiveLayersRef.current = layers;
  }, [areaLayer, overlays]);

  useEffect(() => {
    if (!mapElement.current || mapRef.current) return;
    let disposed = false;
    let cursorTimer = 0;
    let wheelTimer = 0;
    let removeViewportListener = () => {};
    let removeWheelListener = () => {};
    let pendingCursorPoint: [number, number] | null = null;
    const loadingOverlays = loadingOverlaysRef.current;

    Promise.all([
      import("maplibre-gl"),
      fetch("data/map-data.json", { cache: "no-cache" }).then((response) => {
        if (!response.ok) throw new Error("地図データを読み込めませんでした");
        return response.json() as Promise<AtlasData>;
      }),
    ])
      .then(([maplibregl, data]) => {
        if (disposed || !mapElement.current) return;
        const isMobileViewport = window.innerWidth <= 760;
        const geoJsonOptions = isMobileViewport ? {} : { buffer: 64, tolerance: 1.25 };
        if (!isMobileViewport && maplibregl.getWorkerCount() < 2) {
          maplibregl.setWorkerCount(2);
        }
        const initialPhoto = PHOTO_OPTIONS[0];
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
          pixelRatio: mapPixelRatioForViewport(mapElement.current),
          maxTileCacheZoomLevels: isMobileViewport ? 1 : 2,
          refreshExpiredTiles: false,
          fadeDuration: 0,
          attributionControl: false,
          style: {
            version: 8,
            sources: {
              [`photo-${initialPhoto.value}`]: {
                type: "raster",
                tiles: [initialPhoto.tile],
                tileSize: 256,
                minzoom: 10,
                maxzoom: initialPhoto.maxzoom,
                attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">国土地理院</a>',
              },
            } as never,
            layers: [{
                id: "base-photo",
                type: "raster",
                source: `photo-${initialPhoto.value}`,
                paint: {
                  "raster-saturation": 0,
                  "raster-contrast": 0,
                  "raster-brightness-max": 1,
                  "raster-fade-duration": 0,
                },
              }] as never,
          },
        });

        if (!isMobileViewport) {
          map.scrollZoom.disable();
          const wheelTarget = map.getCanvas();
          let accumulatedWheelDelta = 0;
          let lastWheelPoint: [number, number] = [0, 0];
          let lastWheelStepAt = -Infinity;

          const applyDiscreteWheel = () => {
            wheelTimer = 0;
            if (Math.abs(accumulatedWheelDelta) < 4) {
              accumulatedWheelDelta = 0;
              return;
            }
            const delta = accumulatedWheelDelta;
            accumulatedWheelDelta = 0;
            const currentZoom = map.getZoom();
            const targetZoom = Math.min(
              map.getMaxZoom(),
              Math.max(map.getMinZoom(), currentZoom + (delta > 0 ? -0.5 : 0.5)),
            );
            lastWheelStepAt = performance.now();
            if (Math.abs(targetZoom - currentZoom) < 0.001) return;
            map.easeTo({
              zoom: targetZoom,
              around: map.unproject(lastWheelPoint),
              duration: 0,
            });
          };

          const scheduleDiscreteWheel = (minimumDelay: number) => {
            if (wheelTimer) return;
            const cooldown = Math.max(0, 90 - (performance.now() - lastWheelStepAt));
            wheelTimer = window.setTimeout(applyDiscreteWheel, Math.max(minimumDelay, cooldown));
          };

          const handleDiscreteWheel = (event: WheelEvent) => {
            event.preventDefault();
            const rect = wheelTarget.getBoundingClientRect();
            lastWheelPoint = [event.clientX - rect.left, event.clientY - rect.top];
            const deltaScale = event.deltaMode === 1
              ? 16
              : event.deltaMode === 2
                ? Math.max(wheelTarget.clientHeight, 1)
                : 1;
            accumulatedWheelDelta += event.deltaY * deltaScale;
            const minimumDelay = event.deltaMode === 0 && Math.abs(accumulatedWheelDelta) < 18
              ? 90
              : 0;
            scheduleDiscreteWheel(minimumDelay);
          };

          wheelTarget.addEventListener("wheel", handleDiscreteWheel, { passive: false });
          removeWheelListener = () => {
            wheelTarget.removeEventListener("wheel", handleDiscreteWheel);
          };
        }

        mapRef.current = map;
        removeViewportListener = configureMapResolution(map, () => disposed ? null : mapElement.current);
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
        map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

        map.on("load", () => {
          map.addSource("towns", {
            type: "geojson",
            data: EMPTY_COLLECTION as never,
            ...geoJsonOptions,
            attribution: '人口・土地利用：<a href="https://catalog.data.metro.tokyo.lg.jp/" target="_blank">東京都</a>',
          });
          map.addSource("zoning", {
            type: "geojson",
            data: EMPTY_COLLECTION as never,
            ...geoJsonOptions,
          });
          map.addSource("fire", {
            type: "geojson",
            data: EMPTY_COLLECTION as never,
            ...geoJsonOptions,
            attribution: '防火指定：<a href="https://www.mlit.go.jp/toshi/tosiko/toshi_tosiko_tk_000087.html" target="_blank">国土交通省</a>',
          });
          map.addSource("flood", {
            type: "geojson",
            data: EMPTY_COLLECTION as never,
            ...geoJsonOptions,
            attribution: '洪水浸水：<a href="https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A31a-2025.html" target="_blank">国土数値情報</a>',
          });
          map.addSource("parks", {
            type: "geojson",
            data: EMPTY_COLLECTION as never,
            ...geoJsonOptions,
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
            ...geoJsonOptions,
            attribution: '道路 © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a>',
          });
          map.addSource("urban-planning-roads", {
            type: "geojson",
            data: EMPTY_COLLECTION as never,
            ...geoJsonOptions,
            attribution: `都市計画道路：<a href="${URBAN_PLANNING_ROAD_SOURCE}" target="_blank">国土交通省PLATEAU（2020年度）を加工</a>`,
          });
          map.addSource("rail", {
            type: "geojson",
            data: EMPTY_COLLECTION as never,
            ...geoJsonOptions,
          });
          map.addSource("stations", { type: "geojson", data: EMPTY_COLLECTION as never });
          map.addSource("station-entrances", {
            type: "geojson",
            data: EMPTY_COLLECTION as never,
            ...geoJsonOptions,
            attribution: `駅出入口：<a href="${OSM_REFERENCE_SOURCE}" target="_blank">© OpenStreetMap contributors（参考・ODbL）</a>`,
          });
          map.addSource("underground-walkways", {
            type: "geojson",
            data: EMPTY_COLLECTION as never,
            ...geoJsonOptions,
            attribution: `地下歩行リンク：<a href="${OSM_REFERENCE_SOURCE}" target="_blank">© OpenStreetMap contributors（参考・ODbL）</a>`,
          });
          map.addSource("wards", {
            type: "geojson",
            data: data.wards as never,
            ...geoJsonOptions,
          });
          map.addSource("city", {
            type: "geojson",
            data: data.city as never,
            ...geoJsonOptions,
          });
          map.addSource("district-plans", {
            type: "geojson",
            data: EMPTY_COLLECTION as never,
            ...geoJsonOptions,
            attribution: '地区計画：<a href="https://catalog.data.metro.tokyo.lg.jp/dataset/t000008d0000000028" target="_blank">東京都</a>',
          });
          map.addSource("district-plan-subareas", {
            type: "geojson",
            data: EMPTY_COLLECTION as never,
            ...geoJsonOptions,
            attribution: `地区計画内部区分：<a href="${DISTRICT_PLAN_SUBAREA_SOURCE}" target="_blank">千代田区公式GISを加工</a>`,
          });
          map.addSource("planning-movements", {
            type: "geojson",
            data: EMPTY_COLLECTION as never,
            ...geoJsonOptions,
            attribution: `まちづくりの動き：<a href="${PLANNING_MOVEMENT_SOURCE}" target="_blank">千代田区（公式資料は各点のリンク参照）</a>`,
          });
          map.addSource("height-districts", {
            type: "geojson",
            data: EMPTY_COLLECTION as never,
            ...geoJsonOptions,
          });
          map.addSource("special-zones", {
            type: "geojson",
            data: EMPTY_COLLECTION as never,
            ...geoJsonOptions,
          });
          map.addSource("redevelopment", {
            type: "geojson",
            data: EMPTY_COLLECTION as never,
            attribution: '都市更新：千代田区・東京都公式資料（各点の出典参照）／参考位置：国土地理院住所検索・町丁目代表点',
          });
          map.addSource("chiyoda-regions", {
            type: "geojson",
            data: EMPTY_COLLECTION as never,
            ...geoJsonOptions,
            attribution: '7地域：<a href="https://www.city.chiyoda.lg.jp/documents/17862/toshimasu-4_2.pdf" target="_blank">千代田区都市計画マスタープラン</a>',
          });
          map.addSource("functional-kaiwai", {
            type: "geojson",
            data: EMPTY_COLLECTION as never,
            ...geoJsonOptions,
            attribution: `街の個性：<a href="${OFFICIAL_ELEMENT_SOURCE}" target="_blank">千代田区公式GISを加工</a>`,
          });
          map.addSource("open-spaces", {
            type: "geojson",
            data: EMPTY_COLLECTION as never,
            ...geoJsonOptions,
            attribution: `公開空地：<a href="${OFFICIAL_ELEMENT_SOURCE}" target="_blank">千代田区公式GISを加工</a>`,
          });
          map.addSource("area-management", {
            type: "geojson",
            data: EMPTY_COLLECTION as never,
            ...geoJsonOptions,
            attribution: `まちづくり団体：<a href="${OFFICIAL_ELEMENT_SOURCE}" target="_blank">千代田区公式GISを加工</a>`,
          });
          map.addSource("memory-plates", {
            type: "geojson",
            data: EMPTY_COLLECTION as never,
            ...geoJsonOptions,
            attribution: `まちの記憶：<a href="${OFFICIAL_ELEMENT_SOURCE}" target="_blank">千代田区公式GISを加工</a>`,
          });
          map.addSource("cultural-assets", {
            type: "geojson",
            data: EMPTY_COLLECTION as never,
            ...geoJsonOptions,
            attribution: `文化・歴史資源：<a href="${OFFICIAL_ELEMENT_SOURCE}" target="_blank">千代田区公式GISを加工</a>`,
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
            id: "functional-kaiwai-fill", type: "fill", source: "functional-kaiwai",
            filter: ["==", ["geometry-type"], "Polygon"],
            layout: { visibility: "none" },
            paint: { "fill-color": "#b3976b", "fill-opacity": 0.12 },
          });
          map.addLayer({
            id: "functional-kaiwai-line", type: "line", source: "functional-kaiwai",
            filter: ["==", ["geometry-type"], "Polygon"],
            layout: { visibility: "none" },
            paint: { "line-color": "#b3976b", "line-width": 1.8, "line-opacity": 0.9 },
          });
          map.addLayer({
            id: "open-spaces-fill", type: "fill", source: "open-spaces",
            filter: ["==", ["geometry-type"], "Polygon"],
            layout: { visibility: "none" },
            paint: { "fill-color": "#7296a3", "fill-opacity": 0.18 },
          });
          map.addLayer({
            id: "open-spaces-line", type: "line", source: "open-spaces",
            filter: ["==", ["geometry-type"], "Polygon"],
            layout: { visibility: "none" },
            paint: { "line-color": "#7296a3", "line-width": 1.2, "line-opacity": 0.9 },
          });
          map.addLayer({
            id: "area-management-fill", type: "fill", source: "area-management",
            filter: ["==", ["geometry-type"], "Polygon"],
            layout: { visibility: "none" },
            paint: { "fill-color": "#8b809a", "fill-opacity": 0.12 },
          });
          map.addLayer({
            id: "area-management-line", type: "line", source: "area-management",
            filter: ["==", ["geometry-type"], "Polygon"],
            layout: { visibility: "none" },
            paint: { "line-color": "#8b809a", "line-width": 1.2, "line-opacity": 0.9 },
          });
          map.addLayer({
            id: "cultural-assets-fill", type: "fill", source: "cultural-assets",
            filter: ["==", ["geometry-type"], "Polygon"],
            layout: { visibility: "none" },
            paint: { "fill-color": ["match",["get","_category"],"国文化財","#856a50","東京都文化財","#687e97","千代田区文化財","#658375","景観資源","#9d6e77","#7b8082"], "fill-opacity": 0.15 },
          });
          map.addLayer({
            id: "cultural-assets-line", type: "line", source: "cultural-assets",
            filter: ["==", ["geometry-type"], "Polygon"],
            layout: { visibility: "none" },
            paint: { "line-color": ["match",["get","_category"],"国文化財","#856a50","東京都文化財","#687e97","千代田区文化財","#658375","景観資源","#9d6e77","#7b8082"], "line-width": 1.2, "line-opacity": 0.9 },
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
            paint: { "fill-color": "#ffffff", "fill-opacity": 0 },
          });
          map.addLayer({
            id: "district-plan-subareas-fill", type: "fill", source: "district-plan-subareas",
            minzoom: 14,
            layout: { visibility: "none" },
            paint: { "fill-color": "#00c2d7", "fill-opacity": 0.06 },
          });
          map.addLayer({
            id: "district-plan-subareas-line", type: "line", source: "district-plan-subareas",
            minzoom: 14,
            layout: { visibility: "none" },
            paint: { "line-color": "#8fb7bd", "line-width": 0.8, "line-opacity": 0.6 },
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
            paint: { "fill-color": "#ffffff", "fill-opacity": 0 },
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
            paint: { "line-color": "#ffffff", "line-width": 14, "line-opacity": 0 },
          });
          map.addLayer({
            id: "urban-planning-roads-casing",
            type: "line",
            source: "urban-planning-roads",
            layout: { visibility: "none" },
            paint: {
              "line-color": "#182032",
              "line-width": ["interpolate", ["linear"], ["zoom"], 11, 2.6, 17, 4.2],
              "line-opacity": 0.8,
            },
          });
          map.addLayer({
            id: "urban-planning-roads-line",
            type: "line",
            source: "urban-planning-roads",
            layout: { visibility: "none" },
            paint: {
              "line-color": ["match", ["get", "c"], "highway", "#b99bff", "plaza", "#55e0cc", "#ff55b5"],
              "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.2, 17, 2.4],
              "line-opacity": 0.96,
            },
          });
          map.addLayer({
            id: "urban-planning-roads-hit",
            type: "line",
            source: "urban-planning-roads",
            layout: { visibility: "none" },
            paint: { "line-color": "#ffffff", "line-width": 12, "line-opacity": 0 },
          });
          map.addLayer({
            id: "underground-walkways-line",
            type: "line",
            source: "underground-walkways",
            minzoom: 14,
            layout: { visibility: "none" },
            paint: {
              "line-color": "#c1cad1",
              "line-width": ["interpolate", ["linear"], ["zoom"], 14, 1, 18, 2],
              "line-opacity": 0.75,
              "line-dasharray": [3, 2],
            },
          });
          map.addLayer({
            id: "underground-walkways-hit",
            type: "line",
            source: "underground-walkways",
            minzoom: 14,
            layout: { visibility: "none" },
            paint: { "line-color": "#ffffff", "line-width": 10, "line-opacity": 0 },
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
            paint: { "line-color": "#ffffff", "line-width": 15, "line-opacity": 0 },
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
            id: "station-entrances-hit",
            type: "circle",
            source: "station-entrances",
            minzoom: 14,
            layout: { visibility: "none" },
            paint: { "circle-radius": 9, "circle-color": "#ffffff", "circle-opacity": 0 },
          });
          map.addLayer({
            id: "station-entrances-points",
            type: "circle",
            source: "station-entrances",
            minzoom: 14,
            layout: { visibility: "none" },
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 2.3, 18, 3.8],
              "circle-color": "#7d9cb0",
              "circle-stroke-color": "#fffdf8",
              "circle-stroke-width": 1,
            },
          });
          map.addLayer({
            id: "planning-movements-hit", type: "circle", source: "planning-movements",
            layout: { visibility: "none" },
            paint: { "circle-radius": 12, "circle-color": "#ffffff", "circle-opacity": 0 },
          });
          map.addLayer({
            id: "planning-movements-points", type: "circle", source: "planning-movements",
            layout: { visibility: "none" },
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 4, 17, 6],
              "circle-color": "#ffffff", "circle-opacity": 0,
              "circle-stroke-color": "#d7cde0", "circle-stroke-width": 1.8,
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
              "circle-opacity": 0,
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
              "circle-opacity": 0,
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
          for (const tier of URBAN_CHANGE_TIERS) {
          map.addLayer({
            id: `redevelopment-hit${tier.suffix}`,
            type: "circle",
            source: "redevelopment",
            minzoom: tier.minzoom,
            filter: tier.filter as never,
            layout: { visibility: "none" },
            paint: {
              "circle-radius": 12,
              "circle-color": "#ffffff",
              "circle-opacity": 0,
            },
          });
          map.addLayer({
            id: `redevelopment-halo${tier.suffix}`,
            type: "circle",
            source: "redevelopment",
            minzoom: tier.minzoom,
            filter: tier.filter as never,
            layout: { visibility: "none" },
            paint: {
              "circle-radius": ["+", URBAN_CHANGE_RADIUS, 2] as never,
              "circle-color": "#111916",
              "circle-opacity": ["case", ["==", ["get", "category"], "planning_proposal"], 0, URBAN_CHANGE_IS_CHIYODA, 0.72, 0.3] as never,
            },
          });
          map.addLayer({
            id: `redevelopment-points${tier.suffix}`,
            type: "circle",
            source: "redevelopment",
            minzoom: tier.minzoom,
            filter: tier.filter as never,
            layout: { visibility: "none" },
            paint: {
              "circle-radius": URBAN_CHANGE_RADIUS as never,
              "circle-color": URBAN_CHANGE_COLOR as never,
              "circle-opacity": ["case", ["==", ["get", "category"], "planning_proposal"], 0, URBAN_CHANGE_IS_CHIYODA, 0.9, 0.35] as never,
              "circle-stroke-color": URBAN_CHANGE_COLOR as never,
              "circle-stroke-opacity": ["case", URBAN_CHANGE_IS_CHIYODA, 1, 0.35] as never,
              "circle-stroke-width": ["case", ["==", ["get", "category"], "planning_proposal"], 1.8, 1.2],
            },
          });
          }
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
            id: "area-management-hit", type: "circle", source: "area-management",
            filter: ["==", ["geometry-type"], "Point"],
            layout: { visibility: "none" },
            paint: { "circle-radius": 14, "circle-color": "#ffffff", "circle-opacity": 0 },
          });
          map.addLayer({
            id: "area-management-points", type: "circle", source: "area-management",
            filter: ["==", ["geometry-type"], "Point"],
            layout: { visibility: "none" },
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3.2, 16, 5.2],
              "circle-color": "#8b809a",
              "circle-stroke-color": "#fffdf8", "circle-stroke-width": 1,
            },
          });
          map.addLayer({
            id: "memory-plates-hit", type: "circle", source: "memory-plates",
            filter: ["==", ["geometry-type"], "Point"],
            layout: { visibility: "none" },
            paint: { "circle-radius": 14, "circle-color": "#ffffff", "circle-opacity": 0 },
          });
          map.addLayer({
            id: "memory-plates-halo", type: "circle", source: "memory-plates",
            filter: ["==", ["geometry-type"], "Point"],
            layout: { visibility: "none" },
            paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 4.6, 16, 6.8], "circle-color": "#17211f", "circle-opacity": 0.8 },
          });
          map.addLayer({
            id: "memory-plates-points", type: "circle", source: "memory-plates",
            filter: ["==", ["geometry-type"], "Point"],
            layout: { visibility: "none" },
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3.2, 16, 5.2],
              "circle-color": "#91846b",
              "circle-stroke-color": "#fffdf8", "circle-stroke-width": 1,
            },
          });
          map.addLayer({
            id: "cultural-assets-hit", type: "circle", source: "cultural-assets",
            filter: ["==", ["geometry-type"], "Point"],
            layout: { visibility: "none" },
            paint: { "circle-radius": 14, "circle-color": "#ffffff", "circle-opacity": 0 },
          });
          map.addLayer({
            id: "cultural-assets-halo", type: "circle", source: "cultural-assets",
            filter: ["==", ["geometry-type"], "Point"],
            layout: { visibility: "none" },
            paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 4.6, 16, 6.8], "circle-color": "#17211f", "circle-opacity": 0.8 },
          });
          map.addLayer({
            id: "cultural-assets-points", type: "circle", source: "cultural-assets",
            filter: ["==", ["geometry-type"], "Point"],
            layout: { visibility: "none" },
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3.2, 16, 5.2],
              "circle-color": ["match",["get","_category"],"国文化財","#856a50","東京都文化財","#687e97","千代田区文化財","#658375","景観資源","#9d6e77","#7b8082"],
              "circle-stroke-color": "#fffdf8", "circle-stroke-width": 1,
            },
          });
          map.addLayer({
            id: "functional-kaiwai-label", type: "symbol", source: "functional-kaiwai",
            minzoom: 13,
            layout: { visibility: "none", "text-field": ["get", "n"], "text-size": ["interpolate", ["linear"], ["zoom"], 13, 13, 16, 15], "text-max-width": 12 },
            paint: { "text-color": "#fffdf8", "text-halo-color": "#17211f", "text-halo-width": 1.5 },
          });
          map.addLayer({
            id: "district-plan-subareas-label", type: "symbol", source: "district-plan-subareas",
            minzoom: 16,
            layout: { visibility: "none", "text-field": ["get", "n"], "text-size": 13, "text-max-width": 9 },
            paint: { "text-color": "#fffdf8", "text-halo-color": "#17211f", "text-halo-width": 1.5 },
          });
          map.addLayer({
            id: "chiyoda-regions-label",
            type: "symbol",
            source: "chiyoda-regions",
            layout: {
              visibility: "none",
              "text-field": ["get", "s"],
              "text-size": ["interpolate", ["linear"], ["zoom"], 11, 13, 14, 15],
              "text-max-width": 11,
              "text-letter-spacing": 0.04,
            },
            paint: {
              "text-color": "#fffdf8",
              "text-halo-color": "rgba(22, 31, 30, 0.92)",
              "text-halo-width": 1.5,
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

          let cursorStyle = "";
          const setMapCursor = (value: string) => {
            if (cursorStyle === value) return;
            cursorStyle = value;
            map.getCanvas().style.cursor = value;
          };
          map.on("mousemove", (event) => {
            const layers = interactiveLayersRef.current;
            if (layers.length === 0 || map.isMoving()) {
              setMapCursor("");
              return;
            }
            pendingCursorPoint = [event.point.x, event.point.y];
            if (cursorTimer) return;
            cursorTimer = window.setTimeout(() => {
              cursorTimer = 0;
              if (disposed || map.isMoving() || !pendingCursorPoint) return;
              const activeLayers = interactiveLayersRef.current;
              const hit = activeLayers.length > 0 &&
                map.queryRenderedFeatures(pendingCursorPoint, { layers: activeLayers }).length > 0;
              setMapCursor(hit ? "pointer" : "");
            }, 80);
          });
          map.on("click", (event) => {
            const activeLayers = interactiveLayersRef.current;
            const rendered = activeLayers.length > 0
              ? map.queryRenderedFeatures(event.point, { layers: activeLayers })
              : [];
            let feature =
              rendered.find((item) => item.layer.id === "chiyoda-regions-label") ??
              rendered.find((item) => !item.layer.id.startsWith("chiyoda-regions")) ??
              rendered[0];
            if (feature?.layer.id === "district-plans-hit") {
              feature = rendered.find((item) => item.layer.id === "district-plan-subareas-fill") ?? feature;
            }
            const source = map.getSource("selection") as GeoJSONSource;
            if (!feature) {
              setDetail(null);
              source.setData({ type: "FeatureCollection", features: [] });
              return;
            }
            if (feature.layer.id.startsWith("cultural-assets")) {
              const coordinates = "coordinates" in feature.geometry ? JSON.stringify(feature.geometry.coordinates) : "";
              const seen = new Set<string>();
              const properties = rendered
                .filter((item) => (
                  item.layer.id.startsWith("cultural-assets") &&
                  "coordinates" in item.geometry && JSON.stringify(item.geometry.coordinates) === coordinates
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
                  ? culturalGroupDetail(properties)
                  : detailFor(feature.layer.id, feature.properties ?? {}, data.meta),
              );
            } else {
              setDetail(detailFor(feature.layer.id, feature.properties ?? {}, data.meta));
            }
            source.setData(
              feature.layer.id === "flood-fill" || feature.layer.id.startsWith("urban-planning-roads")
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
      window.clearTimeout(cursorTimer);
      window.clearTimeout(wheelTimer);
      removeViewportListener();
      removeWheelListener();
      mapRef.current?.remove();
      mapRef.current = null;
      locationRequestRef.current += 1;
      loadingOverlays.clear();
      interactiveLayersRef.current = [];
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
    setLayerVisibility(map, URBAN_PLANNING_ROAD_LAYER_IDS, overlays.urbanPlanningRoads);
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
    setLayerVisibility(map, FUNCTIONAL_KAIWAI_LAYER_IDS, overlays.functionalKaiwai);
    setLayerVisibility(map, STATION_ENTRANCE_LAYER_IDS, overlays.stationEntrances);
    setLayerVisibility(map, UNDERGROUND_WALKWAY_LAYER_IDS, overlays.undergroundWalkways);
    setLayerVisibility(map, OPEN_SPACE_LAYER_IDS, overlays.openSpaces);
    setLayerVisibility(map, AREA_MANAGEMENT_LAYER_IDS, overlays.areaManagement);
    setLayerVisibility(map, PLANNING_MOVEMENT_LAYER_IDS, overlays.planningMovements);
    setLayerVisibility(map, MEMORY_PLATE_LAYER_IDS, overlays.memoryPlates);
    setLayerVisibility(map, CULTURAL_ASSET_LAYER_IDS, overlays.culturalAssets);
    setLayerVisibility(map, ["terrain-hillshade"], overlays.terrain);
    setLayerVisibility(map, ["plateau-building-height-fill"], overlays.buildingHeight);
  }, [overlays, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const option = PHOTO_OPTIONS.find((item) => item.value === photoEpoch);
    if (!option) return;
    const sourceId = `photo-${option.value}`;
    if (!map.getSource(sourceId) || !map.getLayer("base-photo")) {
      if (map.getLayer("base-photo")) map.removeLayer("base-photo");
      PHOTO_OPTIONS.forEach((item) => {
        const existingSourceId = `photo-${item.value}`;
        if (map.getSource(existingSourceId)) map.removeSource(existingSourceId);
      });
      map.addSource(sourceId, {
        type: "raster",
        tiles: [option.tile],
        tileSize: 256,
        minzoom: option.value === "1936" ? 13 : 10,
        maxzoom: option.maxzoom,
        attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">国土地理院</a>',
      });
      map.addLayer({
        id: "base-photo",
        type: "raster",
        source: sourceId,
        paint: {
          "raster-saturation": option.value === "pale" ? 0 : option.value === "latest" ? -0.36 : -0.16,
          "raster-contrast": option.value === "pale" ? 0 : -0.08,
          "raster-brightness-max": option.value === "pale" ? 1 : 0.92,
          "raster-fade-duration": 0,
        },
      }, map.getLayer("terrain-hillshade") ? "terrain-hillshade" : map.getLayer("plateau-building-height-fill") ? "plateau-building-height-fill" : "population-fill");
    }
    if (photoEpoch === "1936" && map.getZoom() < 13) {
      map.easeTo({ zoom: 13, duration: 0 });
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
      if (key === "terrain" || key === "buildingHeight") addTileOverlay(mapRef.current!, key);
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
      if (item.kind === "都市更新") {
        setOverlays((current) => ({ ...current, redevelopment: true }));
      }
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
    if (overlays.urbanPlanningRoads) groups.push({ title: "都市計画道路（2020年度）", items: URBAN_PLANNING_ROAD_LEGEND });
    if (overlays.rail) groups.push({ title: "鉄道", items: RAIL_LEGEND });
    if (overlays.stationEntrances) groups.push({ title: "駅出入口 · OSM参考", items: [["ズーム14以上", "#7d9cb0"]] });
    if (overlays.undergroundWalkways) groups.push({ title: "地下歩行 · OSM参考", items: [["ズーム14以上・非網羅", "#c1cad1"]] });
    if (overlays.parks) groups.push({ title: "公園・緑地", items: PARK_LEGEND });
    if (overlays.landPrices) groups.push({ title: "地価公示（円/m²）", items: LAND_PRICE_LEGEND });
    if (overlays.shelters) groups.push({ title: "指定避難所", items: SHELTER_LEGEND });
    if (overlays.districtPlans) groups.push({ title: "地区計画", items: DISTRICT_PLAN_LEGEND });
    if (overlays.heightDistricts) groups.push({ title: "高度地区（千代田・中央は指定なし）", items: HEIGHT_DISTRICT_LEGEND });
    if (overlays.specialZones) groups.push({ title: "容積・再開発等の特例", items: SPECIAL_ZONE_LEGEND });
    if (overlays.redevelopment) groups.push({ title: "都市更新", items: REDEVELOPMENT_LEGEND });
    if (overlays.chiyodaRegions) groups.push({ title: "千代田区の7地域", items: CHIYODA_REGION_LEGEND });
    if (overlays.culturalAssets) groups.push({ title: "文化・歴史資源", items: CULTURAL_ASSET_LEGEND });
    if (overlays.planningMovements) groups.push({ title: "まちづくりの動き", items: [["町丁目代表点", "#d7cde0"]] });
    if (overlays.buildingHeight) groups.push({ title: "建物高さ（m・2020年度）", items: BUILDING_HEIGHT_LEGEND });
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
    if (overlays.urbanPlanningRoads) add("都市計画道路", "6区をつなぐ計画線の骨格を見る。整備済・事業中・未着手の区別ではなく、最新の区域・幅員は公式図書で確認。", meta?.urbanPlanningRoadYear ?? "2020年度", "国土交通省PLATEAU", URBAN_PLANNING_ROAD_SOURCE);
    if (overlays.rail) add("鉄道・駅", "駅勢圏と乗換拠点を道路・土地利用に重ねて読む。", meta?.railDate ?? "2025年", "国土交通省", "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html");
    if (overlays.stationEntrances) add("駅出入口", "ズーム14以上で表示。出口・バリアフリー属性は駅の最新案内で再確認。", "2026-09-13取得", "OpenStreetMap（参考）", OSM_REFERENCE_SOURCE);
    if (overlays.undergroundWalkways) add("地下歩行ネットワーク", UNDERGROUND_WALKWAY_NOTE, "2026-09-13取得", "OpenStreetMap（参考）", OSM_REFERENCE_SOURCE);
    if (overlays.districtPlans) add("地区計画", "区域を入口に計画図へ。千代田区の内部区分はズーム14以上、区分名は16以上で表示。", `外枠：${meta?.districtPlanDate ?? "2025-05-02"}／内部：2026-09-13取得`, "外枠：東京都／内部：千代田区", DISTRICT_PLAN_SUBAREA_SOURCE);
    if (overlays.heightDistricts) add("高度地区", "千代田区・中央区は指定なし。隣接4区の種別と数値指定を用途地域と合わせて確認。", meta?.heightDistrictDate ?? "2025-03-31", "東京都", "https://catalog.data.metro.tokyo.lg.jp/dataset/t000008d0000000028");
    if (overlays.specialZones) add("容積・再開発等の特例", "制度の重なりを発見する層。実効値は個別図書で確認。", meta?.specialZoneDate ?? "2024–2025", "東京都", "https://catalog.data.metro.tokyo.lg.jp/dataset/t000008d0000000028");
    if (overlays.redevelopment) add("都市更新", "市街地再開発・大規模建替え・都市計画提案を区別。点の大きさは延べ面積の目安。Mはズーム14以上。位置・基準日は各点の詳細へ。", `区内：${meta?.urbanChangeDate ?? "2026-09-13"}取得／隣接区：2025-10-31時点`, "千代田区・東京都", "https://www.city.chiyoda.lg.jp/koho/machizukuri/kankyo/gaiyoichiran/index.html");
    if (overlays.chiyodaRegions) add("千代田区の7地域", "都市計画マスタープランが地域別に示す将来像の単位。", meta?.chiyodaRegionDate ?? "2021-05", "千代田区", "https://www.city.chiyoda.lg.jp/documents/17862/toshimasu-4_2.pdf");
    if (overlays.functionalKaiwai) add("街の個性", "古書店街・学生街など、都市機能から見る16界隈。景観の界隈・7地域とは別の区分。", "公式ページ2025-06-06", "千代田区", OFFICIAL_ELEMENT_SOURCE);
    if (overlays.openSpaces) add("公開空地", "公式GISに掲載された公開空地。自由な利用の可否・条件は現地等で確認。", "公式ページ2025-06-06", "千代田区", OFFICIAL_ELEMENT_SOURCE);
    if (overlays.areaManagement) add("まちづくり団体", "公式GISの団体活動区域。複数団体を含む区域もある。", "公式ページ2025-06-06", "千代田区", OFFICIAL_ELEMENT_SOURCE);
    if (overlays.planningMovements) add("まちづくりの動き", "検討・対話・ルール形成の段階を見る。位置は町丁目の代表点。各点から公式資料へ。", "基準日は各点に表示", "千代田区", PLANNING_MOVEMENT_SOURCE);
    if (overlays.memoryPlates) add("まちの記憶", "旧居跡などの記憶保存プレートの所在地。", "公式ページ2025-06-06", "千代田区", OFFICIAL_ELEMENT_SOURCE);
    if (overlays.culturalAssets) add("文化・歴史資源", "国・都・区文化財と景観資源を統合。既存景観物件の指定情報も保持。", "公式GIS・既存指定一覧", "千代田区", OFFICIAL_ELEMENT_SOURCE);
    if (overlays.terrain) add("地形・陰影", "陰影起伏から台地・谷・崖の連続性を見る。標高値は示さない。", "地理院タイル", "国土地理院", "https://maps.gsi.go.jp/development/ichiran.html");
    if (overlays.buildingHeight) add("建物高さ", "2020年度の市街地の高さ構造を学ぶ。最新建物情報ではなく、広域ズームでは小規模建物が省略される。", "2020年度", "PLATEAU / indigo-lab MVT", PLATEAU_BUILDING_SOURCE);
    if (overlays.parks) add("公園・緑地", "まとまりとネットワークを周辺区まで連続して見る。", meta?.parksDate ?? "公開時点", "東京都", "https://catalog.data.metro.tokyo.lg.jp/dataset/t000008d2000000024");
    if (overlays.landPrices) add("地価公示", "標準地の点比較。個別不動産の価格ではない。", meta?.landPriceDate ?? "2026-01-01", "国土交通省", "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-L01-2026.html");
    if (overlays.shelters) add("指定避難所", "概略位置を確認し、実際の避難時は各区の最新案内を見る。", meta?.sheltersDate ?? "取得時点", "国土地理院", "https://maps.gsi.go.jp/development/ichiran.html");
    if (overlays.boundaries) add("町丁目境界", "統計の集計単位を確認する補助線。", `${meta?.boundaryYear ?? 2020}年国勢調査`, "CODH", "https://geoshape.ex.nii.ac.jp/ka/resource/");
    const photo = PHOTO_OPTIONS.find((option) => option.value === photoEpoch);
    add("背景地図", photoEpoch === "pale" ? "淡色地図で都市計画・都市更新の重なりを読む。" : "年代ごとの市街地の変化を見る。古い写真は未整備箇所が空白になる。", photo?.label ?? "淡色地図", "国土地理院", "https://maps.gsi.go.jp/development/ichiran.html");
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
              <label className="section-title" htmlFor="photo-epoch">背景地図</label>
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
                <Toggle label="都市計画道路（2020）" active={overlays.urbanPlanningRoads} onClick={() => toggleOverlay("urbanPlanningRoads")} />
                <Toggle label="鉄道・駅" active={overlays.rail} onClick={() => toggleOverlay("rail")} />
                <Toggle label="駅出入口" active={overlays.stationEntrances} onClick={() => toggleOverlay("stationEntrances")} />
                <Toggle label="地下歩行ネットワーク" active={overlays.undergroundWalkways} onClick={() => toggleOverlay("undergroundWalkways")} />
                <Toggle label="公園・緑地" active={overlays.parks} onClick={() => toggleOverlay("parks")} />
                <Toggle label="地形・陰影" active={overlays.terrain} onClick={() => toggleOverlay("terrain")} />
                <Toggle label="建物高さ（2020）" active={overlays.buildingHeight} onClick={() => toggleOverlay("buildingHeight")} />
                <Toggle label="町丁目境界" active={overlays.boundaries} onClick={() => toggleOverlay("boundaries")} />
              </div>
            </section>

            <section>
              <h2 className="section-title">都市計画</h2>
              <div className="toggle-list">
                <Toggle label="地区計画" active={overlays.districtPlans} onClick={() => toggleOverlay("districtPlans")} />
                <Toggle label="高度地区" active={overlays.heightDistricts} onClick={() => toggleOverlay("heightDistricts")} />
                <Toggle label="容積・再開発等の特例" active={overlays.specialZones} onClick={() => toggleOverlay("specialZones")} />
              </div>
            </section>

            <section>
              <h2 className="section-title">変化・主体</h2>
              <div className="toggle-list">
                <Toggle label="都市更新" active={overlays.redevelopment} onClick={() => toggleOverlay("redevelopment")} />
                <Toggle label="まちづくりの動き" active={overlays.planningMovements} onClick={() => toggleOverlay("planningMovements")} />
                <Toggle label="公開空地" active={overlays.openSpaces} onClick={() => toggleOverlay("openSpaces")} />
                <Toggle label="まちづくり団体" active={overlays.areaManagement} onClick={() => toggleOverlay("areaManagement")} />
              </div>
            </section>

            <section>
              <h2 className="section-title">暮らし・景観</h2>
              <div className="toggle-list">
                <Toggle label="千代田区の7地域" active={overlays.chiyodaRegions} onClick={() => toggleOverlay("chiyodaRegions")} />
                <Toggle label="街の個性" active={overlays.functionalKaiwai} onClick={() => toggleOverlay("functionalKaiwai")} />
                <Toggle label="まちの記憶" active={overlays.memoryPlates} onClick={() => toggleOverlay("memoryPlates")} />
                <Toggle label="文化・歴史資源" active={overlays.culturalAssets} onClick={() => toggleOverlay("culturalAssets")} />
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
                      {group.title === "都市更新" && (
                        <p className="legend-note">
                          点の大きさ＝延べ面積の目安<br />
                          M 3千㎡〜 / L 1万㎡〜 / XL 5万㎡〜 / XXL 10万㎡〜<br />
                          隣接区は薄く表示
                        </p>
                      )}
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
