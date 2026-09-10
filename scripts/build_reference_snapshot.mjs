import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [htmlInput, geoJsonInput, outputPath] = process.argv.slice(2);

if (!htmlInput || !geoJsonInput || !outputPath) {
  throw new Error(
    "Usage: node scripts/build_reference_snapshot.mjs <official-list.html> <official-points.geojson> <output.json>",
  );
}

const OFFICIAL_LIST_URL =
  "https://www.city.chiyoda.lg.jp/koho/machizukuri/kekan/ichiranhyo.html";
const OFFICIAL_GIS_URL =
  "https://www.city.chiyoda.lg.jp/koho/machizukuri/toshi/walkable/yoso-bumpujokyo.html";
const GSI_GEOCODER_URL = "https://msearch.gsi.go.jp/address-search/AddressSearch";

const newerCoordinates = {
  "25": [139.769287, 35.696018],
  "60": [139.766403, 35.698673],
  "61": [139.737183, 35.67992],
  "62": [139.764786, 35.684025],
  "63": [139.767715, 35.702129],
  "64": [139.759201, 35.695789],
  "65": [139.7631088, 35.67832583],
  "66": [139.777863, 35.692219],
};

const oldNameAliases = {
  "大成大手町ビル（旧大手町野村ビル）": "大手町野村ビル",
  "猿楽町町会詰所": "神田猿楽町町会詰所",
  "鷹岡株式会社": "鷹岡（株）",
};

function decodeHtml(value) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)));
}

function textContent(value) {
  return decodeHtml(
    value
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ").trim();
}

function normalizeName(value) {
  return value
    .normalize("NFKC")
    .replace(/[\s・･]/g, "")
    .replace(/[()（）]/g, "")
    .replace(/株式会社/g, "株")
    .replace(/旧/g, "旧")
    .toLocaleLowerCase("ja");
}

function parseOfficialRows(html) {
  const rows = [];
  for (const rowMatch of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((match) => textContent(match[1]));
    if (!/^\d/.test(cells[0] ?? "")) continue;

    const linkMatch = rowMatch[1].match(/<a[^>]+href="([^"]+)"/i);
    if (!linkMatch) throw new Error(`Official detail link missing for ${cells[0]}`);
    const name = cells[2].replace(/\s*（PDF：[^）]+）\s*$/, "");
    rows.push({
      designationNumber: cells[0],
      designationDate: cells[1],
      name,
      type: cells[4] ? "橋梁" : "建築物等",
      address: cells[3],
      note: cells[4] ?? "",
      officialUrl: new URL(linkMatch[1], OFFICIAL_LIST_URL).href,
    });
  }
  return rows;
}

const html = await readFile(resolve(htmlInput), "utf8");
const officialRows = parseOfficialRows(html);
if (officialRows.length !== 64) {
  throw new Error(`Expected 64 current properties, found ${officialRows.length}`);
}

const oldGeoJson = JSON.parse(await readFile(resolve(geoJsonInput), "utf8"));
if (oldGeoJson.features.length !== 56) {
  throw new Error(`Expected 56 official GIS points, found ${oldGeoJson.features.length}`);
}

const oldPoints = new Map(
  oldGeoJson.features.map((feature) => [normalizeName(feature.properties["件名"]), feature]),
);

const unmatched = [];
const records = officialRows.map((row) => {
  const alias = oldNameAliases[row.name] ?? row.name;
  const oldPoint = oldPoints.get(normalizeName(alias));
  const newerPoint = newerCoordinates[row.designationNumber];
  const coordinates = oldPoint?.geometry.coordinates ?? newerPoint;
  if (!coordinates) unmatched.push(row.name);

  return {
    ...row,
    coordinates,
    coordinateSource: oldPoint ? "chiyoda-official-gis" : "gsi-address-search",
    coordinatePrecision: oldPoint ? "official-point" : "block",
  };
});

if (unmatched.length > 0) {
  throw new Error(`No coordinates for: ${unmatched.join(", ")}`);
}

const snapshot = {
  asOf: "2024-12",
  pageUpdated: "2026-02-05",
  officialListUrl: OFFICIAL_LIST_URL,
  officialGisUrl: OFFICIAL_GIS_URL,
  gsiGeocoderUrl: GSI_GEOCODER_URL,
  notes: [
    "現行一覧64物件の名称・種別・所在地・指定日・個別PDFリンクは千代田区公式一覧による。",
    "旧56地点は千代田区公式GIS（令和3年版行政基礎資料集を基に作成）の座標を使用。",
    "指定25・60〜66は公式住所を国土地理院住所検索で位置化した街区等の代表点。",
  ],
  records,
};

await writeFile(resolve(outputPath), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(`Wrote ${records.length} records to ${resolve(outputPath)}`);
