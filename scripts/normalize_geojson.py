"""Normalize core and lazy polygon data for RFC 7946 / MapLibre rendering."""

from __future__ import annotations

import json
from pathlib import Path

from shapely import make_valid, orient_polygons
from shapely.geometry import GeometryCollection, MultiPolygon, Polygon, mapping, shape
from shapely.ops import unary_union


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "public" / "data" / "map-data.json"
LAYER_PATHS = {
    "towns": ROOT / "public" / "data" / "layers" / "towns.json",
    "zoning": ROOT / "public" / "data" / "layers" / "zoning.json",
    "fire": ROOT / "public" / "data" / "layers" / "fire.json",
    "flood": ROOT / "public" / "data" / "layers" / "flood.json",
    "parks": ROOT / "public" / "data" / "layers" / "parks.json",
    "landPrices": ROOT / "public" / "data" / "layers" / "land-prices.json",
    "shelters": ROOT / "public" / "data" / "layers" / "shelters.json",
    "roads": ROOT / "public" / "data" / "layers" / "roads.json",
    "urbanPlanningRoads": ROOT / "public" / "data" / "layers" / "urban-planning-roads.json",
    "rail": ROOT / "public" / "data" / "layers" / "rail.json",
    "stations": ROOT / "public" / "data" / "layers" / "stations.json",
    "districtPlans": ROOT / "public" / "data" / "layers" / "district-plans.json",
    "heightDistricts": ROOT / "public" / "data" / "layers" / "height-districts.json",
    "specialZones": ROOT / "public" / "data" / "layers" / "special-zones.json",
    "redevelopment": ROOT / "public" / "data" / "layers" / "redevelopment.json",
    "chiyodaRegions": ROOT / "public" / "data" / "layers" / "chiyoda-regions.json",
    "landscapeProperties": ROOT / "public" / "data" / "layers" / "landscape-properties.json",
}


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
    bundle["scope"]["geometry"] = normalized_geometry(bundle["scope"]["geometry"])
    bundle["city"]["geometry"] = normalized_geometry(bundle["city"]["geometry"])

    for feature in bundle["wards"]["features"]:
        feature["geometry"] = normalized_geometry(feature["geometry"])
    scope = polygonal(
        unary_union(shape(feature["geometry"]) for feature in bundle["wards"]["features"])
    )

    DATA_PATH.write_text(
        json.dumps(bundle, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    for key, path in LAYER_PATHS.items():
        layer = json.loads(path.read_text(encoding="utf-8"))
        if key == "towns":
            for feature in layer["features"]:
                feature["geometry"] = normalized_geometry(feature["geometry"])
        elif key in (
            "zoning",
            "fire",
            "flood",
            "parks",
            "districtPlans",
            "heightDistricts",
            "specialZones",
            "chiyodaRegions",
        ):
            for feature in layer["features"]:
                feature["geometry"] = normalized_geometry(feature["geometry"], clip=scope)
        elif key in (
            "landPrices",
            "shelters",
            "redevelopment",
            "landscapeProperties",
        ):
            for feature in layer["features"]:
                if not scope.covers(shape(feature["geometry"])):
                    raise ValueError(f"{key} contains a point outside the six-ward scope")
        path.write_text(
            json.dumps(layer, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )


if __name__ == "__main__":
    main()
