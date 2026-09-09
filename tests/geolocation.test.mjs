import assert from "node:assert/strict";
import test from "node:test";

import { buildLocationData, geolocationErrorMessage } from "../app/geolocation.ts";

test("location data includes a point, closed accuracy ring, and nonzero camera bounds", () => {
  const location = buildLocationData(139.753, 35.684, 30.4);

  assert.deepEqual(location.point.features[0].geometry.coordinates, [139.753, 35.684]);
  assert.equal(location.point.features[0].properties.accuracy, 30);
  assert.equal(location.accuracyArea.features[0].geometry.type, "Polygon");

  const ring = location.accuracyArea.features[0].geometry.coordinates[0];
  assert.equal(ring.length, 49);
  assert.deepEqual(ring[0], ring.at(-1));
  assert.ok(location.bounds[0][0] < 139.753 && location.bounds[1][0] > 139.753);
  assert.ok(location.bounds[0][1] < 35.684 && location.bounds[1][1] > 35.684);
});

test("location data omits an accuracy polygon when accuracy is unavailable", () => {
  const location = buildLocationData(139.753, 35.684, Number.NaN);

  assert.equal(location.accuracyArea.features.length, 0);
  assert.ok(location.bounds[1][0] > location.bounds[0][0]);
});

test("geolocation errors have actionable Japanese messages", () => {
  assert.match(geolocationErrorMessage(1), /許可/);
  assert.match(geolocationErrorMessage(2), /通信環境/);
  assert.match(geolocationErrorMessage(3), /タイムアウト/);
  assert.match(geolocationErrorMessage(99), /もう一度/);
});
