import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  assert.match(html, /地区計画/);
  assert.match(html, /高度地区/);
  assert.match(html, /容積・再開発等の特例/);
  assert.match(html, /事業中の再開発/);
  assert.match(html, /千代田区の7地域/);
  assert.match(html, /景観まちづくり重要物件/);
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
    zoning: "zoning.json",
    fire: "fire.json",
    flood: "flood.json",
    landPrices: "land-prices.json",
    shelters: "shelters.json",
    roads: "roads.json",
    rail: "rail.json",
    heightDistricts: "height-districts.json",
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

  for (const key of [
    "towns",
    "parks",
    "stations",
    "districtPlans",
    "specialZones",
    "redevelopment",
    "chiyodaRegions",
    "landscapeProperties",
  ]) {
    assert.equal(mapData[key].type, "FeatureCollection");
    assert.ok(mapData[key].features.length > 0, `${key} should not be empty`);
  }

  for (const [key, layer] of Object.entries(layers)) {
    assert.equal(layer.type, "FeatureCollection");
    assert.ok(layer.features.length > 0, `${key} should not be empty`);
    assert.equal(mapData[key], undefined, `${key} should be lazy-loaded`);
  }

  assert.ok(Buffer.byteLength(coreText) < 2_000_000, "initial map data should stay compact");

  assert.equal(mapData.meta.parkCount, mapData.parks.features.length);
  assert.equal(mapData.meta.stationCount, mapData.stations.features.length);
  assert.equal(mapData.meta.landPriceCount, layers.landPrices.features.length);
  assert.equal(mapData.meta.shelterCount, layers.shelters.features.length);
  assert.equal(mapData.meta.districtPlanCount, mapData.districtPlans.features.length);
  assert.equal(mapData.meta.heightDistrictCount, layers.heightDistricts.features.length);
  assert.equal(mapData.meta.specialZoneCount, mapData.specialZones.features.length);
  assert.equal(mapData.meta.redevelopmentCount, mapData.redevelopment.features.length);
  assert.equal(mapData.meta.chiyodaRegionCount, mapData.chiyodaRegions.features.length);
  assert.equal(
    mapData.meta.landscapePropertyCount,
    mapData.landscapeProperties.features.length,
  );
  assert.equal(mapData.meta.chiyodaRegionDate, "2021-05");
  assert.equal(mapData.meta.landscapePropertyDate, "2024-12");
  assert.equal(mapData.meta.chiyodaDaytimePopulation, 903780);
  assert.ok(mapData.meta.chiyodaArea > 11.5);
  assert.ok(
    mapData.towns.features.every(({ properties }) =>
      Number.isFinite(properties.dd) && typeof properties.lu === "string",
    ),
  );
  assert.ok(
    mapData.redevelopment.features.every(({ geometry, properties }) =>
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
  assert.equal(mapData.chiyodaRegions.features.length, 7);
  assert.deepEqual(
    mapData.chiyodaRegions.features.map(({ properties }) => properties.n).sort(),
    expectedRegions.sort(),
  );
  assert.ok(
    mapData.chiyodaRegions.features.every(({ geometry, properties }) =>
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

  const landscapeProperties = mapData.landscapeProperties.features;
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
