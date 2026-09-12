#!/usr/bin/env python3
"""Normalize the official Chiyoda river-space SHP and inspect usable river names.

This script does NOT invent guideline zone boundaries. If the source attributes
allow safe identification of Nihonbashi River, Kanda River and Sotobori, it
writes a lightweight GeoJSON with guideline metadata. Otherwise it writes an
inspection report only.
"""

from __future__ import annotations

import json
import math
import re
import unicodedata
from pathlib import Path

import geopandas as gpd
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT.parent / "work" / "chiyoda_map" / "data" / "next-stage"
SOURCE_DIR = CACHE / "chiyoda/river/river-space"
OUTPUT = ROOT / "public/data/layers/river-guideline.json"
REPORT = ROOT / "scripts/data/river-source-schema.json"
META = ROOT / "scripts/data/river-guideline-metadata.json"

TARGETS = {
    "日本橋川": "日本橋川エリア",
    "神田川": "神田川エリア",
    "外濠": "外濠エリア",
}
NAME_HINTS = ("名称", "河川", "水路", "name", "NAME")


def clean(value):
    try:
        if pd.isna(value):
            return None
    except Exception:
        pass
    if value is None:
        return None
    if hasattr(value, "item"):
        try:
            value = value.item()
        except Exception:
            pass
    if isinstance(value, str):
        return unicodedata.normalize("NFKC", value).strip()
    if isinstance(value, (int, float, bool, str)):
        return value
    return str(value)


def find_name_field(columns):
    for hint in NAME_HINTS:
        for col in columns:
            if hint.lower() in str(col).lower():
                return col
    return None


def main():
    shapefiles = sorted(SOURCE_DIR.rglob("*.shp"))
    if not shapefiles:
        raise SystemExit(
            f"No shapefile under {SOURCE_DIR}. Run fetch_next_stage_sources.py first."
        )

    frames = []
    for shp in shapefiles:
        frame = None
        error = None
        for encoding in ("utf-8", "cp932", "shift_jis"):
            try:
                frame = gpd.read_file(shp, encoding=encoding)
                break
            except Exception as exc:
                error = exc
        if frame is None:
            raise RuntimeError(f"{shp}: {error}")
        if frame.crs is None:
            raise RuntimeError(f"{shp.name}: missing CRS; refusing to guess river coordinates")
        frame = frame.to_crs("EPSG:4326")
        frame["_source_file"] = shp.name
        frames.append(frame)

    gdf = gpd.GeoDataFrame(
        pd.concat(frames, ignore_index=True),
        geometry="geometry",
        crs="EPSG:4326",
    )

    schema = {
        "featureCount": len(gdf),
        "geometryTypes": gdf.geometry.geom_type.value_counts().to_dict(),
        "columns": {},
    }
    for col in gdf.columns:
        if col == "geometry":
            continue
        values = [clean(v) for v in gdf[col].tolist()]
        values = [v for v in values if v not in (None, "")]
        schema["columns"][str(col)] = {
            "samples": list(dict.fromkeys(map(str, values)))[:10],
        }

    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(schema, ensure_ascii=False, indent=2), encoding="utf-8")

    name_field = find_name_field(gdf.columns)
    if not name_field:
        print("No safe river-name field detected. Inspection report only:", REPORT)
        return

    metadata = json.loads(META.read_text(encoding="utf-8"))
    area_meta = {a["name"].replace("エリア", ""): a for a in metadata["areas"]}

    features = []
    for _, row in gdf.iterrows():
        river_name = clean(row.get(name_field))
        if not river_name:
            continue

        target_key = None
        for key in TARGETS:
            if key in str(river_name):
                target_key = key
                break
        if not target_key:
            continue

        area_name = TARGETS[target_key]
        area = next((x for x in metadata["areas"] if x["name"] == area_name), {})
        props = {
            "n": area_name,
            "river": target_key,
            "scope": area.get("scope"),
            "vision": metadata.get("vision"),
            "source": metadata.get("source"),
            "data_quality": "official_gis_plus_guideline_metadata",
            "note": (
                "河川形状は千代田区公式GIS。ガイドラインの厳密な対象区間・200m範囲を"
                "ポリゴン化したものではありません。"
            ),
        }
        features.append({
            "type": "Feature",
            "properties": props,
            "geometry": row.geometry.__geo_interface__,
        })

    if not features:
        print("Target rivers not safely matched. Inspection report only:", REPORT)
        return

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps({"type": "FeatureCollection", "features": features},
                   ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print("wrote", OUTPUT, "features:", len(features))


if __name__ == "__main__":
    main()
