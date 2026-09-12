import { access, copyFile, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const output = resolve("dist/client");
const indexFile = resolve(output, "index.html");
const prefixedAssets = resolve(output, "chiyoda/_next");
const assets = resolve(output, "_next");
const chunks = resolve(assets, "static/chunks");
const maplibreDist = resolve("node_modules/maplibre-gl/dist");
const maplibreWorkerFiles = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];
const layerFiles = [
  "towns.json",
  "zoning.json",
  "fire.json",
  "flood.json",
  "parks.json",
  "land-prices.json",
  "shelters.json",
  "roads.json",
  "urban-planning-roads.json",
  "rail.json",
  "stations.json",
  "station-entrances.json",
  "underground-walkways.json",
  "district-plans.json",
  "district-plan-subareas.json",
  "planning-movements.json",
  "height-districts.json",
  "special-zones.json",
  "redevelopment.json",
  "chiyoda-regions.json",
  "landscape-properties.json",
  "functional-kaiwai.json",
  "open-spaces.json",
  "area-management.json",
  "memory-plates.json",
  "cultural-assets.json",
];

await Promise.all([
  access(indexFile),
  access(resolve(output, "data/map-data.json")),
  ...layerFiles.map((file) => access(resolve(output, "data/layers", file))),
  access(prefixedAssets),
]);

await rm(assets, { recursive: true, force: true });
await rename(prefixedAssets, assets);
await Promise.all(
  maplibreWorkerFiles.map((file) =>
    copyFile(resolve(maplibreDist, file), resolve(chunks, file)),
  ),
);
await rm(resolve(output, "chiyoda"), { recursive: true, force: true });
await writeFile(resolve(output, ".nojekyll"), "", "utf8");

await Promise.all(
  maplibreWorkerFiles.map((file) => access(resolve(chunks, file))),
);

const html = await readFile(indexFile, "utf8");
if (!html.includes('/chiyoda/_next/')) {
  throw new Error("GitHub Pages asset prefix is missing from index.html");
}

console.log("GitHub Pages artifact is ready in dist/client");
