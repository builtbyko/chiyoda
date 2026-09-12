import assert from "node:assert/strict";
import test from "node:test";

import { createLazyGeoJsonLoader } from "../app/lazyGeoJson.ts";

const collection = (name) => ({
  type: "FeatureCollection",
  features: [{ type: "Feature", properties: { name }, geometry: null }],
});

test("lazy loader fetches once, hydrates once, and uses a Pages-safe relative URL", async () => {
  const calls = [];
  const hydrated = [];
  const loader = createLazyGeoJsonLoader({
    files: { flood: "flood.json" },
    labels: { flood: "洪水浸水", towns: "町丁目" },
    fetcher: async (url) => {
      calls.push(url);
      return { ok: true, json: async () => collection("flood") };
    },
  });
  loader.prime({ towns: collection("towns") });
  const getSource = (key) => ({ setData: (data) => hydrated.push([key, data]) });

  await Promise.all([loader.ensure("flood", getSource), loader.ensure("flood", getSource)]);
  const flood = await loader.ensure("flood", getSource);
  const towns = await loader.ensure("towns", getSource);

  assert.deepEqual(calls, ["data/layers/flood.json"]);
  assert.deepEqual(hydrated.map(([key]) => key), ["flood", "towns"]);
  assert.equal(flood.features[0].properties.name, "flood");
  assert.equal(towns.features[0].properties.name, "towns");
});

test("lazy loader reports a failed request and allows a retry", async () => {
  let attempts = 0;
  const hydrated = [];
  const loader = createLazyGeoJsonLoader({
    files: { roads: "roads.json" },
    labels: { roads: "主要道路" },
    fetcher: async () => {
      attempts += 1;
      return attempts === 1
        ? { ok: false, json: async () => ({}) }
        : { ok: true, json: async () => collection("roads") };
    },
  });
  const getSource = () => ({ setData: (data) => hydrated.push(data) });

  await assert.rejects(loader.ensure("roads", getSource), /主要道路を読み込めませんでした/);
  assert.equal(hydrated.length, 0);

  await loader.ensure("roads", getSource);
  assert.equal(attempts, 2);
  assert.equal(hydrated.length, 1);
});

test("urban planning roads are not fetched until selected and are reused afterward", async () => {
  const calls = [];
  const hydrated = [];
  const loader = createLazyGeoJsonLoader({
    files: { urbanPlanningRoads: "urban-planning-roads.json" },
    labels: { urbanPlanningRoads: "都市計画道路" },
    fetcher: async (url) => {
      calls.push(url);
      return { ok: true, json: async () => collection("urbanPlanningRoads") };
    },
  });
  const getSource = (key) => ({ setData: (data) => hydrated.push([key, data]) });
  assert.equal(calls.length, 0);
  await Promise.all([
    loader.ensure("urbanPlanningRoads", getSource),
    loader.ensure("urbanPlanningRoads", getSource),
  ]);
  await loader.ensure("urbanPlanningRoads", getSource);
  assert.deepEqual(calls, ["data/layers/urban-planning-roads.json"]);
  assert.equal(hydrated.length, 1);
});
