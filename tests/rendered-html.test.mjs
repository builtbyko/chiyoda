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
  assert.match(html, /<title>千代田区＋隣接区ベースアトラス<\/title>/i);
  assert.match(html, /Chiyoda &amp; neighbors/);
  assert.match(html, /人口密度/);
  assert.match(html, /用途地域/);
  assert.match(html, /防火指定/);
  assert.match(html, /洪水浸水/);
  assert.match(html, /公園・緑地/);
  assert.match(html, /地価公示/);
  assert.match(html, /指定避難所/);
  assert.match(html, /町丁目境界/);
  assert.doesNotMatch(html, /背景地図/);
});

test("map data includes the recommended reference layers", async () => {
  const mapData = JSON.parse(
    await readFile(new URL("../public/data/map-data.json", import.meta.url), "utf8"),
  );

  for (const key of ["fire", "flood", "parks", "landPrices", "shelters"]) {
    assert.equal(mapData[key].type, "FeatureCollection");
    assert.ok(mapData[key].features.length > 0, `${key} should not be empty`);
  }

  assert.equal(mapData.meta.parkCount, mapData.parks.features.length);
  assert.equal(mapData.meta.landPriceCount, mapData.landPrices.features.length);
  assert.equal(mapData.meta.shelterCount, mapData.shelters.features.length);
  assert.ok(
    mapData.flood.features.every(({ properties }) =>
      Number.isInteger(properties.c) && properties.c >= 1 && properties.c <= 6,
    ),
  );
});
