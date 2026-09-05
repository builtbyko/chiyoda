import { access, copyFile, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const output = resolve("dist/client");
const indexFile = resolve(output, "index.html");
const prefixedAssets = resolve(output, "chiyoda/_next");
const assets = resolve(output, "_next");
const chunks = resolve(assets, "static/chunks");
const maplibreDist = resolve("node_modules/maplibre-gl/dist");
const maplibreWorkerFiles = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

await Promise.all([
  access(indexFile),
  access(resolve(output, "data/map-data.json")),
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
