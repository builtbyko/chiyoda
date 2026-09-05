"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";

type AreaLayer = "population" | "zoning" | "none";
type Basemap = "pale" | "standard" | "photo";
type OverlayKey = "roads" | "rail" | "boundaries";

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
    boundaryYear: number;
    zoningYear: string;
    railDate: string;
    roadsDate: string;
  };
  city: GeoFeature;
  towns: GeoCollection;
  zoning: GeoCollection;
  roads: GeoCollection;
  rail: GeoCollection;
  stations: GeoCollection;
};

type SearchItem = {
  name: string;
  kind: "町丁目" | "駅";
  feature: GeoFeature;
};

type Detail = {
  eyebrow: string;
  title: string;
  rows: { label: string; value: string }[];
};

const BASEMAP_LAYER_IDS = ["base-pale", "base-standard", "base-photo"];
const ROAD_LAYER_IDS = ["roads-casing", "roads-line", "roads-hit"];
const RAIL_LAYER_IDS = ["rail-casing", "rail-line", "rail-hit", "stations", "station-core"];

const POPULATION_LEGEND = [
  ["0", "#f3eee4"],
  ["1–4,999", "#dbe5dc"],
  ["5,000–9,999", "#b3d0c3"],
  ["10,000–19,999", "#72aa99"],
  ["20,000–29,999", "#357d70"],
  ["30,000以上", "#155448"],
];

const ZONING_LEGEND = [
  ["第1種住居地域", "#e7ca72"],
  ["第2種住居地域", "#dc9568"],
  ["商業地域", "#bd5364"],
];

const ROAD_LEGEND = [
  ["首都高速", "#7d4c93"],
  ["国道", "#c64f35"],
  ["都道・幹線", "#d99036"],
  ["地区幹線", "#5f7873"],
];

const RAIL_LEGEND = [
  ["JR", "#2c6e67"],
  ["東京メトロ", "#3479a8"],
  ["都営地下鉄", "#8c5a9b"],
  ["その他", "#806d52"],
];

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

function detailFor(layerId: string, properties: Record<string, unknown>): Detail {
  const p = properties;
  if (layerId.includes("station")) {
    return {
      eyebrow: "Station",
      title: String(p.n ?? "駅"),
      rows: [
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
        { label: "容積率", value: `${NUMBER.format(Number(p.f ?? 0))}%` },
        { label: "建ぺい率", value: `${NUMBER.format(Number(p.b ?? 0))}%` },
      ],
    };
  }
  return {
    eyebrow: "Population",
    title: String(p.n ?? "町丁目"),
    rows: [
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
  const cityRef = useRef<GeoFeature | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [areaLayer, setAreaLayer] = useState<AreaLayer>("none");
  const [basemap, setBasemap] = useState<Basemap>("photo");
  const [overlays, setOverlays] = useState<Record<OverlayKey, boolean>>({
    roads: false,
    rail: false,
    boundaries: false,
  });
  const [detail, setDetail] = useState<Detail | null>(null);
  const [searchItems, setSearchItems] = useState<SearchItem[]>([]);
  const [query, setQuery] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);

  const filteredSearch = useMemo(() => {
    const value = query.trim().toLocaleLowerCase("ja");
    if (!value) return [];
    return searchItems
      .filter((item) => item.name.toLocaleLowerCase("ja").includes(value))
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
        cityRef.current = data.city;

        const map = new maplibregl.Map({
          container: mapElement.current,
          center: [139.754, 35.689],
          zoom: 12.8,
          minZoom: 10.8,
          maxZoom: 18.5,
          pitchWithRotate: false,
          dragRotate: false,
          attributionControl: false,
          style: {
            version: 8,
            sources: {
              pale: {
                type: "raster",
                tiles: ["https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png"],
                tileSize: 256,
                maxzoom: 18,
                attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">国土地理院</a>',
              },
              standard: {
                type: "raster",
                tiles: ["https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png"],
                tileSize: 256,
                maxzoom: 18,
                attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">国土地理院</a>',
              },
              photo: {
                type: "raster",
                tiles: ["https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg"],
                tileSize: 256,
                maxzoom: 18,
                attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">国土地理院</a>',
              },
            },
            layers: [
              { id: "base-pale", type: "raster", source: "pale", layout: { visibility: "none" } },
              { id: "base-standard", type: "raster", source: "standard", layout: { visibility: "none" } },
              { id: "base-photo", type: "raster", source: "photo" },
            ],
          },
        });

        mapRef.current = map;
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
        map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

        map.on("load", () => {
          map.addSource("towns", { type: "geojson", data: data.towns as never });
          map.addSource("zoning", { type: "geojson", data: data.zoning as never });
          map.addSource("roads", {
            type: "geojson",
            data: data.roads as never,
            attribution: '道路 © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a>',
          });
          map.addSource("rail", { type: "geojson", data: data.rail as never });
          map.addSource("stations", { type: "geojson", data: data.stations as never });
          map.addSource("city", { type: "geojson", data: data.city as never });
          map.addSource("selection", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });

          map.addLayer({
            id: "population-fill",
            type: "fill",
            source: "towns",
            paint: {
              "fill-color": [
                "interpolate", ["linear"], ["get", "d"],
                0, "#f3eee4", 1, "#dbe5dc", 5000, "#b3d0c3",
                10000, "#72aa99", 20000, "#357d70", 30000, "#155448",
              ],
              "fill-opacity": 0.78,
            },
          });
          map.addLayer({
            id: "zoning-fill",
            type: "fill",
            source: "zoning",
            layout: { visibility: "none" },
            paint: {
              "fill-color": [
                "match", ["get", "n"],
                "第１種住居地域", "#e7ca72",
                "第２種住居地域", "#dc9568",
                "商業地域", "#bd5364",
                "#bab3a8",
              ],
              "fill-opacity": 0.64,
              "fill-outline-color": "#846b55",
            },
          });
          map.addLayer({
            id: "town-boundaries",
            type: "line",
            source: "towns",
            paint: {
              "line-color": "#6b756f",
              "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.35, 16, 1.15],
              "line-opacity": 0.7,
            },
          });
          map.addLayer({
            id: "roads-casing",
            type: "line",
            source: "roads",
            paint: {
              "line-color": "#fffdf8",
              "line-width": [
                "interpolate", ["linear"], ["zoom"],
                11, ["match", ["get", "c"], "x", 3.6, "n", 3.3, "m", 2.6, 1.8],
                17, ["match", ["get", "c"], "x", 8.5, "n", 7.5, "m", 6, 4.3],
              ],
              "line-opacity": 0.9,
            },
          });
          map.addLayer({
            id: "roads-line",
            type: "line",
            source: "roads",
            paint: {
              "line-color": [
                "match", ["get", "c"],
                "x", "#7d4c93", "n", "#c64f35", "m", "#d99036", "#5f7873",
              ],
              "line-width": [
                "interpolate", ["linear"], ["zoom"],
                11, ["match", ["get", "c"], "x", 2.1, "n", 2, "m", 1.45, 1],
                17, ["match", ["get", "c"], "x", 6.5, "n", 5.5, "m", 4.2, 2.7],
              ],
              "line-opacity": 0.95,
            },
          });
          map.addLayer({
            id: "roads-hit",
            type: "line",
            source: "roads",
            paint: { "line-color": "#ffffff", "line-width": 14, "line-opacity": 0.01 },
          });
          map.addLayer({
            id: "rail-casing",
            type: "line",
            source: "rail",
            paint: {
              "line-color": "#fffdf8",
              "line-width": ["interpolate", ["linear"], ["zoom"], 11, 3.8, 17, 7.2],
              "line-opacity": 0.96,
            },
          });
          map.addLayer({
            id: "rail-line",
            type: "line",
            source: "rail",
            paint: {
              "line-color": [
                "match", ["get", "c"],
                "jr", "#2c6e67", "metro", "#3479a8", "toei", "#8c5a9b", "#806d52",
              ],
              "line-width": ["interpolate", ["linear"], ["zoom"], 11, 2.2, 17, 4.8],
              "line-opacity": 0.98,
            },
          });
          map.addLayer({
            id: "rail-hit",
            type: "line",
            source: "rail",
            paint: { "line-color": "#ffffff", "line-width": 15, "line-opacity": 0.01 },
          });
          map.addLayer({
            id: "stations",
            type: "circle",
            source: "stations",
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
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 1.5, 16, 2.6],
              "circle-color": "#c95535",
            },
          });
          map.addLayer({
            id: "city-outline",
            type: "line",
            source: "city",
            paint: {
              "line-color": "#17211f",
              "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.8, 17, 3.6],
              "line-opacity": 0.9,
            },
          });
          map.addLayer({
            id: "selection-fill",
            type: "fill",
            source: "selection",
            paint: { "fill-color": "#fff6a8", "fill-opacity": 0.32 },
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
              "circle-color": "#fff6a8",
              "circle-stroke-color": "#111916",
              "circle-stroke-width": 3,
            },
          });

          const allSearch: SearchItem[] = [
            ...data.towns.features.map((feature) => ({
              name: String(feature.properties.n), kind: "町丁目" as const, feature,
            })),
            ...data.stations.features.map((feature) => ({
              name: String(feature.properties.n), kind: "駅" as const, feature,
            })),
          ].sort((a, b) => a.name.localeCompare(b.name, "ja"));
          setSearchItems(allSearch);

          const clickable = [
            "station-core", "stations", "rail-hit", "roads-hit", "zoning-fill", "population-fill",
          ];
          map.on("mousemove", (event) => {
            const hit = map.queryRenderedFeatures(event.point, { layers: clickable }).length > 0;
            map.getCanvas().style.cursor = hit ? "pointer" : "";
          });
          map.on("click", (event) => {
            const feature = map.queryRenderedFeatures(event.point, { layers: clickable })[0];
            const source = map.getSource("selection") as maplibregl.GeoJSONSource;
            if (!feature) {
              setDetail(null);
              source.setData({ type: "FeatureCollection", features: [] });
              return;
            }
            setDetail(detailFor(feature.layer.id, feature.properties ?? {}));
            source.setData({
              type: "FeatureCollection",
              features: [{ type: "Feature", properties: {}, geometry: feature.geometry }],
            });
          });

          map.fitBounds(boundsFor(data.city), { padding: 42, duration: 0 });
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
  }, [areaLayer, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    BASEMAP_LAYER_IDS.forEach((id) => {
      map.setLayoutProperty(id, "visibility", id === `base-${basemap}` ? "visible" : "none");
    });
  }, [basemap, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setLayerVisibility(map, ROAD_LAYER_IDS, overlays.roads);
    setLayerVisibility(map, RAIL_LAYER_IDS, overlays.rail);
    setLayerVisibility(map, ["town-boundaries"], overlays.boundaries);
  }, [overlays, ready]);

  const changeArea = (value: AreaLayer) => {
    setAreaLayer(value);
  };

  const changeBasemap = (value: Basemap) => {
    setBasemap(value);
  };

  const toggleOverlay = (key: OverlayKey) => {
    setOverlays((current) => ({ ...current, [key]: !current[key] }));
  };

  const resetMap = () => {
    if (!mapRef.current || !cityRef.current) return;
    mapRef.current.fitBounds(boundsFor(cityRef.current), { padding: 42, duration: 600 });
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
    const source = map.getSource("selection") as { setData: (value: unknown) => void };
    source?.setData({ type: "FeatureCollection", features: [item.feature] });
  };

  const legendGroups = useMemo(() => {
    const groups: { title: string; items: string[][] }[] = [];
    if (areaLayer === "population") groups.push({ title: "人口密度（人/km²）", items: POPULATION_LEGEND });
    if (areaLayer === "zoning") groups.push({ title: "用途地域", items: ZONING_LEGEND });
    if (overlays.roads) groups.push({ title: "主要道路", items: ROAD_LEGEND });
    if (overlays.rail) groups.push({ title: "鉄道", items: RAIL_LEGEND });
    return groups;
  }, [areaLayer, overlays]);

  return (
    <div className="atlas-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-kicker">Chiyoda Base Atlas · 01</div>
          <h1>千代田区ベースアトラス</h1>
        </div>
        <div className="metrics" aria-label="千代田区の基礎指標">
          <Metric label="人口" value="69,771" unit="人" />
          <Metric label="面積" value="11.66" unit="km²" />
          <Metric label="町丁目" value="115" unit="地区" />
          <Metric label="駅" value="29" unit="駅" />
        </div>
      </header>

      <main className="workspace">
        <button
          className={`panel-scrim ${panelOpen ? "is-open" : ""}`}
          onClick={() => setPanelOpen(false)}
          aria-label="操作パネルを閉じる"
          tabIndex={panelOpen ? 0 : -1}
        />
        <aside className={`sidebar ${panelOpen ? "is-open" : ""}`} aria-label="地図の操作">
          <div className="sidebar-inner">
            <div className="sidebar-header">
              <div>
                <h2 className="section-title">Explore the city</h2>
                <p>何を見たいか選ぶと、必要な情報だけを地図に重ねられます。</p>
              </div>
              <button className="close-panel" onClick={() => setPanelOpen(false)} aria-label="閉じる">×</button>
            </div>

            <section className="search-wrap">
              <h2 className="section-title">町丁目・駅を探す</h2>
              <div className="search-field">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="例：神田、麴町、東京"
                  aria-label="町丁目・駅を検索"
                  autoComplete="off"
                />
              </div>
              {filteredSearch.length > 0 && (
                <div className="search-results">
                  {filteredSearch.map((item, index) => (
                    <button className="search-result" key={`${item.kind}-${item.name}-${index}`} onClick={() => selectSearchItem(item)}>
                      <span>{item.name}</span><small>{item.kind}</small>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h2 className="section-title">面の情報</h2>
              <div className="segment-control">
                {(["population", "zoning", "none"] as AreaLayer[]).map((value) => (
                  <button
                    key={value}
                    className={`segment-button ${areaLayer === value ? "active" : ""}`}
                    onClick={() => changeArea(value)}
                  >
                    {{ population: "人口密度", zoning: "用途地域", none: "表示なし" }[value]}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h2 className="section-title">重ねる情報</h2>
              <div className="toggle-list">
                <Toggle label="主要道路" active={overlays.roads} onClick={() => toggleOverlay("roads")} />
                <Toggle label="鉄道・駅" active={overlays.rail} onClick={() => toggleOverlay("rail")} />
                <Toggle label="町丁目境界" active={overlays.boundaries} onClick={() => toggleOverlay("boundaries")} />
              </div>
            </section>

            <section>
              <h2 className="section-title">背景地図</h2>
              <div className="segment-control">
                {(["pale", "standard", "photo"] as Basemap[]).map((value) => (
                  <button
                    key={value}
                    className={`segment-button ${basemap === value ? "active" : ""}`}
                    onClick={() => changeBasemap(value)}
                  >
                    {{ pale: "淡色", standard: "標準", photo: "空中写真" }[value]}
                  </button>
                ))}
              </div>
            </section>

            <div className="reading-note">
              <strong>この地図の読み方</strong>
              <p>人口は「住むまち」、用途地域は「建て方のルール」、道路と鉄道は「都市の骨格」。一枚ずつ見たあと重ねると、地域ごとの役割が見えてきます。</p>
            </div>

            <div className="source-line">
              人口：千代田区（2026-08-01）／境界：2020年国勢調査／用途地域・鉄道：国土交通省／道路：© OpenStreetMap contributors／背景：
              <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">国土地理院</a>
            </div>
          </div>
        </aside>

        <section className="map-stage" aria-label="千代田区の地図">
          <div ref={mapElement} className="map-canvas" />
          {!ready && (
            <div className={`map-loading ${error ? "map-error" : ""}`} role="status">
              <div className="loading-inner">{error || "MAP DATA LOADING"}</div>
            </div>
          )}
          <button className="mobile-controls" onClick={() => setPanelOpen(true)}>☰ 地図を選ぶ</button>
          <div className="map-top-actions">
            <button className="map-action" onClick={resetMap}>区全体へ戻る</button>
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

          <aside className="detail-card" aria-live="polite">
            {detail ? (
              <>
                <div className="detail-eyebrow">{detail.eyebrow}</div>
                <h2 className="detail-title">{detail.title}</h2>
                <dl className="detail-grid">
                  {detail.rows.map((row) => (
                    <div className="detail-item" key={row.label}>
                      <dt>{row.label}</dt><dd>{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </>
            ) : (
              <>
                <div className="detail-eyebrow">Inspector</div>
                <h2 className="detail-title">地図を選択</h2>
                <p className="detail-empty">町丁目、道路、路線、駅をクリックすると、ここに詳しい情報が表示されます。</p>
              </>
            )}
          </aside>
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
