#!/usr/bin/env python3
"""Discover Chiyoda City's public ArcGIS services without publishing their data.

This is a research/cache helper. It enumerates Map_services, records layer names,
fields and query capabilities, and optionally exports *candidate* layers to the
external work cache for inspection. Do not copy candidates into public/data
until reuse terms have been checked.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from urllib.parse import quote
import requests

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CACHE = ROOT.parent / "work" / "chiyoda_map" / "data" / "next-stage"
FOLDER = "https://tokei-gis2.chiyodatoshikei.jp/server/rest/services/Map_services"

KEYWORDS = re.compile(
    r"道路台帳|道路幅員|認定幅員|現況幅員|道路名称|路線|管理者|界隈|景観.*界隈",
    re.I,
)


def get_json(url: str, params=None):
    params = dict(params or {})
    params["f"] = "json"
    response = requests.get(url, params=params, timeout=60)
    response.raise_for_status()
    return response.json()


def safe_name(value: str) -> str:
    value = re.sub(r"[^\wぁ-んァ-ヶ一-龠ー.-]+", "-", value, flags=re.UNICODE)
    return value.strip("-")[:100] or "layer"


def export_geojson(layer_url: str, output: Path) -> dict:
    # ArcGIS Feature Layer query; use outSR=4326 and page until exhausted.
    info = get_json(layer_url)
    max_count = int(info.get("maxRecordCount") or 1000)
    offset = 0
    all_features = []
    while True:
        params = {
            "where": "1=1",
            "outFields": "*",
            "returnGeometry": "true",
            "outSR": "4326",
            "resultOffset": offset,
            "resultRecordCount": max_count,
            "f": "geojson",
        }
        response = requests.get(f"{layer_url}/query", params=params, timeout=120)
        response.raise_for_status()
        fc = response.json()
        features = fc.get("features", [])
        all_features.extend(features)
        if len(features) < max_count:
            break
        offset += len(features)
    result = {"type": "FeatureCollection", "features": all_features}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(result, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    return {"featureCount": len(all_features), "path": str(output)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-root", type=Path, default=DEFAULT_CACHE)
    parser.add_argument(
        "--export-candidates",
        action="store_true",
        help="Export matched public Feature Layers to external cache for inspection only.",
    )
    args = parser.parse_args()

    catalog = get_json(FOLDER)
    report = {
        "server": FOLDER,
        "services": [],
        "candidates": [],
        "warning": (
            "Candidate exports are for local inspection only. "
            "Do not republish road-ledger data until reuse terms are confirmed."
        ),
    }

    for service in catalog.get("services", []):
        if service.get("type") not in ("MapServer", "FeatureServer"):
            continue
        service_name = service["name"]
        # Folder listing often returns Map_services/foo; avoid doubling folder.
        short_name = service_name.split("/", 1)[-1]
        url = f"{FOLDER}/{quote(short_name)}/{service['type']}"
        try:
            info = get_json(url)
        except Exception as exc:
            report["services"].append({"name": service_name, "error": str(exc)})
            continue

        service_entry = {
            "name": service_name,
            "url": url,
            "layers": [],
        }

        for layer in info.get("layers", []):
            layer_url = f"{url}/{layer['id']}"
            try:
                layer_info = get_json(layer_url)
            except Exception as exc:
                service_entry["layers"].append({
                    "id": layer.get("id"),
                    "name": layer.get("name"),
                    "error": str(exc),
                })
                continue

            fields = [
                {"name": f.get("name"), "alias": f.get("alias"), "type": f.get("type")}
                for f in (layer_info.get("fields") or [])
            ]
            layer_entry = {
                "id": layer.get("id"),
                "name": layer.get("name"),
                "url": layer_url,
                "type": layer_info.get("type"),
                "geometryType": layer_info.get("geometryType"),
                "supportedQueryFormats": layer_info.get("supportedQueryFormats"),
                "maxRecordCount": layer_info.get("maxRecordCount"),
                "fields": fields,
            }
            service_entry["layers"].append(layer_entry)

            searchable = " ".join(
                [str(layer.get("name", ""))]
                + [str(f.get("name", "")) for f in fields]
                + [str(f.get("alias", "")) for f in fields]
            )
            if KEYWORDS.search(searchable):
                candidate = dict(layer_entry)
                candidate["service"] = service_name
                if args.export_candidates and layer_info.get("type") == "Feature Layer":
                    try:
                        output = (
                            args.cache_root
                            / "chiyoda/arcgis/candidates"
                            / f"{safe_name(short_name)}-{layer['id']}-{safe_name(layer['name'])}.geojson"
                        )
                        candidate["export"] = export_geojson(layer_url, output)
                    except Exception as exc:
                        candidate["exportError"] = str(exc)
                report["candidates"].append(candidate)

        report["services"].append(service_entry)

    destination = args.cache_root / "chiyoda/arcgis/service-catalog.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"wrote {destination}")
    print(f"candidate layers: {len(report['candidates'])}")
    for item in report["candidates"]:
        print("-", item["service"], "/", item["id"], item["name"])


if __name__ == "__main__":
    main()
