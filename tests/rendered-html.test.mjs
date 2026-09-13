import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { validateStyleMin, expression } from "@maplibre/maplibre-gl-style-spec";

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
  assert.match(html, /<button(?=[^>]*aria-pressed="false")[^>]*><span>都市更新<\/span>/);
  assert.doesNotMatch(html, /<span>事業中の再開発<\/span>/);
  assert.match(html, /千代田区の7地域/);
  for (const label of ["街の個性", "公開空地", "まちづくり団体", "まちの記憶", "文化・歴史資源", "地形・陰影", "建物高さ（2020）", "駅出入口", "地下歩行ネットワーク", "まちづくりの動き"]) {
    assert.match(html, new RegExp(`<button(?=[^>]*aria-pressed="false")[^>]*><span>${label}</span>`));
  }
  assert.doesNotMatch(html, /<span>景観まちづくり重要物件<\/span>/);
  assert.doesNotMatch(html, /<span>景観の界隈<\/span>/);
  assert.doesNotMatch(html, /<span>地区計画内部区分<\/span>/);
  assert.match(html, /現在地/);
  assert.match(html, /1936–1942年頃/);
  assert.match(
    html,
    /<button(?=[^>]*class="[^"]*atlas-info-toggle)(?=[^>]*aria-expanded="false")[^>]*>/,
  );
  assert.doesNotMatch(html, /id="atlas-info-panel"/);
  assert.match(html, /背景地図/);
  assert.match(html, /value="pale"[^>]*selected/);
  assert.match(html, /最新航空写真/);
  assert.match(html, /都市計画<\/h2>/);
  assert.match(html, /変化・主体<\/h2>/);
  assert.doesNotMatch(html, /計画・変化<\/h2>/);
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
    stationEntrances: "station-entrances.json",
    undergroundWalkways: "underground-walkways.json",
    districtPlans: "district-plans.json",
    districtPlanSubareas: "district-plan-subareas.json",
    planningMovements: "planning-movements.json",
    heightDistricts: "height-districts.json",
    specialZones: "special-zones.json",
    redevelopment: "urban-change-projects.json",
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
      geometry.type === "Point" && ["町丁目代表点", "town_centroid", "gsi_geocode"].includes(properties.locationQuality),
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
  assert.equal(source.match(/\.\.\.geoJsonOptions/g)?.length, 23);
  assert.equal(
    source.match(/"(?:fill|line|circle)-opacity": 0(?:,|\s*})/g)?.length,
    15,
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

test("urban change preserves three categories, official sources and adjacent reference projects", async () => {
  const text = await readFile(new URL("../public/data/layers/urban-change-projects.json", import.meta.url), "utf8");
  const { features } = JSON.parse(text);
  const report = JSON.parse(await readFile(new URL("../scripts/data/urban-change-build-report.json", import.meta.url), "utf8"));
  const groups = Object.groupBy(features, ({ properties }) => properties.category);
  assert.deepEqual(Object.keys(groups).sort(), ["large_building", "legal_redevelopment", "planning_proposal"]);
  assert.equal(groups.legal_redevelopment.length, report.currentRedevelopmentCount + report.adjacentRedevelopmentCount);
  assert.equal(groups.large_building.length, report.largeBuildingCount);
  assert.equal(groups.planning_proposal.length, report.planningProposalCount);
  assert.ok(Buffer.byteLength(text) < 150_000);
  assert.equal(new Set(features.map(({ properties }) => properties.i)).size, features.length);
  for (const { properties: p, geometry } of features) {
    assert.equal(geometry.type, "Point");
    assert.equal(geometry.coordinates.length, 2);
    assert.ok(geometry.coordinates.every(Number.isFinite));
    assert.ok(p.n && p.w && p.sourceDate && p.locationQuality);
    assert.match(p.sourceUrl, /^https:\/\/(?:www\.city\.chiyoda\.lg\.jp|www\.toshiseibi\.metro\.tokyo\.lg\.jp)\//);
    assert.ok(!Object.values(p).includes("nan"));
    if (p.category === "large_building") {
      assert.ok(p.grossFloorArea >= 3000);
      assert.notEqual(p.status, "完了");
      assert.ok(!p.n.includes("市街地再開発事業"));
      assert.equal(p.scale, p.grossFloorArea >= 100000 ? "XXL" : p.grossFloorArea >= 50000 ? "XL" : p.grossFloorArea >= 10000 ? "L" : "M");
    }
  }
  const old = JSON.parse(await readFile(new URL("../public/data/layers/redevelopment.json", import.meta.url), "utf8"));
  for (const item of old.features.filter(({ properties }) => !properties.w.includes("千代田区"))) {
    const matches = features.filter(({ properties }) => properties.n === item.properties.n && properties.w === item.properties.w);
    assert.equal(matches.length, 1);
    assert.deepEqual(matches[0].geometry, item.geometry);
    assert.equal(matches[0].properties.sourceDate, "2025-10-31");
  }
  const source = await readFile(new URL("../app/MapAtlas.tsx", import.meta.url), "utf8");
  assert.match(source, /redevelopment: "urban-change-projects\.json"/);
  assert.match(source, /redevelopment: false/);
  assert.match(source, /redevelopment: \["redevelopment"\]/);
  assert.match(source, /fetch\("data\/map-data\.json", \{ cache: "no-cache" \}\)/);
  const tree = ts.createSourceFile("MapAtlas.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let optionsSource;
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === "createLazyGeoJsonLoader") optionsSource = node.arguments[0].getText(tree);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(optionsSource);
  const js = ts.transpileModule(`const options = ${optionsSource};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const calls = [];
  const options = new Function("DATASET_FILES", "DATASET_LABELS", "fetch", `${js}; return options;`)({}, {}, (...args) => { calls.push(args); });
  assert.deepEqual(calls, []);
  options.fetcher("data/layers/urban-change-projects.json");
  options.fetcher("data/layers/roads.json");
  assert.deepEqual(calls, [["data/layers/urban-change-projects.json", { cache: "no-cache" }], ["data/layers/roads.json", undefined]]);
});

test("urban change popups distinguish project categories and omit unknown completion dates", async () => {
  const source = await readFile(new URL("../app/MapAtlas.tsx", import.meta.url), "utf8");
  const numberValue = sourceFunction(source, "numberValue", "percentValue", { NUMBER: new Intl.NumberFormat("ja-JP") });
  const detailFor = sourceFunction(source, "detailFor", "culturalGroupDetail", { numberValue });
  const p = { n: "建替え計画", categoryLabel: "大規模建替え・新築", status: "計画", grossFloorArea: 15000, uses: "事務所", sourceDate: "2026-09-08", locationQuality: "gsi_geocode", sourceName: "千代田区公式一覧", sourceUrl: "https://www.city.chiyoda.lg.jp/example.html" };
  const detail = detailFor("redevelopment-hit-m", p);
  assert.equal(detail.eyebrow, "Urban change");
  assert.ok(detail.rows.some(({ label, value }) => label === "区分" && value === p.categoryLabel));
  assert.ok(detail.rows.some(({ label, value }) => label === "延べ面積" && value.includes("15,000")));
  assert.ok(!detail.rows.some(({ label }) => label === "竣工予定"));
  assert.match(detail.note, /住所検索による参考位置/);
  assert.match(detail.note, /敷地境界・事業区域を示しません/);
  assert.equal(detail.sources[0].url, p.sourceUrl);
  const proposal = detailFor("redevelopment-hit", { ...p, categoryLabel: "構想・都市計画提案", locationQuality: "town_centroid", proposalUrl: "https://www.toshiseibi.metro.tokyo.lg.jp/documents/example" });
  assert.match(proposal.note, /町丁目の代表点/);
  assert.equal(proposal.sources[1].url, "https://www.toshiseibi.metro.tokyo.lg.jp/documents/example");
});

test("urban change styles use three disjoint zoom tiers and quiet height-independent symbols", async () => {
  const source = await readFile(new URL("../app/MapAtlas.tsx", import.meta.url), "utf8");
  const start = source.indexOf("const URBAN_CHANGE_TIERS =");
  const end = source.indexOf("const CHIYODA_REGION_LAYER_IDS", start);
  assert.ok(start >= 0 && end > start);
  const constants = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const bindings = new Function(`${constants}; return { URBAN_CHANGE_TIERS, URBAN_CHANGE_IS_CHIYODA, URBAN_CHANGE_RADIUS, URBAN_CHANGE_COLOR, REDEVELOPMENT_LAYER_IDS };`)();
  const tree = ts.createSourceFile("MapAtlas.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let loop;
  const visit = (node) => {
    if (ts.isForOfStatement(node) && node.expression.getText(tree) === "URBAN_CHANGE_TIERS") loop = node.getText(tree);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(loop);
  const layers = [];
  const js = ts.transpileModule(loop, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("map", ...Object.keys(bindings), js)({ addLayer: (layer) => layers.push(layer) }, ...Object.values(bindings));
  assert.equal(layers.length, 9);
  assert.deepEqual(layers.map(({ id }) => id), bindings.REDEVELOPMENT_LAYER_IDS);
  assert.deepEqual(bindings.URBAN_CHANGE_TIERS.map(({ minzoom }) => minzoom), [12.5, 13, 14]);
  assert.deepEqual(bindings.URBAN_CHANGE_TIERS[0].filter, ["any", ["!=", ["get", "category"], "large_building"], ["in", ["get", "scale"], ["literal", ["XL", "XXL"]]]]);
  for (const tier of bindings.URBAN_CHANGE_TIERS.slice(1)) {
    assert.deepEqual(tier.filter, ["all", ["==", ["get", "category"], "large_building"], ["==", ["get", "scale"], tier.suffix === "-l" ? "L" : "M"]]);
  }
  for (const layer of layers) {
    assert.equal(layer.layout.visibility, "none");
    assert.equal(layer.source, "redevelopment");
    assert.ok(layer.minzoom >= 12.5);
    if (layer.id.startsWith("redevelopment-points")) {
      assert.deepEqual(layer.paint["circle-radius"], bindings.URBAN_CHANGE_RADIUS);
      assert.deepEqual(layer.paint["circle-color"], bindings.URBAN_CHANGE_COLOR);
      assert.deepEqual(layer.paint["circle-opacity"], ["case", ["==", ["get", "category"], "planning_proposal"], 0, bindings.URBAN_CHANGE_IS_CHIYODA, 0.9, 0.35]);
      assert.deepEqual(layer.paint["circle-stroke-opacity"], ["case", bindings.URBAN_CHANGE_IS_CHIYODA, 1, 0.35]);
    }
  }
  assert.deepEqual(validateStyleMin({ version: 8, sources: { redevelopment: { type: "geojson", data: { type: "FeatureCollection", features: [] } } }, layers }), []);
  const evaluate = (value, properties) => {
    const compiled = expression.createExpression(value, "layers[0].paint.circle-radius");
    assert.equal(compiled.result, "success");
    return compiled.value.evaluate({ zoom: 15 }, { type: "Point", properties });
  };
  const points = layers.find(({ id }) => id === "redevelopment-points");
  for (const w of ["千代田区", "千代田区・中央区"]) {
    const properties = { w, category: "legal_redevelopment", grossFloorArea: 100000 };
    assert.equal(evaluate(points.paint["circle-radius"], properties), 7);
    assert.equal(evaluate(points.paint["circle-opacity"], properties), 0.9);
    assert.equal(evaluate(points.paint["circle-stroke-opacity"], properties), 1);
  }
  const adjacent = { w: "中央区", category: "legal_redevelopment", grossFloorArea: 100000 };
  assert.ok(Math.abs(evaluate(points.paint["circle-radius"], adjacent) - 5.6) < 1e-10);
  assert.equal(evaluate(points.paint["circle-opacity"], adjacent), 0.35);
  assert.equal(evaluate(points.paint["circle-stroke-opacity"], adjacent), 0.35);
  assert.equal(evaluate(points.paint["circle-opacity"], { ...adjacent, category: "planning_proposal" }), 0);
  assert.match(source, /redevelopment: URBAN_CHANGE_TIERS\.map/);
  assert.match(source, /REDEVELOPMENT_LAYER_IDS, overlays\.redevelopment/);
});

test("urban search loads its dataset, enables only its overlay and shows the selected detail", async () => {
  const source = await readFile(new URL("../app/MapAtlas.tsx", import.meta.url), "utf8");
  const start = source.indexOf("const selectSearchItem =");
  const end = source.indexOf("const legendGroups", start);
  assert.ok(start >= 0 && end > start);
  const js = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const events = [];
  const feature = { type: "Feature", geometry: { type: "Point", coordinates: [139.75, 35.69] }, properties: { n: "案件" } };
  let overlays = { redevelopment: false, roads: true };
  const bindings = {
    cancelPendingLocation() {}, mapRef: { current: { flyTo: () => events.push("zoom"), getSource: () => ({ setData() {} }) } },
    setQuery() {}, setPanelOpen() {}, noticeActionRef: { current: 0 }, setLayerNotice() {},
    DATASET_LABELS: { redevelopment: "都市更新", core: "町丁目" },
    ensureDataset: async () => { events.push("load"); return { features: [feature] }; },
    setOverlays: (update) => { overlays = update(overlays); events.push("enable"); },
    detailFor: () => ({ title: "案件" }), meta: {}, boundsFor() {}, setDetail: (detail) => { assert.equal(detail.title, "案件"); events.push("detail"); },
  };
  const select = new Function(...Object.keys(bindings), `${js}; return selectSearchItem;`)(...Object.values(bindings));
  await select({ kind: "都市更新", dataset: "redevelopment", featureIndex: 0, layerId: "redevelopment-hit" });
  assert.deepEqual(events, ["load", "enable", "zoom", "detail"]);
  assert.deepEqual(overlays, { redevelopment: true, roads: true });
  events.length = 0;
  overlays = { redevelopment: false, roads: true };
  await select({ kind: "町丁目", dataset: "core", featureIndex: 0, layerId: "towns" });
  assert.deepEqual(events, ["load", "zoom", "detail"]);
  assert.equal(overlays.redevelopment, false);
});

test("OSM walking reference layers stay lazy, muted and hidden below zoom 14", async () => {
  const source = await readFile(new URL("../app/MapAtlas.tsx", import.meta.url), "utf8");
  const files = { stationEntrances: "station-entrances", undergroundWalkways: "underground-walkways" };
  const sources = {};
  for (const [key, filename] of Object.entries(files)) {
    assert.match(source, new RegExp(`${key}: false`));
    assert.match(source, new RegExp(`${key}: \\["${key}"\\]`));
    assert.match(source, new RegExp(`map\\.addSource\\("${filename}", \\{\\s*type: "geojson",\\s*data: EMPTY_COLLECTION`));
    const data = JSON.parse(await readFile(new URL(`../public/data/layers/${filename}.json`, import.meta.url), "utf8"));
    assert.ok(data.features.length > 0);
    for (const { properties: p, geometry: g } of data.features) {
      assert.equal(g.type, key === "stationEntrances" ? "Point" : "LineString");
      assert.equal(p._source_name, "OpenStreetMap");
      assert.equal(p._data_quality, "community_osm");
      assert.equal(p._license, "ODbL");
      assert.equal(p._source_url, "https://www.openstreetmap.org/copyright");
      assert.ok(Number.isSafeInteger(p._osm_id) && p._osm_id > 0);
      const coordinates = g.type === "Point" ? [g.coordinates] : g.coordinates;
      assert.ok(coordinates.length >= (g.type === "Point" ? 1 : 2));
      assert.ok(coordinates.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && x >= 139.725 && x <= 139.790 && y >= 35.665 && y <= 35.710));
    }
    sources[filename] = { type: "geojson", data };
  }
  const tree = ts.createSourceFile("MapAtlas.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const layers = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === "map.addLayer") {
      const object = node.arguments[0];
      if (object && /^\{\s*id: "(?:station-entrances|underground-walkways)-/.test(object.getText(tree))) {
        const js = ts.transpileModule(`const layer = ${object.getText(tree)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
        layers.push(new Function(`${js}; return layer;`)());
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.deepEqual(layers.map(({ id }) => id).sort(), ["station-entrances-hit", "station-entrances-points", "underground-walkways-hit", "underground-walkways-line"].sort());
  for (const layer of layers) {
    assert.equal(layer.minzoom, 14);
    assert.equal(layer.layout.visibility, "none");
  }
  assert.deepEqual(validateStyleMin({ version: 8, sources, layers }), []);
  assert.ok(layers.find(({ id }) => id === "underground-walkways-line").paint["line-opacity"] < 0.8);
  assert.match(source, /OpenStreetMap上の地下・屋内歩行リンク。網羅性は保証されません。/);
  assert.match(source, /STATION_ENTRANCE_LAYER_IDS, overlays\.stationEntrances/);
  assert.match(source, /UNDERGROUND_WALKWAY_LAYER_IDS, overlays\.undergroundWalkways/);
});

test("walking popups use OSM reference attribution and never infer missing station information", async () => {
  const source = await readFile(new URL("../app/MapAtlas.tsx", import.meta.url), "utf8");
  const detailFor = sourceFunction(source, "detailFor", "culturalGroupDetail", {
    OSM_REFERENCE_SOURCE: "https://www.openstreetmap.org/copyright",
    UNDERGROUND_WALKWAY_NOTE: "OpenStreetMap上の地下・屋内歩行リンク。網羅性は保証されません。",
  });
  const entrance = detailFor("station-entrances-hit", { n: "A1", ref: "A1", operator: "東京メトロ", wheelchair: "limited", _osm_type: "node", _osm_id: 123 });
  assert.equal(entrance.eyebrow, "Station entrance");
  assert.equal(entrance.title, "A1");
  assert.deepEqual(entrance.rows, [{ label: "出口番号", value: "A1" }, { label: "事業者", value: "東京メトロ" }, { label: "車いす", value: "一部対応（OSM）" }]);
  assert.deepEqual(entrance.sources, [{ label: "OpenStreetMap（参考）", url: "https://www.openstreetmap.org/node/123" }]);
  assert.deepEqual(detailFor("station-entrances-hit", {}).rows, []);
  const walkway = detailFor("underground-walkways-hit", { n: "通路", _osm_type: "way", _osm_id: 456 });
  assert.match(walkway.note, /網羅性は保証されません/);
  assert.equal(walkway.sources[0].label, "OpenStreetMap（参考）");
  assert.equal(walkway.sources[0].url, "https://www.openstreetmap.org/way/456");
});

test("planning movement metadata preserves the registry and representative-point caveats", async () => {
  const registry = JSON.parse(await readFile(new URL("../scripts/data/planning-movements-registry.json", import.meta.url), "utf8"));
  const layer = JSON.parse(await readFile(new URL("../public/data/layers/planning-movements.json", import.meta.url), "utf8"));
  assert.equal(layer.features.length, registry.items.length);
  assert.equal(new Set(layer.features.map(({ properties }) => properties.id)).size, registry.items.length);
  for (const item of registry.items) {
    const feature = layer.features.find(({ properties }) => properties.id === item.id);
    assert.ok(feature);
    for (const [key, value] of Object.entries(item)) assert.deepEqual(feature.properties[key], value);
    assert.equal(feature.properties.n, item.name);
    assert.equal(feature.properties.locationQuality, "town_centroid");
    assert.equal(feature.properties._coordinate_quality, "town_representative_point");
    assert.ok(["exact_town", "town_name_only"].includes(feature.properties.anchorResolution));
    assert.equal(feature.geometry.type, "Point");
    assert.ok(feature.geometry.coordinates.every(Number.isFinite));
    assert.match(feature.properties.sourceUrl, /^https:\/\/www\.city\.chiyoda\.lg\.jp\//);
  }
  const source = await readFile(new URL("../app/MapAtlas.tsx", import.meta.url), "utf8");
  const detailFor = sourceFunction(source, "detailFor", "culturalGroupDetail", {
    PLANNING_MOVEMENT_SOURCE: "https://www.city.chiyoda.lg.jp/",
  });
  const detail = detailFor("planning-movements-hit", layer.features[0].properties);
  assert.equal(detail.title, registry.items[0].name);
  assert.deepEqual(detail.rows, [
    { label: "現在の状態", value: registry.items[0].status },
    { label: "検討内容", value: registry.items[0].summary },
    { label: "次のステップ", value: registry.items[0].next },
    { label: "基準日", value: registry.items[0].sourceDate },
  ]);
  assert.match(detail.note, /位置は町丁目の代表点/);
  assert.match(detail.note, /丁目は未特定/);
  assert.equal(detail.sources[0].url, registry.items[0].sourceUrl);
  const noNext = detailFor("planning-movements-hit", { n: "地域対話", status: "検討中" });
  assert.deepEqual(noNext.rows, [{ label: "現在の状態", value: "検討中" }]);
});

test("official district divisions exclude outer-only features and retain source attributes", async () => {
  const data = JSON.parse(await readFile(new URL("../public/data/layers/district-plan-subareas.json", import.meta.url), "utf8"));
  assert.equal(data.type, "FeatureCollection");
  assert.ok(data.features.length > 0);
  assert.equal(new Set(data.features.map(({ properties }) => properties.i)).size, data.features.length);
  for (const { properties: p, geometry: g } of data.features) {
    assert.ok(["Polygon", "MultiPolygon"].includes(g.type));
    assert.ok(p["区分"] && p["名称"]);
    assert.equal(p.n, p["区分"]);
    assert.equal(p.planName, p["名称"]);
    assert.equal(p._data_quality, "official_gis");
    assert.equal(p._source_layer_id, 6);
    assert.equal(p._source_url, "https://tokei-gis2.chiyodatoshikei.jp/server/rest/services/Map_services/chikukeikaku/MapServer/6");
  }
  const source = await readFile(new URL("../app/MapAtlas.tsx", import.meta.url), "utf8");
  const detailFor = sourceFunction(source, "detailFor", "culturalGroupDetail", {
    DISTRICT_PLAN_SUBAREA_SOURCE: data.features[0].properties._source_url,
  });
  const p = data.features[0].properties;
  const detail = detailFor("district-plan-subareas-fill", p);
  assert.equal(detail.eyebrow, "District plan subarea");
  assert.equal(detail.title, p.n);
  assert.equal(detail.rows[0].value, p.planName);
  assert.equal(detail.rows[1].value, p.n);
  assert.equal(detail.sources[0].url, p._source_url);
  assert.equal(detail.sources[1].url, p["詳細資料"]);
});

test("new planning styles are lazy, quiet and integrated into the existing district plan toggle", async () => {
  const source = await readFile(new URL("../app/MapAtlas.tsx", import.meta.url), "utf8");
  const sources = {};
  for (const name of ["planning-movements", "district-plan-subareas"]) {
    assert.match(source, new RegExp(`map\\.addSource\\("${name}", \\{\\s*type: "geojson",\\s*data: EMPTY_COLLECTION`));
    sources[name] = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
  }
  assert.match(source, /planningMovements: false/);
  assert.match(source, /planningMovements: \["planningMovements"\]/);
  assert.match(source, /districtPlans: \["districtPlans", "districtPlanSubareas"\]/);
  assert.match(source, /PLANNING_MOVEMENT_LAYER_IDS, overlays\.planningMovements/);
  const tree = ts.createSourceFile("MapAtlas.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const layers = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === "map.addLayer") {
      const object = node.arguments[0];
      if (object && /^\{\s*id: "(?:planning-movements|district-plan-subareas)-/.test(object.getText(tree))) {
        const js = ts.transpileModule(`const layer = ${object.getText(tree)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
        layers.push(new Function(`${js}; return layer;`)());
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.equal(layers.length, 5);
  for (const layer of layers) assert.equal(layer.layout.visibility, "none");
  for (const layer of layers.filter(({ id }) => id.startsWith("district-plan-subareas"))) assert.ok(layer.minzoom >= 14);
  assert.equal(layers.find(({ id }) => id === "district-plan-subareas-label").minzoom, 16);
  assert.ok(layers.find(({ id }) => id === "district-plan-subareas-fill").paint["fill-opacity"] <= 0.08);
  assert.ok(layers.find(({ id }) => id === "district-plan-subareas-line").paint["line-width"] <= 1);
  const ring = layers.find(({ id }) => id === "planning-movements-points");
  assert.equal(ring.type, "circle");
  assert.equal(ring.paint["circle-opacity"], 0);
  assert.ok(ring.paint["circle-stroke-width"] > 0);
  assert.deepEqual(validateStyleMin({ version: 8, sources, layers }), []);
  assert.ok(source.indexOf('id: "district-plan-subareas-fill"') < source.indexOf('id: "district-plans-casing"'));
  const start = source.indexOf("let feature =");
  const end = source.indexOf('const source = map.getSource("selection")', start);
  assert.ok(start >= 0 && end > start);
  const js = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const pick = new Function("rendered", `${js}; return feature;`);
  const outer = { layer: { id: "district-plans-hit" } };
  const inner = { layer: { id: "district-plan-subareas-fill" } };
  const point = { layer: { id: "planning-movements-hit" } };
  assert.equal(pick([outer, inner]), inner);
  assert.equal(pick([point, outer, inner]), point);
  assert.equal(pick([outer]), outer);
});

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
