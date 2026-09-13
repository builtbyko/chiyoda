#!/usr/bin/env python3
"""Safely upgrade CHiYODA ATLAS urban-planning-road data.

Goals:
1. Discover a CURRENT Chiyoda official ArcGIS polyline Feature Layer that
   actually contains urban-planning-road route names.
2. Export it to public/data/layers/urban-planning-roads-chiyoda-current.json.
3. Read Tokyo's Fifth Project Plan priority-route page.
4. If the Chiyoda official geometry safely supports it, derive the Chiyoda
   priority segment (currently Radiation Route 9 between Auxiliary 124 vicinity
   and Ring Route 2 vicinity) from intersections of official planning lines.
5. Never infer missing geometry or classify all routes as complete/underway/
   unstarted without an official reusable spatial source.

If safe discovery fails, the script writes reports only and does NOT create
public map data.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import date
from pathlib import Path
from urllib.parse import quote

import requests
from bs4 import BeautifulSoup
from shapely.geometry import shape, mapping, Point
from shapely.ops import linemerge, unary_union, substring
from pyproj import Geod

ROOT = Path(__file__).resolve().parents[1]
CACHE_DEFAULT = ROOT.parent / "work" / "chiyoda_map" / "data" / "next-stage" / "urban-planning-roads"
CACHE_ROOT = CACHE_DEFAULT

ARCGIS_ROOT = "https://tokei-gis2.chiyodatoshikei.jp/server/rest/services/Map_services"
PRIORITY_URL = "https://www.kensetsu.metro.tokyo.lg.jp/road/kensetsu/yusenseibirosen5"

CURRENT_OUT = ROOT / "public/data/layers/urban-planning-roads-chiyoda-current.json"
PRIORITY_OUT = ROOT / "public/data/layers/urban-planning-road-priority.json"
REPORT_OUT = ROOT / "scripts/data/urban-planning-road-upgrade-report.json"
PRIORITY_META_OUT = ROOT / "scripts/data/urban-planning-road-priority-metadata.json"

ROUTE_RE = re.compile(
    r"(?:幹線街路)?\s*(放射|環状|補助)(?:線街路)?\s*第?\s*([0-9０-９]+)(?:号(?:線)?)?",
    re.I,
)
FIELD_RE = re.compile(r"(路線|名称|都市計画道路|施設名|計画道路)", re.I)

REJECT_SERVICE_RE = re.compile(r"(dourodaichou|dourosyubetsu|rosenmouzu)", re.I)
GOOD_SERVICE_RE = re.compile(r"(都市施設|都市計画|toshishisetsu|toshikeikaku)", re.I)


def norm(text):
    return re.sub(r"\s+", "", str(text or "")).replace("　", "")


def normalize_digits(text):
    return str(text).translate(str.maketrans("０１２３４５６７８９", "0123456789"))


def route_key(text):
    m = ROUTE_RE.search(normalize_digits(norm(text)))
    if not m:
        return None
    kind, number = m.groups()
    return f"{kind}{int(number)}"


def cache_response(response, suffix="json"):
    CACHE_ROOT.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha256(response.url.encode("utf-8")).hexdigest()[:20]
    (CACHE_ROOT / f"{key}.{suffix}").write_bytes(response.content)


def get_json(url, params=None, timeout=60):
    params = dict(params or {})
    params["f"] = "json"
    r = requests.get(url, params=params, timeout=timeout)
    r.raise_for_status()
    cache_response(r)
    data = r.json()
    if "error" in data:
        raise RuntimeError(data["error"])
    return data


def query_geojson(layer_url, where="1=1", out_fields="*", count=2000, offset=0):
    r = requests.get(
        f"{layer_url}/query",
        params={
            "where": where,
            "outFields": out_fields,
            "returnGeometry": "true",
            "outSR": "4326",
            "resultOffset": offset,
            "resultRecordCount": count,
            "f": "geojson",
        },
        timeout=120,
    )
    r.raise_for_status()
    cache_response(r)
    data = r.json()
    if "error" in data:
        raise RuntimeError(data["error"])
    if data.get("type") != "FeatureCollection":
        raise RuntimeError("ArcGIS query did not return a FeatureCollection")
    return data


def fetch_all_geojson(layer_url, max_record_count=1000):
    features = []
    offset = 0
    while True:
        fc = query_geojson(layer_url, count=max_record_count, offset=offset)
        batch = fc.get("features", [])
        features.extend(batch)
        if len(batch) < max_record_count:
            break
        offset += len(batch)
    return {"type": "FeatureCollection", "features": features}


def scan_arcgis():
    catalog = get_json(ARCGIS_ROOT)
    candidates = []

    for service in catalog.get("services", []):
        if service.get("type") not in ("MapServer", "FeatureServer"):
            continue

        service_name = service["name"]
        short = service_name.split("/", 1)[-1]
        service_url = f"{ARCGIS_ROOT}/{quote(short)}/{service['type']}"

        try:
            info = get_json(service_url)
        except Exception:
            continue

        for layer in info.get("layers", []):
            lid = layer["id"]
            layer_url = f"{service_url}/{lid}"
            try:
                li = get_json(layer_url)
            except Exception:
                continue

            if li.get("type") != "Feature Layer":
                continue
            if li.get("geometryType") != "esriGeometryPolyline":
                continue

            fields = li.get("fields") or []
            aliases = " ".join(
                f"{f.get('name','')} {f.get('alias','')}" for f in fields
            )
            field_score = 4 if FIELD_RE.search(aliases) else 0

            try:
                sample = query_geojson(layer_url, count=250)
            except Exception:
                continue

            found = {}
            for feature in sample.get("features", []):
                p = feature.get("properties", {})
                for field, value in p.items():
                    key = route_key(value)
                    if key:
                        found.setdefault(field, set()).add(key)

            unique_routes = sorted(set().union(*found.values())) if found else []
            route_score = min(len(unique_routes), 20)

            service_bonus = 4 if GOOD_SERVICE_RE.search(service_name + " " + str(layer.get("name",""))) else 0
            reject_penalty = 6 if REJECT_SERVICE_RE.search(service_name) else 0
            score = field_score + route_score + service_bonus - reject_penalty

            candidates.append({
                "service": service_name,
                "layerId": lid,
                "layerName": layer.get("name"),
                "layerUrl": layer_url,
                "fieldsWithRouteValues": {k: sorted(v) for k, v in found.items()},
                "fields": [f.get("name") for f in fields],
                "sampleFeatureCount": len(sample.get("features", [])),
                "routeValues": unique_routes,
                "score": score,
                "maxRecordCount": int(li.get("maxRecordCount") or 1000),
            })

    candidates.sort(key=lambda x: x["score"], reverse=True)
    return candidates


def choose_candidate(candidates):
    if not candidates:
        return None
    best = candidates[0]
    second = candidates[1] if len(candidates) > 1 else None

    # Route-like values in a road ledger are not proof of planning-road GIS.
    if REJECT_SERVICE_RE.search(best["service"]):
        return None
    if "都市計画道路" not in str(best.get("layerName") or ""):
        return None

    # Safe acceptance:
    # - enough route-name signal
    # - score is clearly stronger than alternatives
    if len(best["routeValues"]) < 5:
        return None
    if best["score"] < 10:
        return None
    if second and best["score"] - second["score"] < 2:
        return None
    return best


def detect_route_field(candidate):
    fields = candidate["fieldsWithRouteValues"]
    if not fields:
        return None
    # Field with the greatest number of distinct route names.
    return max(fields.items(), key=lambda kv: len(kv[1]))[0]


def normalize_current(fc, route_field, source_url):
    out = []
    for feature in fc.get("features", []):
        p = feature.get("properties", {})
        raw_name = p.get(route_field)
        key = route_key(raw_name)
        if not key:
            continue
        kind = re.match(r"(放射|環状|補助)", key).group(1)
        props = {
            **p,
            "n": str(raw_name),
            "routeKey": key,
            "routeType": kind,
            "_dataset": "urbanPlanningRoadsChiyodaCurrent",
            "_source_url": source_url,
            "_source_date": str(date.today()),
            "_data_quality": "official_gis",
        }
        out.append({
            "type": "Feature",
            "properties": props,
            "geometry": feature["geometry"],
        })
    return {"type": "FeatureCollection", "features": out}


def scrape_priority_chiyoda():
    r = requests.get(PRIORITY_URL, timeout=90)
    r.raise_for_status()
    cache_response(r, "html")
    soup = BeautifulSoup(r.content, "html.parser", from_encoding="utf-8")

    heading = None
    for tag in soup.find_all(["h3", "h4", "h5"]):
        if norm(tag.get_text(" ", strip=True)) == "千代田区":
            heading = tag
            break
    if heading is None:
        raise RuntimeError("Tokyo priority page: Chiyoda heading not found")

    table = heading.find_next("table")
    if table is None:
        raise RuntimeError("Tokyo priority page: Chiyoda table not found")

    rows = []
    headers = [norm(x.get_text(" ", strip=True)) for x in table.find_all("th")]
    for tr in table.find_all("tr"):
        cells = [x.get_text(" ", strip=True) for x in tr.find_all(["td", "th"])]
        if not cells or "路線名" in "".join(cells):
            continue
        if len(cells) < 6:
            continue
        if norm(cells[4]) not in ("千代田", "千代田区"):
            continue
        rows.append({
            "no": cells[0].strip(),
            "routeName": cells[1].strip(),
            "section": cells[2].strip(),
            "lengthM": cells[3].strip(),
            "ward": cells[4].strip(),
            "approvalTiming": cells[5].strip(),
            "note": cells[6].strip() if len(cells) > 6 else "",
            "sourceUrl": PRIORITY_URL,
        })
    return rows


def lines_for_route(fc, key):
    geoms = []
    for f in fc.get("features", []):
        if f.get("properties", {}).get("routeKey") == key:
            geoms.append(shape(f["geometry"]))
    if not geoms:
        return None
    union = unary_union(geoms)
    merged = union if union.geom_type == "LineString" else linemerge(union)
    return merged


def intersection_points(a, b):
    inter = a.intersection(b)
    pts = []
    if inter.is_empty:
        return pts
    if inter.geom_type == "Point":
        pts = [inter]
    elif inter.geom_type == "MultiPoint":
        pts = list(inter.geoms)
    elif inter.geom_type in ("GeometryCollection",):
        pts = [g for g in inter.geoms if g.geom_type == "Point"]
    return pts


def geodesic_length_m(line):
    geod = Geod(ellps="GRS80")
    coords = list(line.coords)
    total = 0.0
    for (x1, y1), (x2, y2) in zip(coords, coords[1:]):
        _, _, d = geod.inv(x1, y1, x2, y2)
        total += d
    return total


def derive_priority_segment(current_fc, row):
    route = route_key(row["routeName"])
    if not route:
        return None, "priority route name not recognized"

    # This derivation is intentionally narrow and explicit.
    # Current known Chiyoda row: 放射9号線 / 補助124付近～環状2付近
    section = normalize_digits(norm(row["section"]))
    tokens = re.findall(r"(補助|環状|放射)\s*([0-9]+)", section)
    boundary_keys = [f"{kind}{int(num)}" for kind, num in tokens]
    if len(boundary_keys) != 2:
        return None, f"could not identify two boundary routes from: {row['section']}"

    main = lines_for_route(current_fc, route)
    b1 = lines_for_route(current_fc, boundary_keys[0])
    b2 = lines_for_route(current_fc, boundary_keys[1])
    if main is None or b1 is None or b2 is None:
        return None, "required route geometry missing"
    if main.geom_type != "LineString":
        return None, f"main route did not merge to one LineString: {main.geom_type}"

    p1s = intersection_points(main, b1)
    p2s = intersection_points(main, b2)
    if not p1s or not p2s:
        return None, "route intersections not found"
    if len(p1s) != 1 or len(p2s) != 1:
        return None, "ambiguous boundary intersections; no segment inferred"

    # Select the pair whose distance along the main route is closest to official length.
    official_len = float(re.sub(r"[^0-9.]", "", normalize_digits(row["lengthM"])) or 0)
    if official_len <= 0:
        return None, "published length missing; no segment inferred"
    candidates = []
    for p1 in p1s:
        for p2 in p2s:
            d1 = main.project(p1)
            d2 = main.project(p2)
            if abs(d1 - d2) < 1e-9:
                continue
            seg = substring(main, min(d1, d2), max(d1, d2))
            if seg.geom_type != "LineString":
                continue
            actual = geodesic_length_m(seg)
            error = abs(actual - official_len) if official_len else 0
            candidates.append((error, actual, seg, p1, p2))

    if not candidates:
        return None, "no valid segment candidate"

    candidates.sort(key=lambda x: x[0])
    error, actual, seg, _, _ = candidates[0]

    # Conservative validation against official published length.
    if official_len and not (official_len * 0.65 <= actual <= official_len * 1.35):
        return None, f"derived length {actual:.0f}m does not match official {official_len:.0f}m safely"

    props = {
        "n": row["routeName"],
        "category": "fifth_priority",
        "categoryLabel": "第五次事業化計画・優先整備路線",
        "section": row["section"],
        "officialLengthM": official_len or None,
        "derivedLengthM": round(actual),
        "approvalTiming": row["approvalTiming"],
        "planPeriod": "2026年度～2040年度",
        "sourceUrl": PRIORITY_URL,
        "_source_url": PRIORITY_URL,
        "_source_date": "2026-08-31",
        "_data_quality": "derived_from_official_gis_and_official_table",
    }
    props = {k: v for k, v in props.items() if v is not None}
    return {
        "type": "Feature",
        "properties": props,
        "geometry": mapping(seg),
    }, None


def main():
    global CACHE_ROOT
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-root", type=Path, default=CACHE_DEFAULT)
    args = parser.parse_args()
    CACHE_ROOT = args.cache_root

    report = {
        "generated": str(date.today()),
        "arcgisRoot": ARCGIS_ROOT,
        "prioritySource": PRIORITY_URL,
        "candidateAccepted": False,
        "currentFeatureCount": 0,
        "prioritySpatialFeatureCount": 0,
        "warnings": [
            "Do not infer complete/underway/unstarted status for all Chiyoda routes.",
            "Keep neighboring-ward PLATEAU 2020 roads as context unless a newer safe source is prepared.",
        ],
    }

    candidates = scan_arcgis()
    args.cache_root.mkdir(parents=True, exist_ok=True)
    (args.cache_root / "arcgis-road-candidates.json").write_text(
        json.dumps(candidates, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    report["candidateCount"] = len(candidates)
    report["topCandidates"] = candidates[:8]

    chosen = choose_candidate(candidates)
    priority_rows = scrape_priority_chiyoda()
    PRIORITY_META_OUT.parent.mkdir(parents=True, exist_ok=True)
    PRIORITY_META_OUT.write_text(
        json.dumps(
            {
                "sourceUrl": PRIORITY_URL,
                "sourceDate": "2026-08-31",
                "ward": "千代田区",
                "rows": priority_rows,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    report["priorityRows"] = priority_rows

    if chosen is None:
        report["reason"] = "No ArcGIS polyline layer could be safely identified as current urban-planning-road data."
        REPORT_OUT.parent.mkdir(parents=True, exist_ok=True)
        REPORT_OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(report["reason"])
        return

    route_field = detect_route_field(chosen)
    fc = fetch_all_geojson(chosen["layerUrl"], chosen["maxRecordCount"])
    current = normalize_current(fc, route_field, chosen["layerUrl"])

    if len(current["features"]) < 5:
        report["reason"] = "Chosen layer exported too few recognized urban-planning-road features."
        REPORT_OUT.parent.mkdir(parents=True, exist_ok=True)
        REPORT_OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(report["reason"])
        return

    CURRENT_OUT.parent.mkdir(parents=True, exist_ok=True)
    CURRENT_OUT.write_text(
        json.dumps(current, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    report["candidateAccepted"] = True
    report["chosenLayer"] = chosen
    report["routeField"] = route_field
    report["currentFeatureCount"] = len(current["features"])

    derived = []
    derivation_errors = []
    for row in priority_rows:
        feature, error = derive_priority_segment(current, row)
        if feature:
            derived.append(feature)
        else:
            derivation_errors.append({"row": row, "error": error})

    if derived:
        PRIORITY_OUT.write_text(
            json.dumps({"type": "FeatureCollection", "features": derived},
                       ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )

    report["prioritySpatialFeatureCount"] = len(derived)
    report["priorityDerivationErrors"] = derivation_errors
    REPORT_OUT.parent.mkdir(parents=True, exist_ok=True)
    REPORT_OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps({
        "currentFeatureCount": len(current["features"]),
        "priorityRows": len(priority_rows),
        "prioritySpatialFeatureCount": len(derived),
        "chosen": f"{chosen['service']} / {chosen['layerId']} {chosen['layerName']}",
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
