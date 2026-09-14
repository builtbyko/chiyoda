"""Offline geometry checks. Source layers are never changed or re-clipped."""
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import shapely
from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import transform, unary_union

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "scripts/data/atlas-geometry-audit.json"


def main():
    data_audit = json.loads((ROOT / "scripts/data/atlas-data-audit.json").read_text(encoding="utf-8"))
    core = json.loads((ROOT / "public/data/map-data.json").read_text(encoding="utf-8"))
    scope = unary_union([shape(feature["geometry"]) for feature in core["wards"]["features"]])
    projection = Transformer.from_crs(4326, 6677, always_xy=True).transform
    datasets = {}
    failures = 0
    for key, dataset in data_audit["datasets"].items():
        collection = json.loads((ROOT / dataset["file"]).read_text(encoding="utf-8"))
        empty = invalid = points_outside = 0
        types = Counter()
        outside_area = outside_length = 0.0
        boundary_features = 0
        for feature in collection["features"]:
            geometry = feature.get("geometry")
            if not geometry:
                empty += 1
                continue
            geom = shape(geometry)
            types[geom.geom_type] += 1
            empty += int(geom.is_empty)
            invalid += int(not geom.is_valid)
            if geom.is_empty or not geom.is_valid:
                continue
            if scope.covers(geom):
                continue
            boundary_features += 1
            if geom.geom_type == "Point":
                points_outside += 1
            else:
                outside = transform(projection, geom.difference(scope))
                if geom.geom_type in ("Polygon", "MultiPolygon"):
                    outside_area += outside.area
                elif geom.geom_type in ("LineString", "MultiLineString"):
                    outside_length += outside.length
        datasets[key] = {
            "features": len(collection["features"]), "geometryTypes": dict(types),
            "empty": empty, "invalid": invalid, "pointsOutsideWards": points_outside,
            "strictBoundaryOutsideFeatures": boundary_features,
            "outsideAreaSqm": round(outside_area, 3), "outsideLengthM": round(outside_length, 3),
        }
        failures += empty + invalid + points_outside
    report = {
        "auditedAt": datetime.now(timezone.utc).isoformat(),
        "dataAuditTimestamp": data_audit["auditedAt"],
        "shapelyVersion": shapely.__version__,
        "scope": "Existing six-ward geometry union, not the map camera bbox. EPSG:6677 metrics.",
        "limitations": "Strict boundary excess includes coordinate rounding/simplification. It is reported, not automatically corrected. No live source or legal-area verification.",
        "datasets": datasets, "errorCount": failures,
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"report": "scripts/data/atlas-geometry-audit.json", "datasets": len(datasets), "errors": failures}))
    raise SystemExit(1 if failures else 0)


if __name__ == "__main__":
    main()
