"""Normalize bundled polygon data for RFC 7946 / MapLibre rendering."""

from __future__ import annotations

import json
from pathlib import Path

from shapely import make_valid, orient_polygons
from shapely.geometry import GeometryCollection, MultiPolygon, Polygon, mapping, shape
from shapely.ops import unary_union


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "public" / "data" / "map-data.json"


def polygonal(geometry):
    """Keep only polygonal members after validity repair."""
    fixed = make_valid(geometry)
    if isinstance(fixed, (Polygon, MultiPolygon)):
        return fixed
    if isinstance(fixed, GeometryCollection):
        parts = [part for part in fixed.geoms if isinstance(part, (Polygon, MultiPolygon))]
        return unary_union(parts)
    return fixed


def normalized_geometry(raw_geometry, clip=None):
    geometry = polygonal(shape(raw_geometry))
    if clip is not None:
        geometry = polygonal(geometry.intersection(clip))
    return mapping(orient_polygons(geometry, exterior_cw=False))


def main() -> None:
    bundle = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    city = polygonal(shape(bundle["city"]["geometry"]))
    bundle["city"]["geometry"] = mapping(orient_polygons(city, exterior_cw=False))

    for feature in bundle["towns"]["features"]:
        feature["geometry"] = normalized_geometry(feature["geometry"])

    for feature in bundle["zoning"]["features"]:
        feature["geometry"] = normalized_geometry(feature["geometry"], clip=city)

    DATA_PATH.write_text(
        json.dumps(bundle, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
