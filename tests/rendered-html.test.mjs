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
  assert.match(html, /<title>千代田まちづくり基礎アトラス<\/title>/i);
  assert.match(html, /Chiyoda study atlas/);
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
  assert.match(html, /1936–1942年頃/);
  assert.doesNotMatch(html, /背景地図/);
});

test("map data includes the recommended reference layers", async () => {
  const mapData = JSON.parse(
    await readFile(new URL("../public/data/map-data.json", import.meta.url), "utf8"),
  );

  for (const key of [
    "fire",
    "flood",
    "parks",
    "landPrices",
    "shelters",
    "districtPlans",
    "heightDistricts",
    "specialZones",
    "redevelopment",
  ]) {
    assert.equal(mapData[key].type, "FeatureCollection");
    assert.ok(mapData[key].features.length > 0, `${key} should not be empty`);
  }

  assert.equal(mapData.meta.parkCount, mapData.parks.features.length);
  assert.equal(mapData.meta.landPriceCount, mapData.landPrices.features.length);
  assert.equal(mapData.meta.shelterCount, mapData.shelters.features.length);
  assert.equal(mapData.meta.districtPlanCount, mapData.districtPlans.features.length);
  assert.equal(mapData.meta.heightDistrictCount, mapData.heightDistricts.features.length);
  assert.equal(mapData.meta.specialZoneCount, mapData.specialZones.features.length);
  assert.equal(mapData.meta.redevelopmentCount, mapData.redevelopment.features.length);
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
    mapData.flood.features.every(({ properties }) =>
      Number.isInteger(properties.c) && properties.c >= 1 && properties.c <= 6,
    ),
  );
});
