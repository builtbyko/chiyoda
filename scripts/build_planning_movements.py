#!/usr/bin/env python3
"""Build a lightweight 'planning movements' point layer from curated official metadata.

This is deliberately NOT an exhaustive project database. It shows selected
current planning/policy movements that precede or accompany physical urban
change. Locations are town representative points unless an existing official
feature can later replace them.
"""

from __future__ import annotations

import json
from pathlib import Path
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = ROOT / "scripts/data/planning-movements-registry.json"
TOWNS = ROOT / "public/data/layers/towns.json"
OUTPUT = ROOT / "public/data/layers/planning-movements.json"


def norm(text):
    return str(text or "").replace("東京都千代田区", "").replace("千代田区", "").replace(" ", "").replace("　", "")


def town_points():
    data = json.loads(TOWNS.read_text(encoding="utf-8"))
    out = []
    for feature in data.get("features", []):
        p = feature.get("properties", {})
        if p.get("w") and p.get("w") != "千代田区":
            continue
        name = str(p.get("n") or p.get("name") or "")
        if not name:
            continue
        g = shape(feature["geometry"])
        pt = g.representative_point()
        out.append((name, [pt.x, pt.y]))
    return sorted(out, key=lambda x: len(x[0]), reverse=True)


def resolve(anchor, points):
    a = norm(anchor)
    exactish = []
    for name, coords in points:
        n = norm(name)
        if n == a or a in n or n in a:
            exactish.append((len(n), name, coords))
    if exactish:
        exactish.sort(reverse=True)
        _, name, coords = exactish[0]
        return coords, name
    return None, None


def main():
    registry = json.loads(REGISTRY.read_text(encoding="utf-8"))
    points = town_points()
    features = []
    unresolved = []

    for item in registry["items"]:
        coords, matched_town = resolve(item["anchorTown"], points)
        if not coords:
            unresolved.append(item["id"])
            continue

        props = dict(item)
        props["n"] = item["name"]
        props["locationQuality"] = "town_centroid"
        props["matchedTown"] = matched_town
        props["anchorResolution"] = "exact_town" if norm(item["anchorTown"]) == norm(matched_town) else "town_name_only"
        props["_coordinate_quality"] = "town_representative_point"
        props["_source_url"] = item["sourceUrl"]
        props["_data_quality"] = item["dataQuality"]
        props["_dataset"] = "planningMovements"

        features.append({
            "type": "Feature",
            "properties": props,
            "geometry": {"type": "Point", "coordinates": coords},
        })

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps({"type":"FeatureCollection","features":features},
                   ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print("features:", len(features))
    print("unresolved:", unresolved)


if __name__ == "__main__":
    main()
