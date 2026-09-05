import { access, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const output = resolve("dist/client");
const indexFile = resolve(output, "index.html");
const prefixedAssets = resolve(output, "chiyoda/_next");
const assets = resolve(output, "_next");

await Promise.all([
  access(indexFile),
  access(resolve(output, "data/map-data.json")),
  access(prefixedAssets),
]);

await rm(assets, { recursive: true, force: true });
await rename(prefixedAssets, assets);
await rm(resolve(output, "chiyoda"), { recursive: true, force: true });
await writeFile(resolve(output, ".nojekyll"), "", "utf8");

const html = await readFile(indexFile, "utf8");
if (!html.includes('/chiyoda/_next/')) {
  throw new Error("GitHub Pages asset prefix is missing from index.html");
}

console.log("GitHub Pages artifact is ready in dist/client");
