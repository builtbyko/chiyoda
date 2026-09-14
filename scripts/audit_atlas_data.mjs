// Offline, non-mutating checks of the published data and its search references.
// The only output written is the audit report; source GeoJSON is never changed.
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve, relative } from "node:path";
import { execFileSync } from "node:child_process";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = await readFile(resolve(root, "app/MapAtlas.tsx"), "utf8");
const tree = ts.createSourceFile("MapAtlas.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function literalMap(name) {
  let initializer;
  for (const statement of tree.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText(tree) === name) initializer = declaration.initializer?.getText(tree);
    }
  }
  if (!initializer) throw new Error(`Missing atlas map: ${name}`);
  return new Function(`return (${initializer});`)();
}
const files = literalMap("DATASET_FILES");
const labels = literalMap("DATASET_LABELS");
const areaDatasets = literalMap("AREA_DATASETS");
const overlayDatasets = literalMap("OVERLAY_DATASETS");
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const coreText = await readFile(resolve(root, "public/data/map-data.json"), "utf8");
const core = JSON.parse(coreText);
const issues = [];
const examplesLimit = 12;
const count = (values) => Object.fromEntries([...values.reduce((map, value) => map.set(String(value ?? "(missing)"), (map.get(String(value ?? "(missing)")) ?? 0) + 1), new Map())].sort(([a], [b]) => a.localeCompare(b)));
function inspectGeometry(geometry) {
  let coordinateCount = 0;
  const errors = new Set();
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  function positions(value) {
    if (!Array.isArray(value) || value.length === 0) { errors.add("empty_coordinates"); return; }
    if (typeof value[0] === "number") {
      coordinateCount++;
      if (value.length < 2 || !value.every(Number.isFinite)) { errors.add("nonfinite_coordinate"); return; }
      const [x, y] = value;
      if (Math.abs(x) > 180 || Math.abs(y) > 90) errors.add("outside_wgs84");
      bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y);
      bounds[2] = Math.max(bounds[2], x); bounds[3] = Math.max(bounds[3], y);
    } else for (const child of value) positions(child);
  }
  function rings(polygon) {
    if (!Array.isArray(polygon)) return;
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4) { errors.add("short_polygon_ring"); continue; }
      const first = ring[0], last = ring.at(-1);
      if (!Array.isArray(first) || !Array.isArray(last) || first[0] !== last[0] || first[1] !== last[1]) errors.add("unclosed_polygon_ring");
    }
  }
  if (!geometry) errors.add("missing_geometry");
  else if (geometry.type === "GeometryCollection") {
    for (const child of geometry.geometries ?? []) {
      const result = inspectGeometry(child);
      coordinateCount += result.coordinateCount;
      result.errors.forEach((error) => errors.add(error));
      if (result.bounds) {
        bounds[0] = Math.min(bounds[0], result.bounds[0]); bounds[1] = Math.min(bounds[1], result.bounds[1]);
        bounds[2] = Math.max(bounds[2], result.bounds[2]); bounds[3] = Math.max(bounds[3], result.bounds[3]);
      }
    }
  } else {
    positions(geometry.coordinates);
    if (geometry.type === "Polygon") rings(geometry.coordinates);
    if (geometry.type === "MultiPolygon") for (const polygon of geometry.coordinates ?? []) rings(polygon);
  }
  return { coordinateCount, errors: [...errors], bounds: Number.isFinite(bounds[0]) ? bounds : null };
}
const datasets = {};
const collections = {};
for (const [key, filename] of Object.entries(files)) {
  const path = `public/data/layers/${filename}`;
  const text = await readFile(resolve(root, path), "utf8");
  const collection = JSON.parse(text);
  if (collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) throw new Error(`Invalid collection: ${path}`);
  collections[key] = collection;
  const features = collection.features;
  const ids = new Map(), names = new Map(), geometryErrors = [];
  let coordinateCount = 0;
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [index, feature] of features.entries()) {
    const p = feature.properties ?? {};
    // In the older Tokyo exports `i` is an initial decision date, not an ID.
    const id = key === "districtPlans" || key === "specialZones"
      ? feature.id ?? p.OBJECTID ?? p.ID
      : p.i ?? feature.id;
    if (id != null) ids.set(String(id), [...(ids.get(String(id)) ?? []), index]);
    if (p.n) names.set(`${p.w ?? ""}|${p.n}`, [...(names.get(`${p.w ?? ""}|${p.n}`) ?? []), index]);
    const geometry = inspectGeometry(feature.geometry);
    coordinateCount += geometry.coordinateCount;
    if (geometry.errors.length) geometryErrors.push({ index, id: id ?? null, name: p.n ?? null, errors: geometry.errors });
    if (geometry.bounds) {
      bounds[0] = Math.min(bounds[0], geometry.bounds[0]); bounds[1] = Math.min(bounds[1], geometry.bounds[1]);
      bounds[2] = Math.max(bounds[2], geometry.bounds[2]); bounds[3] = Math.max(bounds[3], geometry.bounds[3]);
    }
  }
  const duplicateIds = [...ids].filter(([, indices]) => indices.length > 1);
  const repeatedNames = [...names].filter(([, indices]) => indices.length > 1);
  datasets[key] = {
    label: labels[key], file: path, sha256: sha256(text), bytes: Buffer.byteLength(text), featureCount: features.length,
    geometryTypes: count(features.map(({ geometry }) => geometry?.type)), coordinateCount,
    bounds: Number.isFinite(bounds[0]) ? bounds : null,
    wards: count(features.map(({ properties: p }) => p?.w)),
    sourceDates: count(features.map(({ properties: p }) => p?.sourceDate ?? p?._source_date)),
    retrievedDates: count(features.map(({ properties: p }) => p?.retrievedDate)),
    compiledDates: count(features.map(({ properties: p }) => p?.compiledDate)),
    // `d` is population density in towns; never infer a date from that field.
    featureDates: ["districtPlans", "heightDistricts", "specialZones", "culturalAssets", "memoryPlates"].includes(key)
      ? count(features.map(({ properties: p }) => p?.d)) : null,
    coordinateQualities: count(features.map(({ properties: p }) => p?.locationQuality ?? p?._coordinate_quality)),
    dataQualities: count(features.map(({ properties: p }) => p?._data_quality)),
    missingNames: features.filter(({ properties: p }) => !p?.n).length,
    identityCoverage: [...ids.values()].reduce((total, indices) => total + indices.length, 0),
    duplicateIdCount: duplicateIds.length, duplicateIds: duplicateIds.slice(0, examplesLimit),
    repeatedNameCount: repeatedNames.length, repeatedNames: repeatedNames.slice(0, examplesLimit),
    geometryErrorCount: geometryErrors.length, geometryErrors: geometryErrors.slice(0, examplesLimit),
  };
  if (geometryErrors.length) issues.push({ severity: "error", kind: "geometry_structure", dataset: key, count: geometryErrors.length });
  // Multipart exports may repeat names/IDs; report rather than infer duplicates.
  if (duplicateIds.length) issues.push({ severity: "review", kind: "repeated_identity", dataset: key, count: duplicateIds.length });
}
const searchErrors = [];
for (const [index, [name, ward, typeIndex, featureIndex]] of core.search.entries()) {
  const type = core.searchTypes[typeIndex];
  const feature = type && collections[type.d]?.features[featureIndex];
  const errors = [];
  if (!type) errors.push("missing_search_type");
  if (!feature) errors.push("missing_target");
  else {
    if (feature.properties?.n !== name) errors.push("name_mismatch");
    const actualWard = String(feature.properties?.w ?? (type.d === "chiyodaRegions" || type.d === "culturalAssets" ? "千代田区" : ""));
    if (actualWard !== ward) errors.push("ward_mismatch");
  }
  if (errors.length) searchErrors.push({ index, name, ward, dataset: type?.d, featureIndex, errors });
}
if (searchErrors.length) issues.push({ severity: "error", kind: "search_reference", count: searchErrors.length });
const metaKeys = { towns: "townCount", stations: "stationCount", parks: "parkCount", landPrices: "landPriceCount", shelters: "shelterCount", districtPlans: "districtPlanCount", heightDistricts: "heightDistrictCount", specialZones: "specialZoneCount", redevelopment: "redevelopmentCount", chiyodaRegions: "chiyodaRegionCount", urbanPlanningRoads: "urbanPlanningRoadCount" };
const metadataChecks = Object.entries(metaKeys).map(([key, field]) => ({ dataset: key, field, actual: datasets[key].featureCount, metadata: core.meta[field], matches: datasets[key].featureCount === core.meta[field] }));
for (const check of metadataChecks) if (!check.matches) issues.push({ severity: "error", kind: "metadata_count", ...check });
const allFiles = await readdir(resolve(root, "public/data/layers"));
const report = {
  auditedAt: new Date().toISOString(),
  referenceCommit: execFileSync("git", ["-c", `safe.directory=${root.replaceAll("\\", "/").replace(/\/$/, "")}`, "rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  scope: "Working-tree files at auditedAt; referenceCommit is HEAD, not a claim that uncommitted files equal HEAD. No live source freshness or topology verification. Dates are field distributions, not inferred acquisition dates. Repeated names are not automatically errors; districtPlans/specialZones have no stable exported ID.",
  core: { file: "public/data/map-data.json", sha256: sha256(coreText), bytes: Buffer.byteLength(coreText), metadata: core.meta },
  mappings: { areaDatasets, overlayDatasets }, datasets,
  inactiveFiles: allFiles.filter((file) => file.endsWith(".json") && !Object.values(files).includes(file)),
  search: { count: core.search.length, byDataset: count(core.search.map((item) => core.searchTypes[item[2]]?.d)), errorCount: searchErrors.length, errors: searchErrors.slice(0, 30) },
  metadataChecks, issues,
};
const output = resolve(root, "scripts/data/atlas-data-audit.json");
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ report: relative(root, output), activeDatasets: Object.keys(datasets).length, features: Object.values(datasets).reduce((total, data) => total + data.featureCount, 0), searchItems: report.search.count, searchErrors: report.search.errorCount, errors: issues.filter(({ severity }) => severity === "error"), review: issues.filter(({ severity }) => severity === "review") }, null, 2));
process.exitCode = issues.some(({ severity }) => severity === "error") ? 1 : 0;
