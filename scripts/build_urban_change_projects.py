#!/usr/bin/env python3
"""Build a Chiyoda 'urban change' pipeline for CHiYODA ATLAS.

Combines:
1) current statutory urban redevelopment projects,
2) large planned/changed building projects from Chiyoda's environmental-plan
   disclosure (>= 3,000 m2 gross floor area),
3) selected current planning proposals clearly located in Chiyoda.

Raw HTML and geocoding responses are cached outside the repository under
../work/chiyoda_map/data/next-stage/urban-change.

Output:
  public/data/layers/urban-change-projects.json
  scripts/data/urban-change-build-report.json
"""

from __future__ import annotations

import argparse
import io
import json
import hashlib
import math
import re
import unicodedata
from datetime import date
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import pandas as pd
import requests
from bs4 import BeautifulSoup
from shapely.geometry import Point, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CACHE = ROOT.parent / "work" / "chiyoda_map" / "data" / "next-stage" / "urban-change"

ENV_INDEX = "https://www.city.chiyoda.lg.jp/koho/machizukuri/kankyo/gaiyoichiran/index.html"
REDEV_PAGE = "https://www.city.chiyoda.lg.jp/koho/machizukuri/toshi/yotochiiki/saikaihatsu.html"
PROPOSAL_PAGE = "https://www.toshiseibi.metro.tokyo.lg.jp/basic/singikai/aramashi/seido_3"
GSI_GEOCODE = "https://msearch.gsi.go.jp/address-search/AddressSearch"

OUTPUT = ROOT / "public/data/layers/urban-change-projects.json"
REPORT = ROOT / "scripts/data/urban-change-build-report.json"
EXISTING_REDEV = ROOT / "public/data/layers/redevelopment.json"
TOWNS = ROOT / "public/data/layers/towns.json"

MIN_GFA = 3000.0
ISSUES = []
CHIYODA_SCOPE = None
CHIYODA_TOWNS = []

EXPECTED_CURRENT_REDEVELOPMENT = {
    "大手町二丁目常盤橋",
    "内神田一丁目",
    "神田小川町三丁目西部南",
    "飯田橋駅東",
    "内幸町一丁目街区南",
    "富士見二丁目3番",
    "九段南一丁目",
}

KNOWN_REDEV_ENRICHMENT = {
    "九段南一丁目": {
        "address": "千代田区九段南一丁目",
        "areaHa": 0.6,
        "grossFloorArea": 82200,
        "uses": "事務所、店舗、公共公益施設、駐車場等",
        "urbanPlanDate": "2024-03",
        "officialUrl": "https://www.toshiseibi.metro.tokyo.lg.jp/machizukuri/shigaichi_seibi/sai-kai/saikaihatsu/chiyoda_01_23",
    }
}

KNOWN_CHIYODA_PROPOSAL_HINTS = (
    "神田錦町三丁目南部東",
)


def norm_text(value: Any) -> str:
    if value is None or pd.isna(value):
        return ""
    return unicodedata.normalize("NFKC", str(value)).replace("\u3000", " ").strip()


def compact(value: Any) -> str:
    return re.sub(r"\s+", "", norm_text(value))


def canonical_project_name(value: str) -> str:
    text = compact(value)
    text = re.sub(r"（仮称）|\(仮称\)", "", text)
    text = text.replace("第一種市街地再開発事業", "")
    text = text.replace("市街地再開発事業", "")
    text = text.replace("３番", "3番")
    text = text.replace("(外部サイトへリンク)", "")
    text = re.sub(r"地区$", "", text)
    return text


def source_date(html: str) -> str | None:
    soup = BeautifulSoup(html, "html.parser")
    updated = soup.select_one("#tmp_update")
    if updated:
        match = re.search(r"(20\d{2})年(\d{1,2})月(\d{1,2})日", updated.get_text())
        if match:
            return "-".join((match[1], f"{int(match[2]):02d}", f"{int(match[3]):02d}"))
    updated = soup.select_one("time.article-template-last-updated-date_time[datetime]")
    return updated["datetime"] if updated else None


def fetch_text(url: str, cache_path: Path, force: bool = False) -> str:
    if cache_path.exists() and not force:
        return cache_path.read_text(encoding="utf-8")
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    response = requests.get(url, timeout=90)
    response.raise_for_status()
    response.encoding = response.apparent_encoding or "utf-8"
    text = response.text
    cache_path.write_text(text, encoding="utf-8")
    return text


def flatten_columns(columns) -> list[str]:
    result = []
    for col in columns:
        if isinstance(col, tuple):
            parts = [norm_text(x) for x in col if norm_text(x) and "Unnamed:" not in norm_text(x)]
            result.append(" ".join(dict.fromkeys(parts)))
        else:
            result.append(norm_text(col))
    return result


def find_col(columns: list[str], tokens: tuple[str, ...]) -> str | None:
    for token in tokens:
        for col in columns:
            if token in col:
                return col
    return None


def extract_gfa(text: str) -> float | None:
    value = norm_text(text).replace(",", "")
    matches = re.findall(r"([0-9]+(?:\.[0-9]+)?)\s*平方メートル", value)
    if not matches:
        matches = re.findall(r"([0-9]+(?:\.[0-9]+)?)\s*m[²2]", value, re.I)
    if not matches:
        return None
    try:
        values = set(float(x) for x in matches)
        return values.pop() if len(values) == 1 else None
    except Exception:
        return None


def extract_status(text: str) -> str:
    value = compact(text)
    if value.startswith("完了") and not value.startswith("完了予定"):
        return "完了"
    if "変更" in value:
        return "変更"
    if "計画" in value:
        return "計画"
    return value[:20] or "不明"


def extract_completion(text: str) -> str | None:
    value = norm_text(text)
    match = re.search(r"(20\d{2})年\s*(\d{1,2})月", value)
    if match:
        return f"{int(match.group(1)):04d}-{int(match.group(2)):02d}"
    return None


def extract_construction_type(text: str) -> str | None:
    value = compact(text)
    for token in ("新築", "新設", "増築", "改築", "建替", "建て替え"):
        if token in value:
            return token
    return None


def scale_for(gfa: float | None) -> str:
    if not gfa:
        return "unknown"
    if gfa >= 100000:
        return "XXL"
    if gfa >= 50000:
        return "XL"
    if gfa >= 10000:
        return "L"
    if gfa >= 3000:
        return "M"
    return "S"


def load_town_centroids():
    global CHIYODA_SCOPE, CHIYODA_TOWNS
    data = json.loads(TOWNS.read_text(encoding="utf-8"))
    out = []
    geometries = []
    for feature in data.get("features", []):
        props = feature.get("properties", {})
        name = str(props.get("n") or props.get("name") or "")
        ward = str(props.get("w") or "")
        if ward and ward != "千代田区":
            continue
        geom = shape(feature["geometry"])
        geometries.append(geom)
        point = geom.representative_point()
        out.append((name, [point.x, point.y]))
    CHIYODA_SCOPE = unary_union(geometries)
    CHIYODA_TOWNS = out
    return sorted(out, key=lambda item: len(item[0]), reverse=True)


def normalized_address(address: str) -> str:
    text = compact(address).replace("東京都千代田区", "").replace("千代田区", "")
    digits = "一二三四五六七八九"
    text = re.sub(r"([1-9])丁目", lambda m: digits[int(m[1]) - 1] + "丁目", text)
    return re.sub(r"^([^0-9]+?)([1-9])(?=[-－])", lambda m: m[1] + digits[int(m[2]) - 1] + "丁目", text)


def town_point(address: str, town_centroids):
    normalized = normalized_address(address)
    for name, coords in town_centroids:
        n = compact(name)
        if n and n in normalized:
            return coords, name
    return None, None


def gsi_geocode(address: str, cache_dir: Path):
    query = norm_text(address)
    key = re.sub(r"[^0-9A-Za-zぁ-んァ-ヶ一-龠]+", "_", query)[:100]
    cache = cache_dir / f"{key}.json"
    if cache.exists():
        data = json.loads(cache.read_text(encoding="utf-8"))
    else:
        try:
            response = requests.get(GSI_GEOCODE, params={"q": query}, timeout=30)
            response.raise_for_status()
            data = response.json()
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        except Exception:
            return None
    if not data:
        return None
    query_town = normalized_address(query)
    expected = next((n for n, _ in sorted(CHIYODA_TOWNS, key=lambda item: len(item[0]), reverse=True) if compact(n) in query_town), None)
    for candidate in data:
        try:
            coords = [float(v) for v in candidate["geometry"]["coordinates"]]
            title = compact(candidate.get("properties", {}).get("title", ""))
            if len(coords) != 2 or not all(math.isfinite(v) for v in coords):
                continue
            if "千代田区" not in title or (expected and compact(expected) not in title):
                continue
            if CHIYODA_SCOPE is not None and not CHIYODA_SCOPE.covers(Point(coords)):
                continue
            return coords
        except (KeyError, TypeError, ValueError):
            continue
    return None


def location_for(address: str, town_centroids, cache_dir: Path):
    query = address
    if not query.startswith("東京都"):
        query = "東京都千代田区" + address.replace("千代田区", "")
    coords = gsi_geocode(query, cache_dir)
    if coords:
        return coords, "gsi_geocode"
    coords, town = town_point(address, town_centroids)
    if coords:
        return coords, "town_centroid"
    return None, "unresolved"


def env_pages(index_html: str):
    soup = BeautifulSoup(index_html, "html.parser")
    links = []
    for a in soup.find_all("a", href=True):
        href = urljoin(ENV_INDEX, a["href"])
        if "/gaiyoichiran/r" not in href or not href.endswith(".html"):
            continue
        if href.endswith("/index.html"):
            continue
        m = re.search(r"/r([4-8]\d{0,2})\.html$", href)
        if not m:
            continue
        links.append(href)
    return list(dict.fromkeys(links))


def parse_env_page(url: str, html: str):
    results = []
    try:
        tables = pd.read_html(io.BytesIO(html.encode("utf-8")), encoding="utf-8", flavor="lxml")
    except Exception as exc:
        raise ValueError(f"Official environmental table could not be parsed: {url}") from exc

    matched_table = False
    for df in tables:
        df.columns = flatten_columns(df.columns)
        columns = list(df.columns)

        name_col = find_col(columns, ("建物名称", "建築名称", "建築物の名称"))
        address_col = find_col(columns, ("所在地",))
        use_col = find_col(columns, ("建物用途", "用途"))
        gfa_col = find_col(columns, ("延べ面積",))
        completion_col = find_col(columns, ("完了予定年月", "完了年月"))
        status_col = find_col(columns, ("備考",))
        reception_col = find_col(columns, ("計画 受付番号", "計画受付番号", "受付番号"))

        if not name_col or not address_col or not gfa_col or not status_col:
            continue
        matched_table = True

        for _, row in df.iterrows():
            name = norm_text(row.get(name_col))
            address = norm_text(row.get(address_col))
            if not name or name.lower() == "nan" or not address:
                continue

            gfa = extract_gfa(norm_text(row.get(gfa_col)))
            if not gfa:
                continue

            use_text = norm_text(row.get(use_col)) if use_col else ""
            completion_text = norm_text(row.get(completion_col)) if completion_col else ""
            status_text = norm_text(row.get(status_col)) if status_col else ""
            status = extract_status(status_text)

            construction_type = extract_construction_type(use_text + " " + completion_text)
            uses = re.sub(r"\b(新築|増築|改築)\b", "", use_text).strip(" 、,\n")

            results.append({
                "name": name,
                "address": address,
                "uses": uses or None,
                "constructionType": construction_type,
                "completion": extract_completion(completion_text),
                "grossFloorArea": gfa,
                "status": status,
                "receptionNumber": norm_text(row.get(reception_col)) if reception_col else None,
                "sourceUrl": url,
                "sourceDate": source_date(html),
            })
    if not matched_table:
        raise ValueError(f"Official environmental table columns changed: {url}")
    return results


def existing_redevelopment():
    if not EXISTING_REDEV.exists():
        return {}
    data = json.loads(EXISTING_REDEV.read_text(encoding="utf-8"))
    out = {}
    for feature in data.get("features", []):
        p = feature.get("properties", {})
        ward = str(p.get("w") or "")
        if "千代田区" not in ward:
            continue
        name = str(p.get("n") or "")
        out[canonical_project_name(name)] = feature
    return out


def current_redevelopment_names(html: str):
    soup = BeautifulSoup(html, "html.parser")
    heading = None
    for h in soup.find_all(["h2", "h3", "h4"]):
        if "事業中の市街地再開発" in h.get_text(" ", strip=True):
            heading = h
            break
    if not heading:
        return []

    names = []
    node = heading.find_next()
    while node:
        if node.name in ("h2", "h3") and node is not heading:
            break
        if node.name == "a":
            text = node.get_text(" ", strip=True)
            if text and "事業計画書" not in text and "東京都" not in text:
                if "地区" in text or "常盤橋" in text:
                    names.append((text, urljoin(REDEV_PAGE, node.get("href", ""))))
        node = node.find_next()
    return list(dict.fromkeys(names))


def redevelopment_features(html: str, town_centroids, geocode_cache: Path):
    existing = existing_redevelopment()
    names = current_redevelopment_names(html)
    if len(names) < 5:
        raise ValueError("Official current redevelopment section could not be verified; no fallback projects added")

    features = []
    seen = set()
    for raw_name, link in names:
        match_key = canonical_project_name(raw_name)
        candidate = None
        for key, feature in existing.items():
            if match_key == key:
                candidate = feature
                break

        props = {
            "n": re.sub(r"\s*[（(]外部サイトへリンク[）)]$", "", raw_name),
            "category": "legal_redevelopment",
            "categoryLabel": "市街地再開発",
            "status": "事業中",
            "sourceUrl": link or REDEV_PAGE,
            "sourceName": "千代田区 市街地再開発事業",
            "dataQuality": "official_list",
            "w": "千代田区",
            "sourceDate": "2026-02",
        }
        geometry = None

        if candidate:
            cp = candidate["properties"]
            props.update({
                "n": cp.get("n") or raw_name,
                "areaHa": cp.get("a"),
                "urbanPlanDate": cp.get("d"),
                "approvalDate": cp.get("p"),
                "operator": cp.get("o"),
                "locationQuality": cp.get("l") or "reference_point_unknown",
                "w": cp.get("w") or "千代田区",
            })
            geometry = candidate["geometry"]

        for known_name, extra in KNOWN_REDEV_ENRICHMENT.items():
            if known_name in raw_name:
                props.update({
                    "address": extra["address"],
                    "areaHa": extra["areaHa"],
                    "grossFloorArea": extra["grossFloorArea"],
                    "uses": extra["uses"],
                    "urbanPlanDate": extra["urbanPlanDate"],
                    "sourceUrl": extra["officialUrl"],
                    "scale": scale_for(extra["grossFloorArea"]),
                })
                if geometry is None:
                    coords, quality = location_for(extra["address"], town_centroids, geocode_cache)
                    if coords:
                        geometry = {"type": "Point", "coordinates": coords}
                        props["locationQuality"] = quality

        if geometry is None:
            coords, town = town_point(raw_name, town_centroids)
            if coords:
                geometry = {"type": "Point", "coordinates": coords}
                props["locationQuality"] = "town_centroid"

        if geometry is None:
            ISSUES.append({"stage": "location", "name": raw_name, "reason": "No verified reference position"})
            continue

        props["scale"] = props.get("scale") or scale_for(props.get("grossFloorArea"))
        props["_category"] = "legal_redevelopment"
        props["_source_url"] = props["sourceUrl"]
        props["_data_quality"] = props["dataQuality"]

        if props["n"] in seen:
            continue
        seen.add(props["n"])
        features.append({"type": "Feature", "properties": props, "geometry": geometry})

    return features


def large_building_features(records, town_centroids, geocode_cache: Path):
    dedup = {}
    def page_order(item):
        match = re.search(r"/r([4-8])(\d{2})?\.html$", item["sourceUrl"])
        return (int(match[1]), int(match[2] or 12)) if match else (0, 0)
    for item in sorted(records, key=page_order, reverse=True):
        key = item.get("receptionNumber") or (compact(item["name"]) + "|" + compact(item["address"]))
        dedup.setdefault(key, item)

    features = []
    for item in dedup.values():
        if item["status"] == "完了" or item["grossFloorArea"] < MIN_GFA:
            continue
        if "市街地再開発事業" in item["name"]:
            continue
        coords, quality = location_for(item["address"], town_centroids, geocode_cache)
        if not coords:
            ISSUES.append({"stage": "location", "name": item["name"], "address": item["address"], "reason": "No verified reference position"})
            continue
        gfa = item["grossFloorArea"]
        props = {
            "n": item["name"],
            "w": "千代田区",
            "category": "large_building",
            "categoryLabel": "大規模建替え・新築",
            "status": item["status"],
            "address": item["address"],
            "uses": item.get("uses"),
            "constructionType": item.get("constructionType"),
            "completion": item.get("completion"),
            "grossFloorArea": gfa,
            "scale": scale_for(gfa),
            "receptionNumber": item.get("receptionNumber"),
            "locationQuality": quality,
            "sourceName": "千代田区 建築物環境計画書・評価書",
            "sourceUrl": item["sourceUrl"],
            "sourceDate": item.get("sourceDate"),
            "dataQuality": "official_table_derived_point",
            "_category": "large_building",
            "_source_url": item["sourceUrl"],
            "_data_quality": "official_table_derived_point",
        }
        props = {k: v for k, v in props.items() if v not in (None, "")}
        features.append({
            "type": "Feature",
            "properties": props,
            "geometry": {"type": "Point", "coordinates": coords},
        })
    return features


def proposal_features(html: str, town_centroids):
    soup = BeautifulSoup(html, "html.parser")
    heading = next((h for h in soup.find_all("h2") if "都市再生特別措置法等に基づく提案" in h.get_text()), None)
    if heading is None:
        ISSUES.append({"stage": "proposal", "reason": "Official current proposal section not identified"})
        return []
    table = None
    for sibling in heading.next_siblings:
        if getattr(sibling, "name", None) in ("h1", "h2", "h3"):
            break
        if getattr(sibling, "name", None) == "table":
            table = sibling
            break
    if table is None:
        ISSUES.append({"stage": "proposal", "reason": "Official current proposal table not identified"})
        return []
    features = []
    for hint in KNOWN_CHIYODA_PROPOSAL_HINTS:
        row = next((r for r in table.find_all("tr") if hint in r.get_text() and r.find("a", href=True)), None)
        if row is None:
            continue
        coords, town = town_point("神田錦町三丁目", town_centroids)
        if not coords:
            continue
        features.append({
            "type": "Feature",
            "properties": {
                "n": hint + "（都市計画提案）",
                "w": "千代田区",
                "category": "planning_proposal",
                "categoryLabel": "構想・都市計画提案",
                "status": "提案図書閲覧中（都市再生特別措置法等）",
                "scale": "unknown",
                "locationQuality": "town_centroid",
                "sourceName": "東京都 都市計画提案図書の閲覧",
                "sourceUrl": PROPOSAL_PAGE,
                "sourceDate": source_date(html),
                "proposalUrl": urljoin(PROPOSAL_PAGE, row.find("a", href=True)["href"]),
                "dataQuality": "official_current_proposal_derived_point",
                "_category": "planning_proposal",
                "_source_url": PROPOSAL_PAGE,
                "_data_quality": "official_current_proposal_derived_point",
            },
            "geometry": {"type": "Point", "coordinates": coords},
        })
    return features


def adjacent_redevelopment_features():
    data = json.loads(EXISTING_REDEV.read_text(encoding="utf-8"))
    snapshot = json.loads((ROOT / "scripts/data/redevelopment-projects.json").read_text(encoding="utf-8"))
    features = []
    for feature in data["features"]:
        p = feature["properties"]
        if "千代田区" in str(p.get("w", "")):
            continue
        features.append({"type": "Feature", "geometry": feature["geometry"], "properties": {
            "n": p["n"], "w": p["w"], "category": "legal_redevelopment", "categoryLabel": "市街地再開発",
            "status": f"{p.get('s', '事業中')}（{snapshot['asOf']}時点）", "operator": p.get("o"),
            "areaHa": p.get("a"), "urbanPlanDate": p.get("d"), "approvalDate": p.get("p"),
            "locationQuality": p.get("l") or "reference_point_unknown", "scale": "unknown",
            "sourceDate": snapshot["asOf"], "sourceName": "東京都 市街地再開発事業（既存スナップショット）",
            "sourceUrl": snapshot["source"], "_source_url": snapshot["source"], "_data_quality": "official_existing_snapshot",
        }})
    return features


def update_search_index(path=None):
    path = path or ROOT / "public/data/map-data.json"
    core = json.loads(path.read_text(encoding="utf-8"))
    data = json.loads(OUTPUT.read_text(encoding="utf-8"))
    kind = next(i for i, t in enumerate(core["searchTypes"]) if t["d"] == "redevelopment")
    core["searchTypes"][kind]["k"] = "都市更新"
    core["search"] = [item for item in core["search"] if item[2] != kind]
    core["search"].extend([[f["properties"]["n"], f["properties"]["w"], kind, i] for i, f in enumerate(data["features"])])
    core["meta"]["redevelopmentCount"] = len(data["features"])
    core["meta"]["urbanChangeDate"] = max(f["properties"].get("retrievedDate", "") for f in data["features"])
    path.write_text(json.dumps(core, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-root", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--fetch-only", action="store_true", help="Cache only the supplied official pages for validation")
    args = parser.parse_args()

    cache = args.cache_root
    pages_cache = cache / "pages"
    geocode_cache = cache / "geocode"
    town_centroids = load_town_centroids()

    env_index = fetch_text(ENV_INDEX, pages_cache / "env-index.html", args.force)
    urls = env_pages(env_index)
    if not urls:
        raise ValueError("Official environmental-plan annual pages could not be found")

    all_building_records = []
    parsed_pages = []
    for idx, url in enumerate(urls):
        filename = f"env-{idx:02d}-{url.rsplit('/', 1)[-1]}"
        html = fetch_text(url, pages_cache / filename, args.force)
        records = parse_env_page(url, html)
        all_building_records.extend(records)
        parsed_pages.append({"url": url, "records": len(records)})

    redev_html = fetch_text(REDEV_PAGE, pages_cache / "redevelopment.html", args.force)
    proposal_html = fetch_text(PROPOSAL_PAGE, pages_cache / "planning-proposals.html", args.force)
    if args.fetch_only:
        print(json.dumps({"environmentPages": parsed_pages, "rawLargeBuildingRecords": len(all_building_records)}, ensure_ascii=False, indent=2))
        return

    redev = redevelopment_features(redev_html, town_centroids, geocode_cache)
    buildings = large_building_features(all_building_records, town_centroids, geocode_cache)
    proposals = proposal_features(proposal_html, town_centroids)

    adjacent = adjacent_redevelopment_features()
    features = redev + buildings + proposals + adjacent
    category_order = {"legal_redevelopment": 0, "planning_proposal": 1, "large_building": 2}
    features.sort(key=lambda f: (
        category_order.get(f["properties"].get("category"), 9),
        -float(f["properties"].get("grossFloorArea") or 0),
        str(f["properties"].get("n") or ""),
    ))
    for feature in features:
        p = feature["properties"]
        p["i"] = "urban-change:" + hashlib.sha256((p["category"] + "|" + p["n"] + "|" + p["w"]).encode("utf-8")).hexdigest()[:16]
        if "千代田区" in p["w"]:
            p["retrievedDate"] = str(date.today())

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps({"type": "FeatureCollection", "features": features},
                   ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    report = {
        "generated": str(date.today()),
        "environmentPages": parsed_pages,
        "rawLargeBuildingRecords": len(all_building_records),
        "currentRedevelopmentCount": len(redev),
        "largeBuildingCount": len(buildings),
        "planningProposalCount": len(proposals),
        "totalFeatureCount": len(features),
        "thresholdGrossFloorAreaSqm": MIN_GFA,
        "adjacentRedevelopmentCount": len(adjacent),
        "issues": ISSUES,
        "output": "public/data/layers/urban-change-projects.json",
        "cacheRoot": "../work/chiyoda_map/data/next-stage/urban-change",
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    update_search_index()
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
