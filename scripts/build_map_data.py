"""Build the compact map bundle for Chiyoda and its five adjacent wards.

The source files are intentionally kept outside the web bundle because the OSM
and national railway inputs are large.  By default this script reads the cache
created while researching the atlas at ``../work/chiyoda_map/data``.  A
different cache can be supplied with ``--source-root``.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

import geopandas as gpd
import pyogrio
from pyproj import Transformer
from shapely import make_valid, orient_polygons, set_precision
from shapely.geometry import (
    GeometryCollection,
    LineString,
    MultiLineString,
    MultiPolygon,
    Polygon,
    mapping,
    shape,
)
from shapely.ops import linemerge, transform, unary_union


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE_ROOT = ROOT.parent / "work" / "chiyoda_map" / "data"
OUTPUT_PATH = ROOT / "public" / "data" / "map-data.json"

WARDS = {
    "13101": "千代田区",
    "13102": "中央区",
    "13103": "港区",
    "13104": "新宿区",
    "13105": "文京区",
    "13106": "台東区",
}

CHIYODA_ALIASES = {
    "猿楽町一丁目": "神田猿楽町一丁目",
    "猿楽町二丁目": "神田猿楽町二丁目",
    "三崎町一丁目": "神田三崎町一丁目",
    "三崎町二丁目": "神田三崎町二丁目",
    "三崎町三丁目": "神田三崎町三丁目",
    "神田司町": "神田司町二丁目",
    "神田多町": "神田多町二丁目",
    "神田鍛冶町": "神田鍛冶町三丁目",
}

SHINJUKU_ALIASES = {
    "四谷": "四谷一丁目",
    "戸塚町": "戸塚町一丁目",
}

ZONING_GROUPS = {
    1: "low",
    2: "low",
    3: "mid",
    4: "mid",
    5: "residential",
    6: "residential",
    7: "residential",
    8: "residential",
    9: "neighborhood",
    10: "commercial",
    11: "industrial",
    12: "industrial",
    13: "industrial",
}

FLOOD_DEPTHS = {
    1: "0.5m未満",
    2: "0.5–3.0m",
    3: "3.0–5.0m",
    4: "5.0–10.0m",
    5: "10.0–20.0m",
    6: "20.0m以上",
}

PARK_SOURCES = {
    "都立公園.shp": "park",
    "区市町村立公園(都市公園).shp": "park",
    "区市町村立公園(都市公園以外).shp": "park",
    "国営公園.shp": "park",
    "国民公園.shp": "park",
    "都市公園に準ずるもの.shp": "park",
    "海上公園(開園区域).shp": "waterfront",
}

MAJOR_STATIONS = {
    "東京",
    "大手町",
    "有楽町",
    "神田",
    "秋葉原",
    "飯田橋",
    "市ヶ谷",
    "四ツ谷",
    "九段下",
    "神保町",
    "新宿",
    "新宿三丁目",
    "上野",
    "御徒町",
    "浅草",
    "新橋",
    "品川",
    "浜松町",
    "六本木",
    "赤坂見附",
    "後楽園",
}


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def clean_name(value: object) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    name = unicodedata.normalize("NFKC", str(value or "")).strip()
    name = name.replace("麹町", "麴町").replace("ヶ", "ケ").replace("簞笥", "箪笥")
    name = re.sub(r"[\s　]+", "", name)

    def chome(match: re.Match[str]) -> str:
        value = int(match.group(1))
        digits = "〇一二三四五六七八九"
        if value < 10:
            numeral = digits[value]
        elif value < 20:
            numeral = "十" if value == 10 else f"十{digits[value - 10]}"
        else:
            tens, ones = divmod(value, 10)
            numeral = f"{digits[tens]}十{digits[ones] if ones else ''}"
        return f"{numeral}丁目"

    return re.sub(r"(\d+)丁目", chome, name)


def clean_text(value: object) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    text = unicodedata.normalize("NFKC", str(value)).strip()
    return "" if text == "_" else re.sub(r"[ \t]+", " ", text)


def decimal(value: object, default: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return default if math.isnan(result) else result


def current_town_name(code: str, value: object) -> str:
    name = clean_name(value)
    if code == "13101":
        name = CHIYODA_ALIASES.get(name, name)
    if code == "13104":
        name = SHINJUKU_ALIASES.get(name, name)
    return name


def polygonal(geometry):
    fixed = make_valid(geometry)
    if isinstance(fixed, (Polygon, MultiPolygon)):
        return fixed
    if isinstance(fixed, GeometryCollection):
        parts = [part for part in fixed.geoms if isinstance(part, (Polygon, MultiPolygon))]
        return unary_union(parts) if parts else MultiPolygon()
    return MultiPolygon()


def linear(geometry):
    fixed = make_valid(geometry)
    if isinstance(fixed, (LineString, MultiLineString)):
        return fixed
    if isinstance(fixed, GeometryCollection):
        parts = [part for part in fixed.geoms if isinstance(part, (LineString, MultiLineString))]
        return unary_union(parts) if parts else MultiLineString()
    return MultiLineString()


def compact_geometry(geometry, tolerance: float = 0.0):
    if tolerance:
        geometry = geometry.simplify(tolerance, preserve_topology=True)
    # Snap before serializing so coordinate rounding cannot introduce tiny
    # self-intersections or collapsed rings in polygon features.
    geometry = set_precision(geometry, 0.000001, mode="valid_output")
    if isinstance(geometry, (Polygon, MultiPolygon)):
        geometry = polygonal(geometry)
        geometry = orient_polygons(geometry, exterior_cw=False)
    encoded = mapping(geometry)

    def rounded(value):
        if isinstance(value, (list, tuple)):
            if value and isinstance(value[0], (int, float)):
                return [round(float(item), 6) for item in value]
            return [rounded(item) for item in value]
        return value

    return {"type": encoded["type"], "coordinates": rounded(encoded["coordinates"])}


def decode_topology_geometry(topology, raw_geometry):
    transform_spec = topology.get("transform")

    def decoded_arc(index: int):
        arc = topology["arcs"][index if index >= 0 else ~index]
        if transform_spec:
            scale = transform_spec["scale"]
            translate = transform_spec["translate"]
            x = y = 0
            coordinates = []
            for dx, dy in arc:
                x += dx
                y += dy
                coordinates.append([x * scale[0] + translate[0], y * scale[1] + translate[1]])
        else:
            coordinates = [list(point) for point in arc]
        return coordinates if index >= 0 else list(reversed(coordinates))

    def ring(indices):
        coordinates = []
        for index in indices:
            arc = decoded_arc(index)
            coordinates.extend(arc if not coordinates else arc[1:])
        if coordinates and coordinates[0] != coordinates[-1]:
            coordinates.append(coordinates[0])
        return coordinates

    kind = raw_geometry["type"]
    arcs = raw_geometry.get("arcs", [])
    if kind == "Polygon":
        return {"type": kind, "coordinates": [ring(item) for item in arcs]}
    if kind == "MultiPolygon":
        return {
            "type": kind,
            "coordinates": [[ring(item) for item in polygon] for polygon in arcs],
        }
    raise ValueError(f"Unsupported TopoJSON geometry: {kind}")


def load_ward_topology(path: Path):
    topology = load_json(path)
    towns = []
    for raw in topology["objects"]["town"]["geometries"]:
        towns.append((raw["properties"], polygonal(shape(decode_topology_geometry(topology, raw)))))
    city_raw = topology["objects"]["city"]["geometries"][0]
    city = polygonal(shape(decode_topology_geometry(topology, city_raw)))
    return towns, city


def number(value: object) -> int:
    raw = str(value or "").strip().replace(",", "")
    return 0 if raw in {"", "-", "－"} else int(float(raw))


def load_population(path: Path):
    rows = list(csv.DictReader(path.open("r", encoding="utf-8-sig", newline="")))
    statistics = {}
    totals = {}
    for row in rows:
        code = row["地域コード"]
        if code not in WARDS:
            continue
        hierarchy = row["町丁別地域階層"]
        if hierarchy == "0":
            totals[code] = {
                "h": number(row["世帯数(世帯)"]),
                "p": number(row["人口／総数(人)"]),
            }
            continue
        name = current_town_name(code, row["町丁別地域"])
        item = statistics.setdefault((code, name), {"h": 0, "p": 0, "m": 0, "f": 0})
        item["h"] += number(row["世帯数(世帯)"])
        item["p"] += number(row["人口／総数(人)"])
        item["m"] += number(row["人口／男(人)"])
        item["f"] += number(row["人口／女(人)"])
    return statistics, totals


def build_towns(source_root: Path):
    population, totals = load_population(source_root / "population-tokyo-2026-01.csv")
    ward_geometries = {}
    grouped = {}

    for code, ward_name in WARDS.items():
        source_towns, ward = load_ward_topology(
            source_root / "towns-neighbors" / f"r2ka{code}.topojson"
        )
        ward_geometries[code] = ward
        for props, geometry in source_towns:
            name = current_town_name(code, props.get("S_NAME"))
            if not name or name in {"-", "‐", "水面調査区"}:
                continue
            key = (code, name)
            item = grouped.setdefault(key, {"area": 0.0, "geometries": [], "ward": ward_name})
            item["area"] += float(props.get("AREA") or 0)
            item["geometries"].append(geometry)

    missing_population = sorted(set(grouped) - set(population))
    missing_geometry = sorted(set(population) - set(grouped))
    if missing_population or missing_geometry:
        print(
            json.dumps(
                {
                    "populationJoin": {
                        "withoutPopulationCount": len(missing_population),
                        "withoutPopulationSample": missing_population[:20],
                        "withoutGeometryCount": len(missing_geometry),
                        "withoutGeometrySample": missing_geometry[:20],
                    }
                },
                ensure_ascii=True,
                indent=2,
            )
        )

    features = []
    for (code, name), item in grouped.items():
        stats = population.get((code, name), {"h": 0, "p": 0, "m": 0, "f": 0})
        area = int(round(item["area"]))
        density = round(stats["p"] / (area / 1_000_000)) if area else 0
        geometry = polygonal(unary_union(item["geometries"]))
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "n": name,
                    "w": item["ward"],
                    "wc": code,
                    **stats,
                    "a": area,
                    "d": density,
                },
                "geometry": compact_geometry(geometry, 0.000002),
            }
        )

    features.sort(key=lambda feature: (feature["properties"]["wc"], feature["properties"]["n"]))
    scope = polygonal(unary_union(list(ward_geometries.values())))
    area_transformer = Transformer.from_crs(4326, 6677, always_xy=True)
    scope_area = transform(area_transformer.transform, scope).area / 1_000_000
    return features, ward_geometries, scope, totals, scope_area


def zoning_group(code: int) -> str:
    return ZONING_GROUPS.get(code, "other")


def build_zoning(source_root: Path, ward_geometries):
    features = []
    base = source_root / "urbanplanning" / "13_東京都"
    for code, ward_name in WARDS.items():
        path = next((base).glob(f"{code}_*/{code}_youto.geojson"))
        for feature in load_json(path)["features"]:
            props = feature["properties"]
            geometry = polygonal(shape(feature["geometry"])).intersection(ward_geometries[code])
            geometry = polygonal(geometry)
            if geometry.is_empty:
                continue
            category = int(props["YoutoCode"])
            features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "n": props["YoutoName"],
                        "g": zoning_group(category),
                        "c": category,
                        "f": int(float(props["FAR"])),
                        "b": int(float(props["BCR"])),
                        "w": ward_name,
                    },
                    "geometry": compact_geometry(geometry, 0.000004),
                }
            )
    return features


def build_fire(source_root: Path, ward_geometries):
    features = []
    base = source_root / "urbanplanning" / "13_東京都"
    for code, ward_name in WARDS.items():
        path = next(base.glob(f"{code}_*/{code}_bouka.geojson"))
        for item in load_json(path)["features"]:
            area_type = clean_text(item["properties"].get("AreaType"))
            category = "semi" if "準" in area_type else "fire"
            geometry = polygonal(shape(item["geometry"])).intersection(ward_geometries[code])
            geometry = polygonal(geometry)
            if geometry.is_empty:
                continue
            features.append(
                {
                    "type": "Feature",
                    "properties": {"n": area_type, "c": category, "w": ward_name},
                    "geometry": compact_geometry(geometry, 0.000004),
                }
            )
    features.sort(key=lambda item: (item["properties"]["w"], item["properties"]["c"]))
    return features


def build_flood(source_root: Path, scope):
    by_depth = defaultdict(list)
    rivers_by_depth = defaultdict(set)
    flood_root = source_root / "flood-2025"
    paths = sorted(flood_root.glob("river-*/*想定最大規模/*.geojson"))

    for path in paths:
        frame = pyogrio.read_dataframe(
            path,
            bbox=scope.bounds,
            columns=["A31a_202", "A31a_205"],
        ).to_crs(4326)
        if frame.empty:
            continue
        for row in frame.to_dict("records"):
            depth = int(decimal(row.get("A31a_205")))
            if depth not in FLOOD_DEPTHS:
                continue
            source_geometry = polygonal(row["geometry"])
            if source_geometry.is_empty or not source_geometry.intersects(scope):
                continue
            geometry = polygonal(source_geometry.intersection(scope))
            if geometry.is_empty:
                continue
            by_depth[depth].append(geometry)
            river = clean_text(row.get("A31a_202"))
            if river:
                rivers_by_depth[depth].add(river)

    # River-specific inundation polygons overlap.  Keep only the maximum depth
    # at each location so color has one unambiguous meaning on the atlas.
    covered = MultiPolygon()
    exclusive = {}
    for depth in sorted(by_depth, reverse=True):
        merged = polygonal(unary_union(by_depth[depth])).intersection(scope)
        merged = polygonal(merged)
        geometry = polygonal(merged.difference(covered))
        if not geometry.is_empty:
            exclusive[depth] = geometry
        covered = polygonal(unary_union([covered, merged]))

    features = []
    for depth in sorted(exclusive):
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "n": FLOOD_DEPTHS[depth],
                    "c": depth,
                    "s": "想定最大規模・河川別区域の最大値",
                    "r": sorted(rivers_by_depth[depth]),
                },
                "geometry": compact_geometry(exclusive[depth], 0.000012),
            }
        )
    return features


def park_ward_names(geometry, ward_geometries) -> str:
    names = []
    for code, ward in ward_geometries.items():
        intersection = geometry.intersection(ward)
        if not intersection.is_empty and intersection.area > 0.000000000001:
            names.append(WARDS[code])
    return "・".join(names)


def build_parks(source_root: Path, scope, ward_geometries):
    park_root = source_root / "green-tokyo-2026" / "expanded"
    source_scope = transform(
        Transformer.from_crs(4326, 6677, always_xy=True).transform,
        scope,
    )
    groups = defaultdict(lambda: {"geometries": [], "areas": []})

    for path in sorted(park_root.rglob("*.shp")):
        category = PARK_SOURCES.get(path.name)
        if not category:
            continue
        frame = pyogrio.read_dataframe(path, bbox=source_scope.bounds).to_crs(4326)
        for row in frame.to_dict("records"):
            name = clean_text(row.get("公園名") or row.get("名称"))
            if not name or name == "-":
                continue
            source_geometry = polygonal(row["geometry"])
            if source_geometry.is_empty or not source_geometry.intersects(scope):
                continue
            geometry = polygonal(source_geometry.intersection(scope))
            if geometry.is_empty:
                continue
            ward_name = park_ward_names(geometry, ward_geometries)
            park_type = clean_text(row.get("種別") or row.get("区分"))
            custodian = clean_text(row.get("所管"))
            key = (name, category, ward_name, park_type, custodian)
            groups[key]["geometries"].append(geometry)
            groups[key]["areas"].append(decimal(row.get("面積m2")))

    features = []
    for (name, category, ward_name, park_type, custodian), item in groups.items():
        geometry = polygonal(unary_union(item["geometries"]))
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "n": name,
                    "c": category,
                    "w": ward_name,
                    "t": park_type or "公園・緑地",
                    "a": int(round(max(item["areas"], default=0))),
                    "o": custodian or "—",
                },
                "geometry": compact_geometry(geometry, 0.000003),
            }
        )
    features.sort(key=lambda item: (item["properties"]["w"], item["properties"]["n"]))
    return features


def build_land_prices(source_root: Path, scope):
    path = (
        source_root
        / "land-price-2026"
        / "expanded"
        / "L01-26_GML"
        / "L01-26.shp"
    )
    columns = [
        "L01_001",
        "L01_002",
        "L01_003",
        "L01_008",
        "L01_009",
        "L01_025",
        "L01_027",
        "L01_028",
        "L01_029",
        "L01_048",
        "L01_050",
        "L01_051",
    ]
    frame = pyogrio.read_dataframe(path, bbox=scope.bounds, columns=columns).to_crs(4326)
    frame = frame[
        frame["L01_001"].astype(str).isin(WARDS)
        & frame.geometry.apply(scope.covers)
    ]

    features = []
    for row in frame.to_dict("records"):
        code = str(row["L01_001"])
        address = clean_text(row.get("L01_025")).replace("東京都 ", "", 1)
        use_detail = clean_text(row.get("L01_029"))
        use_group = clean_text(row.get("L01_028"))
        point_id = f"{code}-{row.get('L01_002')}-{row.get('L01_003')}"
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "n": address,
                    "w": WARDS[code],
                    "p": int(decimal(row.get("L01_008"))),
                    "q": round(decimal(row.get("L01_009")), 1),
                    "a": int(decimal(row.get("L01_027"))),
                    "u": use_detail or use_group or "—",
                    "s": clean_text(row.get("L01_048")) or "—",
                    "d": int(decimal(row.get("L01_050"))),
                    "z": clean_text(row.get("L01_051")) or "—",
                    "i": point_id,
                },
                "geometry": compact_geometry(row["geometry"]),
            }
        )
    features.sort(key=lambda item: (item["properties"]["w"], item["properties"]["i"]))
    return features


def build_shelters(source_root: Path, scope, ward_geometries):
    shelter_root = source_root / "shelters-gsi-2026-09-07"
    features = []
    seen = set()
    for path in sorted(shelter_root.glob("*.geojson")):
        category = "welfare" if path.name.startswith("sfh-") else "general"
        for item in load_json(path)["features"]:
            point = shape(item["geometry"])
            if not scope.covers(point):
                continue
            props = item.get("properties", {})
            name = clean_text(props.get("name"))
            address = clean_text(props.get("address"))
            key = (category, name, address, round(point.x, 6), round(point.y, 6))
            if key in seen:
                continue
            seen.add(key)
            features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "n": name or "指定避難所",
                        "c": category,
                        "w": "・".join(ward_names_for(point, ward_geometries)),
                        "a": address or "—",
                        "t": clean_text(props.get("accept")) or "—",
                        "m": clean_text(props.get("necessary_matters")) or "—",
                        "r": clean_text(props.get("remarks")) or "—",
                    },
                    "geometry": compact_geometry(point),
                }
            )
    features.sort(key=lambda item: (item["properties"]["w"], item["properties"]["c"], item["properties"]["n"]))
    return features


def road_class(properties) -> str:
    highway = str(properties.get("highway") or "")
    other_tags = str(properties.get("other_tags") or "")
    if highway.startswith("motorway"):
        return "x"
    if highway.startswith("trunk") or '"network"=>"JP:national"' in other_tags:
        return "n"
    if highway.startswith(("primary", "secondary")):
        return "m"
    return "d"


def clean_road_name(properties) -> str:
    name = ""
    for key in ("name_ja", "name", "official_name"):
        name = clean_name(properties.get(key))
        if name:
            break
    ref = clean_name(properties.get("ref") or "")
    replacements = {
        "神田警察通り(進路変更禁止)": "神田警察通り",
        "環状2号線(信号表示注意)": "環状2号線",
        "環状2号線;万世橋": "環状2号線",
        "昌平橋通り;万世橋": "昌平橋通り",
    }
    name = replacements.get(name, name)
    if name:
        return name
    category = road_class(properties)
    if category == "x":
        return f"首都高 {ref}" if ref else "首都高速道路"
    if category == "n":
        return f"国道{ref.split(';')[0]}号" if ref else "国道"
    return f"都道{ref}号" if ref else "主要道路"


def build_roads(source_root: Path, scope):
    config = source_root / "osmconf.ini"
    pyogrio.set_gdal_config_options({"OSM_CONFIG_FILE": str(config.resolve())})
    frame = pyogrio.read_dataframe(
        source_root / "Tokyo.osm.pbf",
        layer="lines",
        bbox=scope.bounds,
    )
    allowed = {
        "motorway",
        "motorway_link",
        "trunk",
        "trunk_link",
        "primary",
        "primary_link",
        "secondary",
        "secondary_link",
        "tertiary",
        "tertiary_link",
    }
    frame = frame[frame["highway"].isin(allowed)]

    groups = defaultdict(list)
    metadata = {}
    for row in frame.to_dict("records"):
        if str(row.get("highway") or "").startswith("tertiary") and not any(
            clean_name(row.get(key)) for key in ("name", "name_ja", "official_name", "ref")
        ):
            continue
        geometry = linear(row["geometry"].intersection(scope))
        if geometry.is_empty:
            continue
        category = road_class(row)
        name = clean_road_name(row)
        ref = clean_name(row.get("ref") or "")
        key = (name, category, ref)
        if name == "主要道路":
            key = (f"{name}:{row.get('osm_id')}", category, ref)
        groups[key].append(geometry)
        metadata[key] = {"n": name, "c": category, "r": ref}

    features = []
    for key, geometries in groups.items():
        geometry = linear(unary_union(geometries))
        if isinstance(geometry, MultiLineString):
            try:
                geometry = linemerge(geometry)
            except ValueError:
                pass
        if geometry.is_empty:
            continue
        features.append(
            {
                "type": "Feature",
                "properties": metadata[key],
                "geometry": compact_geometry(geometry, 0.000003),
            }
        )
    features.sort(key=lambda feature: (feature["properties"]["c"], feature["properties"]["n"]))
    return features


def clean_route_name(name: object) -> str:
    return re.sub(r"^\d+号線", "", clean_name(name))


def operator_class(operator: str) -> str:
    if "旅客鉄道" in operator:
        return "jr"
    if operator == "東京地下鉄":
        return "metro"
    if operator == "東京都":
        return "toei"
    return "other"


def ward_names_for(geometry, ward_geometries) -> list[str]:
    names = [WARDS[code] for code, ward in ward_geometries.items() if geometry.intersects(ward)]
    if names:
        return names
    nearest_code = min(ward_geometries, key=lambda code: geometry.distance(ward_geometries[code]))
    return [WARDS[nearest_code]]


def build_rail(source_root: Path, scope, ward_geometries):
    rail_root = source_root / "rail" / "N02-25_GML" / "UTF-8"
    railroad = gpd.read_file(rail_root / "N02-25_RailroadSection.geojson", bbox=scope.bounds)
    stations = gpd.read_file(rail_root / "N02-25_Station.geojson", bbox=scope.bounds)

    groups = defaultdict(list)
    metadata = {}
    for row in railroad.to_dict("records"):
        geometry = linear(row["geometry"].intersection(scope))
        if geometry.is_empty:
            continue
        route = clean_route_name(row["N02_003"])
        operator = clean_name(row["N02_004"])
        category = operator_class(operator)
        key = (route, operator, category)
        groups[key].append(geometry)
        metadata[key] = {"n": route, "o": operator, "c": category}

    rail_features = []
    for key, geometries in groups.items():
        geometry = linear(unary_union(geometries))
        if isinstance(geometry, MultiLineString):
            try:
                geometry = linemerge(geometry)
            except ValueError:
                pass
        rail_features.append(
            {
                "type": "Feature",
                "properties": metadata[key],
                "geometry": compact_geometry(geometry, 0.000002),
            }
        )
    rail_features.sort(key=lambda feature: (feature["properties"]["c"], feature["properties"]["n"]))

    station_groups = defaultdict(lambda: {"routes": set(), "operators": set(), "geometries": []})
    for row in stations.to_dict("records"):
        geometry = linear(row["geometry"].intersection(scope))
        if geometry.is_empty:
            continue
        name = clean_name(row["N02_005"])
        item = station_groups[name]
        item["routes"].add(clean_route_name(row["N02_003"]))
        item["operators"].add(clean_name(row["N02_004"]))
        item["geometries"].append(geometry)

    station_features = []
    for name, item in station_groups.items():
        geometry = unary_union(item["geometries"])
        min_x, min_y, max_x, max_y = geometry.bounds
        point = shape({"type": "Point", "coordinates": [(min_x + max_x) / 2, (min_y + max_y) / 2]})
        wards = ward_names_for(point, ward_geometries)
        station_features.append(
            {
                "type": "Feature",
                "properties": {
                    "n": name,
                    "r": sorted(item["routes"]),
                    "o": sorted(item["operators"]),
                    "w": "・".join(wards),
                    "m": name in MAJOR_STATIONS,
                },
                "geometry": compact_geometry(point),
            }
        )
    station_features.sort(key=lambda feature: feature["properties"]["n"])
    return rail_features, station_features


def collection(features):
    return {"type": "FeatureCollection", "features": features}


def feature(name: str, geometry, properties=None):
    return {
        "type": "Feature",
        "properties": {"n": name, **(properties or {})},
        "geometry": compact_geometry(geometry, 0.000002),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, default=DEFAULT_SOURCE_ROOT)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    args = parser.parse_args()
    source_root = args.source_root.resolve()

    towns, ward_geometries, scope, totals, scope_area = build_towns(source_root)
    zoning = build_zoning(source_root, ward_geometries)
    fire = build_fire(source_root, ward_geometries)
    flood = build_flood(source_root, scope)
    parks = build_parks(source_root, scope, ward_geometries)
    land_prices = build_land_prices(source_root, scope)
    shelters = build_shelters(source_root, scope, ward_geometries)
    roads = build_roads(source_root, scope)
    rail, stations = build_rail(source_root, scope, ward_geometries)

    ward_features = []
    for code, ward_name in WARDS.items():
        geometry = ward_geometries[code]
        label = geometry.representative_point()
        ward_features.append(
            feature(
                ward_name,
                geometry,
                {
                    "wc": code,
                    "f": code == "13101",
                    "x": round(label.x, 6),
                    "y": round(label.y, 6),
                },
            )
        )

    total_population = sum(item["p"] for item in totals.values())
    total_households = sum(item["h"] for item in totals.values())
    bundle = {
        "meta": {
            "populationDate": "2026-01-01",
            "population": total_population,
            "households": total_households,
            "wardCount": len(WARDS),
            "townCount": len(towns),
            "stationCount": len(stations),
            "scopeArea": round(scope_area, 2),
            "boundaryYear": 2020,
            "zoningYear": "2025年度（東京都は2026-07-01修正版）",
            "fireYear": "2025年度（東京都は2026-07-01修正版）",
            "floodYear": "2025年度（2026-05更新）",
            "parksDate": "2026-02-02公開ファイル",
            "landPriceDate": "2026-01-01",
            "sheltersDate": "2026-09-07取得",
            "railDate": "2025-12-31",
            "roadsDate": "2026-08-30",
            "parkCount": len(parks),
            "landPriceCount": len(land_prices),
            "shelterCount": len(shelters),
        },
        "scope": feature("千代田区と隣接5区", scope),
        "city": feature("千代田区", ward_geometries["13101"]),
        "wards": collection(ward_features),
        "towns": collection(towns),
        "zoning": collection(zoning),
        "fire": collection(fire),
        "flood": collection(flood),
        "parks": collection(parks),
        "landPrices": collection(land_prices),
        "shelters": collection(shelters),
        "roads": collection(roads),
        "rail": collection(rail),
        "stations": collection(stations),
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(bundle, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write("\n")

    densities = sorted(item["properties"]["d"] for item in towns)
    report = {
        "output": str(args.output),
        "bytes": args.output.stat().st_size,
        "counts": {
            "wards": len(ward_features),
            "towns": len(towns),
            "zoning": len(zoning),
            "fire": len(fire),
            "floodDepths": len(flood),
            "parks": len(parks),
            "landPrices": len(land_prices),
            "shelters": len(shelters),
            "roads": len(roads),
            "railRoutes": len(rail),
            "stations": len(stations),
        },
        "population": total_population,
        "density": {
            "min": min(densities),
            "median": densities[len(densities) // 2],
            "p90": densities[int(len(densities) * 0.9)],
            "max": max(densities),
        },
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
