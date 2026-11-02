import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => JSON.parse(readFileSync(path.join(root, file), "utf8"));
const registry = read("scripts/data/district-plan-official-updates.json");
const layers = Object.fromEntries(
  ["district-plans", "special-zones"].map((layer) => [layer, read(`public/data/layers/${layer}.json`).features]),
);

test("published district plans retain their source snapshot and current official changes", () => {
  assert.equal(registry.updates.length, 7);
  for (const update of registry.updates) {
    const matches = layers[update.layer].filter(({ properties: p }) =>
      p.n === update.name && p.w === update.ward &&
      (update.layer !== "special-zones" || p.c === "redevelopmentPlan"));
    assert.equal(matches.length, 1, `${update.name} must have exactly one matching feature`);
    const p = matches[0].properties;
    assert.equal(p.d, update.sourceDecision, `${update.name}: source date`);
    assert.equal(p._current_decision, update.currentDecision, `${update.name}: current date`);
    assert.equal(p._current_source_url, update.source, `${update.name}: current source`);
    assert.equal(p._update_note, update.note, `${update.name}: explanation`);
    if (update.currentArea !== undefined) {
      assert.ok(Math.abs(p.a - update.sourceArea) < 0.001, `${update.name}: old area`);
      assert.equal(p._current_area_ha, update.currentArea, `${update.name}: current area`);
      assert.equal(p._boundary_status, "outdated", `${update.name}: old boundary marker`);
    }
  }
  const oldBoundaries = layers["special-zones"].filter(({ properties: p }) => p._boundary_status === "outdated");
  assert.deepEqual(oldBoundaries.map(({ properties: p }) => p.n).sort(), ["後楽二丁目地区", "田町駅東口地区"]);
});

test("confirmed source typos and adjoining-ward search fragments stay corrected", () => {
  assert.equal(registry.fieldCorrections.length, 2);
  for (const correction of registry.fieldCorrections) {
    const matches = layers[correction.layer].filter(({ properties: p }) => p.n === correction.name && p.w === correction.ward);
    assert.equal(matches.length, 1, correction.name);
    assert.equal(matches[0].properties[correction.field], correction.correctValue, correction.name);
    assert.equal(matches[0].properties._current_source_url, correction.source, correction.name);
  }
  const search = read("public/data/map-data.json").search;
  assert.equal(search.filter((row) => row.length === 5).length, 11);
});
