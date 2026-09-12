#!/usr/bin/env python3
"""Discover and export Chiyoda's official district-plan internal subareas.

Chiyoda reports that GIS data for district-plan internal divisions was completed
for all 40 district plans by FY2024. This script queries the official ArcGIS
MapServer and exports only polygon layers that safely look like internal
district-plan divisions (A地区/B地区 etc.).

Safety:
- never substitute the outer district-plan boundary for internal divisions;
- never digitize PDF maps;
- if no safe candidate is found, write only a discovery report.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
import requests
from collections import defaultdict
from shapely import set_precision, orient_polygons
from shapely.geometry import shape, mapping

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CACHE = ROOT.parent / "work" / "chiyoda_map" / "data" / "next-stage" / "planning"
SERVER = "https://tokei-gis2.chiyodatoshikei.jp/server/rest/services/Map_services/chikukeikaku/MapServer"
OUTPUT = ROOT / "public/data/layers/district-plan-subareas.json"

SUBAREA_VALUE = re.compile(
    r"(?:[A-ZＡ-Ｚ][0-9０-９\-－]*|第[一二三四五六七八九十]+|"
    r"(?:東|西|南|北|中央|沿道|駅前|街区)[^ ]{0,12})(?:地区|街区|区域)"
)
FIELD_HINT = re.compile(r"地区.*(?:区分|名称|名)|(?:区分|街区).*名称|地区区分")


def get_json(url: str, params=None, timeout=90):
    params = dict(params or {})
    params["f"] = "json"
    response = requests.get(url, params=params, timeout=timeout)
    response.raise_for_status()
    data = response.json()
    if "error" in data:
        raise RuntimeError(data["error"])
    return data


def layer_tree():
    return get_json(f"{SERVER}/layers").get("layers", [])


def parent_chain(layer, by_id):
    names = []
    current = layer
    seen = set()
    while current:
        parent = current.get("parentLayer")
        if not parent or parent.get("id", -1) < 0:
            break
        pid = parent["id"]
        if pid in seen:
            break
        seen.add(pid)
        p = by_id.get(pid)
        if not p:
            names.append(str(parent.get("name") or ""))
            break
        names.append(str(p.get("name") or ""))
        current = p
    return names


def query_geojson(layer_id: int):
    response = requests.get(
        f"{SERVER}/{layer_id}/query",
        params={
            "where": "1=1",
            "outFields": "*",
            "returnGeometry": "true",
            "outSR": "4326",
            "f": "geojson",
        },
        timeout=120,
    )
    response.raise_for_status()
    return response.json()


def score_layer(layer_info, sample_fc):
    props = [f.get("properties", {}) for f in sample_fc.get("features", [])[:300]]
    field_names = " ".join(str(f.get("name", "")) + " " + str(f.get("alias", ""))
                           for f in (layer_info.get("fields") or []))
    field_signal = bool(FIELD_HINT.search(field_names))

    matched_values = set()
    for p in props:
        for value in p.values():
            text = str(value or "")
            for m in SUBAREA_VALUE.finditer(text):
                matched_values.add(m.group(0))

    return {
        "fieldSignal": field_signal,
        "matchedValues": sorted(matched_values),
        "score": (5 if field_signal else 0) + min(len(matched_values), 20),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-root", type=Path, default=DEFAULT_CACHE)
    args = parser.parse_args()

    layers = layer_tree()
    by_id = {x["id"]: x for x in layers}
    report = {
        "server": SERVER,
        "rule": (
            "verified layer 6 with dedicated 区分 + parent 名称 mapping, complete Object IDs and valid polygons; empty divisions excluded"
        ),
        "candidates": [],
        "accepted": [],
    }
    merged = []

    for layer in layers:
        lid = layer["id"]
        chain = parent_chain(layer, by_id)
        hierarchy = " / ".join(chain + [str(layer.get("name", ""))])
        if "地区計画" not in hierarchy:
            continue

        try:
            info = get_json(f"{SERVER}/{lid}")
        except Exception:
            continue
        if info.get("type") != "Feature Layer":
            continue
        if info.get("geometryType") != "esriGeometryPolygon":
            continue

        try:
            fc = query_geojson(lid)
        except Exception as exc:
            report["candidates"].append({
                "id": lid, "name": layer.get("name"), "error": str(exc)
            })
            continue

        if fc.get("type") != "FeatureCollection" or not fc.get("features"):
            continue

        scored = score_layer(info, fc)
        entry = {
            "id": lid,
            "name": layer.get("name"),
            "hierarchy": hierarchy,
            "featureCount": len(fc["features"]),
            **scored,
        }
        report["candidates"].append(entry)

        # 採点は探索用。確認済みの専用「区分」字段と親計画の対応でのみ採用。
        field_names = {f.get("name") for f in (info.get("fields") or [])}
        by_plan = defaultdict(set)
        for feature in fc["features"]:
            p = feature.get("properties") or {}
            if p.get("名称") and str(p.get("区分") or "").strip():
                by_plan[str(p["名称"])].add(str(p["区分"]))
        safe = lid == 6 and {"名称", "区分", "OBJECTID"}.issubset(field_names) and any(len(values) >= 2 for values in by_plan.values())
        if not safe:
            entry["rejected"] = "No verified dedicated division field and parent-plan mapping"
            continue
        ids = get_json(f"{SERVER}/{lid}/query", {"where": "1=1", "returnIdsOnly": "true"}).get("objectIds")
        exported_ids = [f["properties"].get("OBJECTID") for f in fc["features"]]
        if ids is None or len(ids) != len(exported_ids) or set(ids) != set(exported_ids):
            entry["rejected"] = "Incomplete Object ID export"
            continue
        geometries = [shape(f["geometry"]) for f in fc["features"]]
        if any(g.geom_type not in ("Polygon", "MultiPolygon") or g.is_empty or not g.is_valid for g in geometries):
            entry["rejected"] = "Invalid or missing polygon geometry"
            continue
        raw_path = args.cache_root / f"district-plan-subareas-layer-{lid}.geojson"
        raw_path.parent.mkdir(parents=True, exist_ok=True)
        raw_path.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        entry["sourceFeatureCount"] = len(exported_ids)
        entry["excludedOuterCount"] = 0

        for feature in fc["features"]:
            props = feature.setdefault("properties", {})
            if not str(props.get("区分") or "").strip():
                entry["excludedOuterCount"] += 1
                continue
            props["n"] = str(props["区分"])
            props["planName"] = str(props["名称"])
            props["i"] = f"district-subarea:{lid}:{props['OBJECTID']}"
            feature["geometry"] = mapping(orient_polygons(set_precision(shape(feature["geometry"]), 0.000001)))
            props["_source_layer_id"] = lid
            props["_source_layer_name"] = str(layer.get("name") or "")
            props["_source_url"] = f"{SERVER}/{lid}"
            props["_data_quality"] = "official_gis"
            props["_dataset"] = "districtPlanSubareas"
            merged.append(feature)

        entry["featureCount"] = len(exported_ids) - entry["excludedOuterCount"]
        entry["planCount"] = len(by_plan)
        report["accepted"].append(entry)

    report_path = args.cache_root / "district-plan-subareas-discovery.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    if not merged:
        print("No safe internal district-plan division layer found.")
        print("Report:", report_path)
        return

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps({"type": "FeatureCollection", "features": merged},
                   ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print("wrote:", OUTPUT)
    print("features:", len(merged))
    print("accepted layers:", len(report["accepted"]))


if __name__ == "__main__":
    main()
