import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Chiyoda and adjacent wards atlas shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(
    html,
    /<title>CHiYODA ATLAS \| 千代田まちづくり基礎アトラス<\/title>/i,
  );
  assert.match(html, /CHiYODA ATLAS/);
  assert.match(html, /住民密度/);
  assert.match(html, /昼間人口/);
  assert.match(html, /実土地利用/);
  assert.match(html, /用途地域/);
  assert.match(html, /防火指定/);
  assert.match(html, /洪水浸水/);
  assert.match(html, /公園・緑地/);
  assert.match(html, /地価公示/);
  assert.match(html, /指定避難所/);
  assert.match(html, /町丁目境界/);
  assert.match(
    html,
    /<button(?=[^>]*aria-pressed="false")[^>]*><span>都市計画道路（2020）<\/span>/,
  );
  assert.match(html, /地区計画/);
  assert.match(html, /高度地区/);
  assert.match(html, /容積・再開発等の特例/);
  assert.match(html, /事業中の再開発/);
  assert.match(html, /千代田区の7地域/);
  for (const label of ["街の個性", "公開空地", "まちづくり団体", "まちの記憶", "文化・歴史資源", "地形・陰影", "建物高さ（2020）"]) {
    assert.match(html, new RegExp(`<button(?=[^>]*aria-pressed="false")[^>]*><span>${label}</span>`));
  }
  assert.doesNotMatch(html, /<span>景観まちづくり重要物件<\/span>/);
  assert.match(html, /現在地/);
  assert.match(html, /1936–1942年頃/);
  assert.match(
    html,
    /<button(?=[^>]*class="[^"]*atlas-info-toggle)(?=[^>]*aria-expanded="false")[^>]*>/,
  );
  assert.doesNotMatch(html, /id="atlas-info-panel"/);
  assert.doesNotMatch(html, /背景地図/);
});

test("map data includes the recommended reference layers", async () => {
  const coreText = await readFile(
    new URL("../public/data/map-data.json", import.meta.url),
    "utf8",
  );
  const mapData = JSON.parse(coreText);
  const layerFiles = {
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
    districtPlans: "district-plans.json",
    heightDistricts: "height-districts.json",
    specialZones: "special-zones.json",
    redevelopment: "redevelopment.json",
    chiyodaRegions: "chiyoda-regions.json",
    landscapeProperties: "landscape-properties.json",
    functionalKaiwai: "functional-kaiwai.json",
    openSpaces: "open-spaces.json",
    areaManagement: "area-management.json",
    memoryPlates: "memory-plates.json",
    culturalAssets: "cultural-assets.json",
  };
  const layers = Object.fromEntries(
    await Promise.all(
      Object.entries(layerFiles).map(async ([key, filename]) => [
        key,
        JSON.parse(
          await readFile(new URL(`../public/data/layers/${filename}`, import.meta.url), "utf8"),
        ),
      ]),
    ),
  );

  for (const [key, layer] of Object.entries(layers)) {
    assert.equal(layer.type, "FeatureCollection");
    assert.ok(layer.features.length > 0, `${key} should not be empty`);
    assert.equal(mapData[key], undefined, `${key} should be lazy-loaded`);
  }

  assert.ok(Buffer.byteLength(coreText) < 250_000, "initial map data should stay compact");
  assert.ok(Array.isArray(mapData.searchTypes));
  assert.ok(Array.isArray(mapData.search));
  assert.ok(mapData.search.length > 0);
  for (const [name, ward, typeIndex, featureIndex] of mapData.search) {
    const searchType = mapData.searchTypes[typeIndex];
    const target = layers[searchType.d]?.features[featureIndex];
    assert.ok(target, `${name} search target should resolve`);
    assert.equal(target.properties.n, name);
    assert.equal(String(target.properties.w ?? (searchType.d.startsWith("chiyoda") || searchType.d === "culturalAssets" ? "千代田区" : "")), ward);
    assert.equal(typeof searchType.k, "string");
    assert.equal(typeof searchType.l, "string");
  }

  assert.equal(mapData.meta.parkCount, layers.parks.features.length);
  assert.equal(mapData.meta.stationCount, layers.stations.features.length);
  assert.equal(mapData.meta.landPriceCount, layers.landPrices.features.length);
  assert.equal(mapData.meta.shelterCount, layers.shelters.features.length);
  assert.equal(mapData.meta.districtPlanCount, layers.districtPlans.features.length);
  assert.equal(mapData.meta.heightDistrictCount, layers.heightDistricts.features.length);
  assert.equal(mapData.meta.specialZoneCount, layers.specialZones.features.length);
  assert.equal(mapData.meta.redevelopmentCount, layers.redevelopment.features.length);
  assert.equal(mapData.meta.chiyodaRegionCount, layers.chiyodaRegions.features.length);
  assert.equal(
    mapData.meta.landscapePropertyCount,
    layers.landscapeProperties.features.length,
  );
  assert.equal(mapData.meta.chiyodaRegionDate, "2021-05");
  assert.equal(mapData.meta.urbanPlanningRoadYear, "2020年度");
  assert.equal(mapData.meta.urbanPlanningRoadCount, layers.urbanPlanningRoads.features.length);
  assert.equal(mapData.meta.landscapePropertyDate, "2024-12");
  assert.equal(mapData.meta.chiyodaDaytimePopulation, 903780);
  assert.ok(mapData.meta.chiyodaArea > 11.5);
  assert.ok(
    layers.towns.features.every(({ properties }) =>
      Number.isFinite(properties.dd) && typeof properties.lu === "string",
    ),
  );
  assert.ok(
    layers.redevelopment.features.every(({ geometry, properties }) =>
      geometry.type === "Point" && properties.l === "町丁目代表点",
    ),
  );
  assert.ok(
    layers.flood.features.every(({ properties }) =>
      Number.isInteger(properties.c) && properties.c >= 1 && properties.c <= 6,
    ),
  );
  assert.ok(
    layers.heightDistricts.features.every(({ properties }) =>
      !["千代田区", "中央区"].includes(properties.w),
    ),
  );

  const expectedRegions = [
    "麹町・番町地域",
    "飯田橋・富士見地域",
    "神保町地域",
    "神田公園地域",
    "万世橋地域",
    "和泉橋地域",
    "大手町・丸の内・有楽町・永田町地域",
  ];
  assert.equal(layers.chiyodaRegions.features.length, 7);
  assert.deepEqual(
    layers.chiyodaRegions.features.map(({ properties }) => properties.n).sort(),
    expectedRegions.sort(),
  );
  assert.ok(
    layers.chiyodaRegions.features.every(({ geometry, properties }) =>
      ["Polygon", "MultiPolygon"].includes(geometry.type) &&
      Number.isInteger(properties.i) &&
      typeof properties.s === "string" &&
      properties.s.length > 0 &&
      Number.isFinite(properties.x) &&
      Number.isFinite(properties.y) &&
      properties.u ===
        "https://www.city.chiyoda.lg.jp/documents/17862/toshimasu-4_2.pdf",
    ),
  );

  const landscapeProperties = layers.landscapeProperties.features;
  assert.equal(landscapeProperties.length, 64);
  const landscapeTypeCounts = Object.groupBy(
    landscapeProperties,
    ({ properties }) => properties.t,
  );
  assert.equal(landscapeTypeCounts["建築物等"]?.length, 45);
  assert.equal(landscapeTypeCounts["橋梁"]?.length, 19);
  assert.deepEqual(Object.keys(landscapeTypeCounts).sort(), ["建築物等", "橋梁"].sort());
  assert.ok(
    landscapeProperties.every(({ geometry, properties }) =>
      geometry.type === "Point" &&
      geometry.coordinates.length === 2 &&
      geometry.coordinates.every(Number.isFinite) &&
      typeof properties.i === "string" &&
      properties.i.length > 0 &&
      typeof properties.n === "string" &&
      properties.n.length > 0 &&
      ["建築物等", "橋梁"].includes(properties.t) &&
      typeof properties.a === "string" &&
      properties.a.length > 0 &&
      typeof properties.d === "string" &&
      properties.d.length > 0 &&
      /^https:\/\/www\.city\.chiyoda\.lg\.jp\//.test(properties.u) &&
      ["chiyoda-official-gis", "gsi-address-search"].includes(properties.c) &&
      ["official-point", "block"].includes(properties.p),
    ),
  );
  const coordinateSourceCounts = Object.groupBy(
    landscapeProperties,
    ({ properties }) => properties.c,
  );
  assert.equal(coordinateSourceCounts["chiyoda-official-gis"]?.length, 56);
  assert.equal(coordinateSourceCounts["gsi-address-search"]?.length, 8);
});

test("urban planning road linework stays lightweight and covers all six wards", async () => {
  const text = await readFile(
    new URL("../public/data/layers/urban-planning-roads.json", import.meta.url),
    "utf8",
  );
  const { features } = JSON.parse(text);
  assert.ok(Buffer.byteLength(text) < 450_000, "road linework should remain compact");
  assert.deepEqual(
    [...new Set(features.map(({ properties }) => properties.w))].sort(),
    ["千代田区", "中央区", "港区", "新宿区", "文京区", "台東区"].sort(),
  );
  const classes = {
    "都計線（一般道）": "general",
    "高速道路": "highway",
    "立体（計画）": "highway",
    "交通広場": "plaza",
    "駅付近広場": "plaza",
  };
  for (const { geometry, properties } of features) {
    assert.equal(properties.n, "都市計画道路");
    assert.ok(Object.hasOwn(classes, properties.t));
    assert.equal(classes[properties.t], properties.c);
    assert.ok(["LineString", "MultiLineString"].includes(geometry.type));
    const lines = geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
    assert.ok(lines.length > 0);
    for (const line of lines) {
      assert.ok(line.length >= 2);
      assert.ok(line.every((point) => point.length === 2 && point.every(Number.isFinite)));
      assert.ok(line.some(([x, y]) => x !== line[0][0] || y !== line[0][1]));
      assert.ok(line.every(([x, y]) => x >= 139.6732 && x <= 139.8098 && y >= 35.6229 && y <= 35.736));
    }
  }
});

test("desktop map keeps its low-cost rendering settings", async () => {
  const source = await readFile(
    new URL("../app/MapAtlas.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /pixelBudget = moving \? 1_200_000 : 4_000_000/);
  assert.match(source, /minimumRatio = moving \? 0\.5 : 1/);
  assert.match(source, /maximumRatio = moving \? 0\.65 : 1\.25/);
  assert.match(source, /if \(window\.innerWidth <= 760\) return Math\.min\(deviceRatio, 1\.5\)/);
  assert.match(source, /getWorkerCount\(\) < 2/);
  assert.match(source, /setWorkerCount\(2\)/);
  assert.match(source, /maxTileCacheZoomLevels: isMobileViewport \? 1 : 2/);
  assert.match(source, /map\.scrollZoom\.disable\(\)/);
  assert.match(source, /currentZoom \+ \(delta > 0 \? -0\.5 : 0\.5\)/);
  assert.match(
    source,
    /addEventListener\("wheel", handleDiscreteWheel, \{ passive: false \}\)/,
  );
  assert.doesNotMatch(source, /sources: Object\.fromEntries\(PHOTO_OPTIONS/);
  assert.doesNotMatch(source, /id: `base-photo-\$\{option\.value\}`/);
  assert.match(source, /if \(!map\.getSource\(sourceId\) \|\| !map\.getLayer\("base-photo"\)\)/);
  assert.match(source, /\{ buffer: 64, tolerance: 1\.25 \}/);
  assert.equal(source.match(/\.\.\.geoJsonOptions/g)?.length, 19);
  assert.equal(
    source.match(/"(?:fill|line|circle)-opacity": 0(?:,|\s*})/g)?.length,
    11,
  );
  assert.doesNotMatch(source, /"(?:fill|line|circle)-opacity": 0\.01/);
  assert.match(source, /urbanPlanningRoads: false/);
  assert.match(source, /urbanPlanningRoads: \["urbanPlanningRoads"\]/);
  assert.match(source, /urbanPlanningRoads: \["urban-planning-roads-hit"\]/);
  assert.match(source, /map\.addSource\("urban-planning-roads", \{\s*type: "geojson",\s*data: EMPTY_COLLECTION/);
  for (const id of ["casing", "line", "hit"]) {
    assert.match(source, new RegExp(`id: "urban-planning-roads-${id}",[^}]*visibility: "none"`));
  }
});

test("prepared official layers retain names, provenance and unique identities", async () => {
  const files = ["functional-kaiwai", "open-spaces", "area-management", "memory-plates", "cultural-assets"];
  for (const file of files) {
    const text = await readFile(new URL(`../public/data/layers/${file}.json`, import.meta.url), "utf8");
    const { features } = JSON.parse(text);
    assert.ok(Buffer.byteLength(text) < 250_000, `${file} stays lightweight`);
    assert.equal(new Set(features.map(({ properties }) => properties.i)).size, features.length);
    for (const { geometry, properties: p } of features) {
      assert.ok(["Point", "Polygon", "MultiPolygon"].includes(geometry.type));
      assert.ok(typeof p.n === "string" && p.n.length > 0);
      assert.match(p._source_url, /^https:\/\/www\.city\.chiyoda\.lg\.jp\//);
      assert.ok(["official_gis", "official_address_representative_point"].includes(p._data_quality));
      if (p._data_quality === "official_address_representative_point") assert.equal(p._coordinate_quality, "block");
      if (p["件名"] && p._category !== "景観資源") assert.equal(p.n, p["件名"]);
    }
    if (file === "functional-kaiwai") {
      assert.equal(new Set(features.map(({ properties }) => properties._source_id)).size, 16);
      assert.ok(features.every(({ properties }) => properties.n === properties["界隈名"]));
    }
    if (file === "cultural-assets") {
      const categories = Object.groupBy(features, ({ properties }) => properties._category);
      assert.deepEqual(Object.keys(categories).sort(), ["国文化財", "東京都文化財", "千代田区文化財", "景観資源"].sort());
      const previous = JSON.parse(await readFile(new URL("../public/data/layers/landscape-properties.json", import.meta.url), "utf8"));
      for (const { properties: old } of previous.features) {
        const matches = features.filter(({ properties }) => properties.i === `landscape:${old.i}`);
        assert.equal(matches.length, 1, `${old.n} is integrated exactly once`);
        assert.equal(matches[0].properties.n, old.n);
        assert.equal(matches[0].properties.d, old.d);
        assert.equal(matches[0].properties._source_url, old.u);
      }
      assert.ok(features.some(({ properties }) => properties.t.includes("景観重要建造物")));
      const core = JSON.parse(await readFile(new URL("../public/data/map-data.json", import.meta.url), "utf8"));
      assert.equal(core.searchTypes.filter(({ d }) => d === "culturalAssets").length, 1);
      assert.equal(core.searchTypes.filter(({ d }) => d === "landscapeProperties").length, 0);
    }
  }
});

function sourceFunction(source, name, nextName, bindings = {}) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start);
  assert.ok(start >= 0 && end > start);
  const { outputText } = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
  return new Function(...Object.keys(bindings), `${outputText}; return ${name};`)(...Object.values(bindings));
}

test("remote tile overlays are created once with valid 2D styles and stable background order", async () => {
  const source = await readFile(new URL("../app/MapAtlas.tsx", import.meta.url), "utf8");
  const addTileOverlay = sourceFunction(source, "addTileOverlay", "mapPixelRatioForViewport", {
    PLATEAU_BUILDING_SOURCE: "https://github.com/indigo-lab/plateau-tokyo23ku-building-mvt-2020",
  });
  for (const keys of [["terrain", "buildingHeight"], ["buildingHeight", "terrain"]]) {
    const sources = {
      photo: { type: "raster", tiles: ["https://example.com/{z}/{x}/{y}.png"], tileSize: 256 },
      towns: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    };
    const layers = [{ id: "base-photo", type: "raster", source: "photo" }, { id: "population-fill", type: "fill", source: "towns" }];
    const map = {
      getSource: (id) => sources[id],
      getLayer: (id) => layers.find((layer) => layer.id === id),
      addSource(id, value) { assert.equal(sources[id], undefined); sources[id] = value; },
      addLayer(layer, beforeId) {
        assert.equal(this.getLayer(layer.id), undefined);
        const index = layers.findIndex(({ id }) => id === beforeId);
        assert.ok(index >= 0);
        layers.splice(index, 0, layer);
      },
    };
    assert.equal(map.getSource("terrain-hillshade"), undefined);
    for (const key of [...keys, ...keys]) addTileOverlay(map, key);
    assert.deepEqual(layers.map(({ id }) => id), ["base-photo", "terrain-hillshade", "plateau-building-height-fill", "population-fill"]);
    const terrain = map.getSource("terrain-hillshade");
    assert.equal(terrain.type, "raster");
    assert.deepEqual(terrain.tiles, ["https://cyberjapandata.gsi.go.jp/xyz/hillshademap/{z}/{x}/{y}.png"]);
    const buildings = map.getSource("plateau-buildings");
    assert.equal(buildings.type, "vector");
    assert.deepEqual(buildings.tiles, ["https://indigo-lab.github.io/plateau-tokyo23ku-building-mvt-2020/{z}/{x}/{y}.pbf"]);
    const fill = map.getLayer("plateau-building-height-fill");
    assert.equal(fill.type, "fill");
    assert.equal(fill["source-layer"], "bldg");
    assert.match(JSON.stringify(fill.paint), /measuredHeight/);
    assert.equal(fill.layout.visibility, "none");
    assert.equal(map.getLayer("terrain-hillshade").layout.visibility, "none");
    assert.deepEqual(validateStyleMin({ version: 8, sources, layers }), []);
  }
  assert.match(source, /terrain: \[\]/);
  assert.match(source, /buildingHeight: \[\]/);
  assert.match(source, /terrain: false/);
  assert.match(source, /buildingHeight: false/);
  assert.match(source, /map\.getLayer\("terrain-hillshade"\) \? "terrain-hillshade" : map\.getLayer\("plateau-building-height-fill"\)/);
});

test("new details omit missing attributes and distinguish historical building heights", async () => {
  const source = await readFile(new URL("../app/MapAtlas.tsx", import.meta.url), "utf8");
  const detailFor = sourceFunction(source, "detailFor", "culturalGroupDetail", {
    textValue: (value) => value == null || value === "" ? "—" : String(value),
    OFFICIAL_ELEMENT_SOURCE: "https://www.city.chiyoda.lg.jp/koho/machizukuri/toshi/walkable/yoso-bumpujokyo.html",
    PLATEAU_BUILDING_SOURCE: "https://github.com/indigo-lab/plateau-tokyo23ku-building-mvt-2020",
  });
  const memory = detailFor("memory-plates-hit", { n: "旧居跡" });
  assert.equal(memory.title, "旧居跡");
  assert.deepEqual(memory.rows, []);
  const culture = detailFor("cultural-assets-points", { n: "物件", _category: "景観資源", _coordinate_quality: "block" });
  assert.deepEqual(culture.rows, [{ label: "区分", value: "景観資源" }]);
  assert.match(culture.note, /代表点/);
  const building = detailFor("plateau-building-height-fill", { measuredHeight: 25.3 });
  assert.equal(building.title, "建物高さ 25.3 m");
  assert.match(building.note, /2020年度/);
  assert.match(building.note, /最新.*ではありません/);
  assert.equal(detailFor("plateau-building-height-fill", {}).title, "建物高さ不明");
});

test("desktop map restores readable resolution without increasing motion pixel cost", async () => {
  const source = await readFile(new URL("../app/MapAtlas.tsx", import.meta.url), "utf8");
  const viewport = { innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1 };
  const ratioFor = sourceFunction(source, "mapPixelRatioForViewport", "configureMapResolution", { window: viewport });
  const container = { clientWidth: 1634, clientHeight: 1022 };
  assert.equal(ratioFor(container), 1);
  assert.equal(ratioFor(container, true), 0.65);
  viewport.devicePixelRatio = 2;
  assert.equal(ratioFor(container), 1.25);
  assert.equal(ratioFor(container, true), 0.65);
  const large = { clientWidth: 3840, clientHeight: 2160 };
  assert.equal(ratioFor(large), 1);
  assert.equal(ratioFor(large, true), 0.5);
  viewport.innerWidth = 390;
  assert.equal(ratioFor(container), 1.5);
  assert.equal(ratioFor(container, true), 1.5);
});

test("resolution switches before input, debounces recovery and never interrupts active movement", async () => {
  const source = await readFile(new URL("../app/MapAtlas.tsx", import.meta.url), "utf8");
  const timers = new Map();
  const events = new Map();
  const inputs = new Map();
  let nextTimer = 0;
  const viewport = {
    innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1,
    setTimeout(fn) { timers.set(++nextTimer, fn); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(type, fn) { events.set(type, fn); },
    removeEventListener(type, fn) { assert.equal(events.get(type), fn); events.delete(type); },
  };
  const ratioFor = sourceFunction(source, "mapPixelRatioForViewport", "configureMapResolution", { window: viewport });
  const configure = sourceFunction(source, "configureMapResolution", "boundsFor", { window: viewport, mapPixelRatioForViewport: ratioFor });
  const callbacks = new Map();
  const ratios = [];
  let ratio = 1;
  let moving = false;
  const target = {
    addEventListener(type, fn, options) { assert.equal(options.capture, true); inputs.set(type, fn); },
    removeEventListener(type, fn, capture) { assert.equal(capture, true); assert.equal(inputs.get(type), fn); inputs.delete(type); },
  };
  const map = {
    on(type, fn) { callbacks.set(type, fn); },
    off(type, fn) { assert.equal(callbacks.get(type), fn); callbacks.delete(type); },
    isMoving: () => moving,
    getCanvasContainer: () => target,
    getPixelRatio: () => ratio,
    setPixelRatio(value) {
      assert.equal(moving, false, "active dragging must not be interrupted by resize");
      ratio = value;
      ratios.push(value);
      assert.ok(ratios.length < 10, "synthetic resize movement must not loop");
      callbacks.get("movestart")();
      callbacks.get("moveend")();
    },
  };
  const flush = () => { const pending = [...timers.values()]; timers.clear(); pending.forEach((fn) => fn()); };
  const dispose = configure(map, () => ({ clientWidth: 1634, clientHeight: 1022 }));
  inputs.get("wheel")({ type: "wheel" });
  assert.equal(ratio, 0.65);
  moving = true;
  callbacks.get("movestart")();
  assert.equal(timers.size, 0);
  inputs.get("wheel")({ type: "wheel" });
  events.get("resize")();
  flush();
  assert.deepEqual(ratios, [0.65]);
  moving = false;
  callbacks.get("moveend")();
  inputs.get("mousedown")({ type: "mousedown" });
  assert.equal(timers.size, 0, "held input cancels pending sharp redraw");
  events.get("resize")();
  flush();
  assert.equal(ratio, 0.65, "holding before dragging must retain low-cost resolution");
  events.get("mouseup")();
  assert.equal(timers.size, 1);
  flush();
  assert.deepEqual(ratios, [0.65, 1]);
  inputs.get("touchstart")({ type: "touchstart" });
  dispose();
  assert.equal(timers.size, 0);
  assert.equal(inputs.size, 0);
  assert.equal(callbacks.size, 0);
  assert.equal(events.size, 0);
});

test("regular map controls and labels no longer use tiny text", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.toggle-row \{[^}]*font-size: 0\.875rem;/);
  assert.match(css, /\.photo-select \{[^}]*font-size: 0\.875rem;/);
  assert.match(css, /\.ward-map-label \{[^}]*font-size: 0\.75rem;/);
  assert.doesNotMatch(css, /\.ward-map-label \{[^}]*font-size: 8px;/);
});
