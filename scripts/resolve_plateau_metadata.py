#!/usr/bin/env python3
"""Resolve current Tokyo 23 wards PLATEAU resource metadata without large downloads."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CACHE = ROOT.parent / "work" / "chiyoda_map" / "data" / "next-stage"
API = "https://www.geospatial.jp/ckan/api/3/action/package_show"
DATASET = "plateau-tokyo23ku"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-root", type=Path, default=DEFAULT_CACHE)
    args = parser.parse_args()

    response = requests.get(API, params={"id": DATASET}, timeout=90)
    response.raise_for_status()
    payload = response.json()
    if not payload.get("success"):
        raise RuntimeError(payload)

    package = payload["result"]
    resources = []
    for resource in package.get("resources", []):
        resources.append({
            "name": resource.get("name"),
            "format": resource.get("format"),
            "url": resource.get("url"),
            "size": resource.get("size"),
            "last_modified": resource.get("last_modified"),
            "metadata_modified": resource.get("metadata_modified"),
            "description": resource.get("description"),
        })

    summary = {
        "dataset": package.get("title"),
        "name": package.get("name"),
        "metadata_modified": package.get("metadata_modified"),
        "resources": resources,
        "note": (
            "Do not automatically download. Choose a resource only if a future "
            "self-hosted/latest building-height layer is required."
        ),
    }

    output = args.cache_root / "plateau/metadata/resources-summary.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(output)
    for index, resource in enumerate(resources):
        print(index, resource["format"], resource["name"], resource["size"])


if __name__ == "__main__":
    main()
