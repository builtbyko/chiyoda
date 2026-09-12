#!/usr/bin/env python3
"""Build Chiyoda station-entrance and underground pedestrian reference layers from OSM.

Data quality:
- OpenStreetMap / ODbL, not an official Chiyoda or railway-operator dataset.
- Intended for personal urban-study use in CHiYODA ATLAS.
- Geometry completeness varies by station.

The script clips results to the existing CHiYODA ATLAS Chiyoda city polygon.
"""

from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

import requests
from shapely.geometry import Point, LineString, shape, mapping
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CACHE = ROOT.parent / "work" / "chiyoda_map" / "data" / "next-stage"
MAP_DATA = ROOT / "public/data/map-data.json"
EXIT_OUTPUT = ROOT / "public/data/layers/station-entrances.json"
UNDERGROUND_OUTPUT = ROOT / "public/data/layers/underground-walkways.json"

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

# Broader than Chiyoda; final clip uses ATLAS city polygon.
BBOX = (35.665, 139.725, 35.710, 139.790)

QUERY = r"""
[out:json][timeout:120];
(
  node["railway"="subway_entrance"]({s},{w},{n},{e});
  node["entrance"]["public_transport"="platform"]({s},{w},{n},{e});
  way["highway"="footway"]["tunnel"="yes"]({s},{w},{n},{e});
  way["highway"="footway"]["indoor"="yes"]({s},{w},{n},{e});
  way["highway"="corridor"]({s},{w},{n},{e});
  way["indoor"="corridor"]({s},{w},{n},{e});
  way["highway"="footway"]["layer"~"^-[0-9]+$"]({s},{w},{n},{e});
);
out tags geom;
"""


def load_city():
    data = json.loads(MAP_DATA.read_text(encoding="utf-8"))
    city = data.get("city")
    if not city:
        raise RuntimeError("public/data/map-data.json has no city feature")
    return shape(city["geometry"])


def fetch_overpass():
    s, w, n, e = BBOX
    query = QUERY.format(s=s, w=w, n=n, e=e)
    errors = []
    for endpoint in OVERPASS_ENDPOINTS:
        try:
            response = requests.get(endpoint, params={"data": query}, headers={
                "Accept": "application/json",
                "User-Agent": "CHiYODA-ATLAS/1.0 (personal urban-study data fetch)",
            }, timeout=180)
            response.raise_for_status()
            return response.json(), endpoint
        except Exception as exc:
            errors.append(f"{endpoint}: {exc}")
            time.sleep(2)
    raise RuntimeError(" / ".join(errors))


def prop(tags, osm_type, osm_id, source_endpoint):
    return {
        "n": tags.get("name") or tags.get("ref") or tags.get("exit") or "駅出入口",
        "ref": tags.get("ref"),
        "station": tags.get("station"),
        "operator": tags.get("operator"),
        "network": tags.get("network"),
        "level": tags.get("level"),
        "wheelchair": tags.get("wheelchair"),
        "indoor": tags.get("indoor"),
        "tunnel": tags.get("tunnel"),
        "layer": tags.get("layer"),
        "_osm_type": osm_type,
        "_osm_id": osm_id,
        "_source_name": "OpenStreetMap",
        "_source_url": "https://www.openstreetmap.org/copyright",
        "_source_endpoint": source_endpoint,
        "_license": "ODbL",
        "_data_quality": "community_osm",
    }


def clean_props(props):
    return {k: v for k, v in props.items() if v not in (None, "")}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-root", type=Path, default=DEFAULT_CACHE)
    args = parser.parse_args()

    city = load_city()
    raw, endpoint = fetch_overpass()

    raw_path = args.cache_root / "osm/chiyoda-underground-overpass.json"
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    raw_path.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")

    exits = []
    underground = []

    for element in raw.get("elements", []):
        typ = element.get("type")
        tags = element.get("tags") or {}
        osm_id = element.get("id")

        if typ == "node" and "lat" in element and "lon" in element:
            geom = Point(float(element["lon"]), float(element["lat"]))
            if not city.buffer(0.00005).contains(geom):
                continue
            if tags.get("railway") == "subway_entrance" or tags.get("public_transport") == "platform":
                exits.append({
                    "type": "Feature",
                    "properties": clean_props(prop(tags, typ, osm_id, endpoint)),
                    "geometry": mapping(geom),
                })
            continue

        if typ == "way":
            coords = [
                (p["lon"], p["lat"])
                for p in element.get("geometry", [])
                if "lon" in p and "lat" in p
            ]
            if len(coords) < 2:
                continue
            geom = LineString(coords)
            clipped = geom.intersection(city)
            if clipped.is_empty:
                continue

            props = prop(tags, typ, osm_id, endpoint)
            props["n"] = tags.get("name") or tags.get("ref") or "地下歩行リンク"
            props["_network_note"] = (
                "OSM上で地下・屋内・トンネル等として記録された歩行リンク。"
                "公式な地下ネットワーク全体を保証しない。"
            )

            if clipped.geom_type == "LineString":
                geometries = [clipped]
            elif clipped.geom_type == "MultiLineString":
                geometries = list(clipped.geoms)
            else:
                geometries = []

            for part in geometries:
                underground.append({
                    "type": "Feature",
                    "properties": clean_props(props),
                    "geometry": mapping(part),
                })

    EXIT_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    EXIT_OUTPUT.write_text(
        json.dumps({"type":"FeatureCollection","features":exits},
                   ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    UNDERGROUND_OUTPUT.write_text(
        json.dumps({"type":"FeatureCollection","features":underground},
                   ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    report = {
        "sourceEndpoint": endpoint,
        "license": "ODbL",
        "stationEntranceCount": len(exits),
        "undergroundWalkwayCount": len(underground),
        "outputs": [str(EXIT_OUTPUT.relative_to(ROOT)), str(UNDERGROUND_OUTPUT.relative_to(ROOT))],
        "caveat": "OSM community data; completeness varies. Do not describe as official or exhaustive.",
    }
    report_path = args.cache_root / "osm/chiyoda-underground-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
