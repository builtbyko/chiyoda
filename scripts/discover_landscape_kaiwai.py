#!/usr/bin/env python3
"""Discover the official 12 landscape-kaiwai layer from Chiyoda ArcGIS.

Safety rule:
- Partial place-name matches discover candidates only. Publication requires an
  explicit landscape-kaiwai dataset, a dedicated name field, all 12 exact names,
  and a complete, valid polygon export.
- Never accept the existing 3-region landscape-plan layer as a substitute.
- Never digitize the PDF automatically.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from urllib.parse import quote

import requests
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CACHE = ROOT.parent / "work" / "chiyoda_map" / "data" / "next-stage"
OUTPUT = ROOT / "public/data/layers/landscape-kaiwai.json"
REPORT = "chiyoda/arcgis/landscape-kaiwai-discovery.json"

SERVER_ROOT = "https://tokei-gis2.chiyodatoshikei.jp/server/rest/services"
PORTAL_ROOT = "https://tokei-gis2.chiyodatoshikei.jp/toshikei/sharing/rest"

AREAS = [
    ("皇居界隈", ["皇居"]),
    ("大手町・丸の内・有楽町界隈", ["大手町", "丸の内", "有楽町"]),
    ("霞が関・永田町界隈", ["霞が関", "永田町"]),
    ("千鳥ヶ淵界隈", ["千鳥ヶ淵", "千鳥ケ淵", "千鳥"]),
    ("九段・竹橋界隈", ["九段", "竹橋"]),
    ("紀尾井町界隈", ["紀尾井町"]),
    ("麹町・番町界隈", ["麹町", "麴町", "番町"]),
    ("飯田橋・富士見界隈", ["飯田橋", "富士見"]),
    ("神保町・三崎町界隈", ["神保町", "三崎町", "神田三崎町"]),
    ("御茶ノ水・駿河台界隈", ["御茶ノ水", "駿河台"]),
    ("神田界隈", ["神田"]),
    ("外神田・秋葉原界隈", ["外神田", "秋葉原"]),
]


REGIONS = {
    "皇居界隈": "美観地域",
    "大手町・丸の内・有楽町界隈": "美観地域",
    "霞が関・永田町界隈": "美観地域",
    "千鳥ヶ淵界隈": "美観地域",
    "九段・竹橋界隈": "美観地域",
    "紀尾井町界隈": "麹町地域",
    "麹町・番町界隈": "麹町地域",
    "飯田橋・富士見界隈": "麹町地域",
    "神保町・三崎町界隈": "神田地域",
    "御茶ノ水・駿河台界隈": "神田地域",
    "神田界隈": "神田地域",
    "外神田・秋葉原界隈": "神田地域",
}


def official_name_from_properties(props):
    # 地名の部分一致は候補探索だけに使用し、正式名称の一致でのみ採用する。
    names = {re.sub(r"\s+", "", name): name for name, _ in AREAS}
    for value in props.values():
        name = names.get(re.sub(r"\s+", "", str(value)))
        if name:
            return name
    return None

KNOWN_NOT_12 = {
    "https://tokei-gis2.chiyodatoshikei.jp/server/rest/services/Map_services/keikankeikakukubun/MapServer/2"
}


def get_json(url: str, params=None, timeout=60):
    params = dict(params or {})
    params["f"] = "json"
    response = requests.get(url, params=params, timeout=timeout)
    response.raise_for_status()
    value = response.json()
    if "error" in value:
        raise RuntimeError(value["error"])
    return value


def list_service_folders():
    root = get_json(SERVER_ROOT)
    folders = [""] + list(root.get("folders", []))
    # Only public app-data folders are relevant; skip system folders.
    skip = {"Utilities", "tools", "Test"}
    return [f for f in folders if f not in skip]


def list_services(folder: str):
    url = SERVER_ROOT if not folder else f"{SERVER_ROOT}/{quote(folder)}"
    try:
        value = get_json(url)
    except Exception:
        return []
    return value.get("services", [])


def service_url(service: dict):
    name = service["name"]
    typ = service["type"]
    return f"{SERVER_ROOT}/{quote(name, safe='/')}/{typ}"


def sample_layer(layer_url: str):
    info = get_json(layer_url)
    if info.get("type") != "Feature Layer":
        return info, []
    params = {
        "where": "1=1",
        "outFields": "*",
        "returnGeometry": "false",
        "resultRecordCount": 200,
    }
    try:
        sample = get_json(f"{layer_url}/query", params)
        return info, sample.get("features", [])
    except Exception:
        return info, []


def flatten_text(features):
    chunks = []
    for feature in features:
        for key, value in (feature.get("attributes") or {}).items():
            if value is None:
                continue
            chunks.append(str(key))
            chunks.append(str(value))
    return " ".join(chunks)


def score_text(text: str):
    matches = []
    for name, keywords in AREAS:
        # For multi-part names, one distinctive token is enough for discovery.
        if any(token in text for token in keywords):
            matches.append(name)
    return matches


def portal_search():
    queries = [
        "界隈",
        "景観 界隈",
        "景観まちづくりガイドライン",
        "界隈別",
    ]
    results = []
    for q in queries:
        try:
            value = get_json(
                f"{PORTAL_ROOT}/search",
                {"q": q, "num": 100},
            )
            for item in value.get("results", []):
                results.append({
                    "query": q,
                    "id": item.get("id"),
                    "title": item.get("title"),
                    "type": item.get("type"),
                    "url": item.get("url"),
                    "tags": item.get("tags"),
                })
        except Exception as exc:
            results.append({"query": q, "error": str(exc)})
    # de-dupe
    unique = {}
    for item in results:
        key = item.get("id") or json.dumps(item, ensure_ascii=False, sort_keys=True)
        unique[key] = item
    return list(unique.values())


def export_geojson(layer_url: str):
    params = {
        "where": "1=1",
        "outFields": "*",
        "returnGeometry": "true",
        "outSR": "4326",
        "f": "geojson",
    }
    response = requests.get(f"{layer_url}/query", params=params, timeout=120)
    response.raise_for_status()
    fc = response.json()
    if fc.get("type") != "FeatureCollection":
        raise RuntimeError("not GeoJSON FeatureCollection")
    return fc


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-root", type=Path, default=DEFAULT_CACHE)
    args = parser.parse_args()

    report = {
        "serverRoot": SERVER_ROOT,
        "portalRoot": PORTAL_ROOT,
        "knownNonTarget": list(KNOWN_NOT_12),
        "portalSearch": portal_search(),
        "layers": [],
        "accepted": None,
        "rule": "discovery: polygon + >=10/12 place-name matches; publication: explicit landscape-kaiwai dataset + dedicated field + exact 12/12 names + complete valid polygon export",
    }

    candidates = []
    for folder in list_service_folders():
        for service in list_services(folder):
            if service.get("type") not in ("MapServer", "FeatureServer"):
                continue
            s_url = service_url(service)
            try:
                s_info = get_json(s_url)
            except Exception as exc:
                continue
            for layer in s_info.get("layers", []):
                layer_url = f"{s_url}/{layer['id']}"
                if layer_url in KNOWN_NOT_12:
                    continue
                try:
                    info, sample = sample_layer(layer_url)
                except Exception:
                    continue
                text = " ".join([
                    str(info.get("name", "")),
                    str(info.get("displayField", "")),
                    *(str(f.get("name", "")) for f in (info.get("fields") or [])),
                    flatten_text(sample),
                ])
                matches = score_text(text)
                entry = {
                    "url": layer_url,
                    "name": info.get("name"),
                    "geometryType": info.get("geometryType"),
                    "datasetDescription": " ".join(str(value or "") for value in [info.get("name"), info.get("description"), s_info.get("description"), s_info.get("serviceDescription"), service.get("name")]),
                    "fields": [
                        {"name": f.get("name"), "alias": f.get("alias")}
                        for f in (info.get("fields") or [])
                    ],
                    "matchedKaiwai": matches,
                    "score": len(matches),
                }
                if len(matches) or "界隈" in text or "景観" in text:
                    report["layers"].append(entry)
                if info.get("geometryType") == "esriGeometryPolygon" and len(matches) >= 10:
                    candidates.append(entry)

    candidates.sort(key=lambda x: x["score"], reverse=True)

    report["candidateChecks"] = []
    for best in candidates:
        # 公園・町丁目等を界隈と誤認しない。界隈字段と正式12名称を確認する。
        fields = best["fields"]
        name_fields = [f["name"] for f in fields if "界隈" in str(f.get("name")) + str(f.get("alias"))]
        if not name_fields:
            report["candidateChecks"].append({"url": best["url"], "rejected": "No explicit kaiwai field"})
            continue
        if not all(token in best["datasetDescription"] for token in ["景観", "界隈"]):
            report["candidateChecks"].append({"url": best["url"], "rejected": "Dataset description does not identify landscape kaiwai"})
            continue
        try:
            ids = get_json(f"{best['url']}/query", {"where": "1=1", "returnIdsOnly": "true"}).get("objectIds")
            fc = export_geojson(best["url"])
        except Exception as exc:
            report["candidateChecks"].append({"url": best["url"], "rejected": str(exc)})
            continue
        features = fc.get("features", [])
        official_names = [official_name_from_properties({key: (f.get("properties") or {}).get(key) for key in name_fields}) for f in features]
        if (not features or ids is None or len(features) != len(ids)
                or any((f.get("geometry") or {}).get("type") not in ("Polygon", "MultiPolygon") for f in features)
                or None in official_names or set(official_names) != {name for name, _ in AREAS}):
            report["candidateChecks"].append({"url": best["url"], "rejected": "Incomplete polygon export or not exactly the official 12 names", "names": official_names})
            continue
        geometries = [shape(f["geometry"]) for f in features]
        if any(g.is_empty or not g.is_valid or not (139 < g.bounds[0] <= g.bounds[2] < 140 and 35 < g.bounds[1] <= g.bounds[3] < 36) for g in geometries):
            report["candidateChecks"].append({"url": best["url"], "rejected": "Invalid, empty or out-of-area geometry"})
            continue

        # Tag provenance and stable aliases while preserving official attributes.
        for feature, official_name in zip(features, official_names):
            props = feature.setdefault("properties", {})
            if official_name:
                props["n"] = official_name
                props["region"] = REGIONS[official_name]
            props["_source_url"] = best["url"]
            props["_data_quality"] = "official_gis"
            props["_dataset"] = "landscapeKaiwai"

        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(
            json.dumps(fc, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        report["accepted"] = {
            **best,
            "output": str(OUTPUT.relative_to(ROOT)),
            "featureCount": len(fc.get("features", [])),
        }
        break

    report_path = args.cache_root / REPORT
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print("report:", report_path)
    if report["accepted"]:
        print("accepted:", report["accepted"]["url"])
        print("output:", OUTPUT)
    else:
        print("No official 12-kaiwai layer safely identified; no public layer created.")


if __name__ == "__main__":
    main()
