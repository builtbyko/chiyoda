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

for (const [key, filename, label] of [
  ["urbanPlanningRoads", "urban-planning-roads.json", "都市計画道路"],
  ["stationEntrances", "station-entrances.json", "駅出入口"],
  ["undergroundWalkways", "underground-walkways.json", "地下歩行ネットワーク"],
  ["planningMovements", "planning-movements.json", "まちづくりの動き"],
]) {
  test(`${key} is not fetched until selected and is reused afterward`, async () => {
    const calls = [];
    const hydrated = [];
    const loader = createLazyGeoJsonLoader({
      files: { [key]: filename },
      labels: { [key]: label },
      fetcher: async (url) => {
        calls.push(url);
        return { ok: true, json: async () => collection(key) };
      },
    });
    const getSource = (key) => ({ setData: (data) => hydrated.push([key, data]) });
    assert.equal(calls.length, 0);
    await Promise.all([
      loader.ensure(key, getSource),
      loader.ensure(key, getSource),
    ]);
    await loader.ensure(key, getSource);
    assert.deepEqual(calls, [`data/layers/${filename}`]);
    assert.equal(hydrated.length, 1);
  });
}

test("district plan selection fetches outer boundaries and internal divisions once", async () => {
  const calls = [];
  const loader = createLazyGeoJsonLoader({
    files: { districtPlans: "district-plans.json", districtPlanSubareas: "district-plan-subareas.json" },
    labels: { districtPlans: "地区計画", districtPlanSubareas: "内部区分" },
    fetcher: async (url) => { calls.push(url); return { ok: true, json: async () => collection(url) }; },
  });
  const getSource = () => ({ setData() {} });
  assert.deepEqual(calls, []);
  const select = () => Promise.all([loader.ensure("districtPlans", getSource), loader.ensure("districtPlanSubareas", getSource)]);
  await Promise.all([select(), select()]);
  await select();
  assert.deepEqual(calls.sort(), ["data/layers/district-plan-subareas.json", "data/layers/district-plans.json"]);
});
