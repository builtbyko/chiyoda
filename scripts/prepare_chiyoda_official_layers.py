#!/usr/bin/env python3
"""Prepare official Chiyoda City GIS layers for CHiYODA ATLAS.

This script intentionally does the research/download/shape conversion work before
the UI implementation. It downloads Chiyoda City's official SHP ZIPs, converts
them to EPSG:4326 GeoJSON, adds stable common aliases, and writes a schema
summary so an implementation agent does not need to inspect the source files.

Run from the repository root:
    python scripts/prepare_chiyoda_official_layers.py

Dependencies:
    python -m pip install geopandas pyogrio shapely pyproj requests
"""

from __future__ import annotations

import json
import math
import re
import shutil
import tempfile
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from zipfile import ZipFile

import geopandas as gpd
import pandas as pd
import requests
from shapely import make_valid, orient_polygons, set_precision
from shapely.geometry import mapping

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "public" / "data" / "layers"
REPORT_DIR = ROOT / "scripts" / "data"
CACHE = ROOT.parent / "work" / "chiyoda_map" / "data" / "chiyoda" / "official-layers"
SOURCE_PAGE = "https://www.city.chiyoda.lg.jp/koho/machizukuri/toshi/walkable/yoso-bumpujokyo.html"
SOURCE_UPDATED = "2025-06-06"
BASE = "https://www.city.chiyoda.lg.jp/documents/28083"

KAIWAI_NAMES = {
    1: "国際的シティホテルの集積地",
    2: "番町落ち着いた住宅地",
    3: "富士見の学校と緑のある住宅地",
    4: "印刷・出版街（機能転換が進行）",
    5: "古書店街",
    6: "スポーツ用品店街",
    7: "飲食店街",
    8: "学生街",
    9: "医療機関の集積地",
    10: "老店の集積地",
    11: "秋葉原電気街・サブカルチャーの街",
    12: "新産業拠点（情報技術産業等）",
    13: "かつての問屋街（住機能が進展）",
    14: "国際的なビジネスシーン",
    15: "文化財・芸術街",
    16: "一団地の官公庁施設",
}


@dataclass(frozen=True)
class Source:
    key: str
    filename: str
    output: str
    category: str
    label: str


SOURCES = [
    Source("functional_kaiwai", "6_kaiwai_2.zip", "functional-kaiwai.json", "街の個性", "界隈"),
    Source("open_spaces", "5_koukaikuchi.zip", "open-spaces.json", "公開空地", "公開空地"),
    Source("area_management", "8_dantai.zip", "area-management.json", "まちづくり団体", "エリアマネジメント団体・まちづくり団体"),
    Source("memory_plates", "4_4_kiokuhozon.zip", "memory-plates.json", "まちの記憶", "まちの記憶保存プレート"),
]

CULTURAL_SOURCES = [
    Source("culture_chiyoda", "4_1_ku_bunkazai.zip", "cultural-assets.json", "千代田区文化財", "千代田区指定文化財・特別登録文化財"),
    Source("culture_tokyo", "4_2_to_bunkazai.zip", "cultural-assets.json", "東京都文化財", "東京都指定文化財"),
    Source("culture_national", "4_3_kuni_bunkazai.zip", "cultural-assets.json", "国文化財", "国指定文化財・国登録有形文化財"),
    Source("landscape_assets", "4_5_keikan.zip", "cultural-assets.json", "景観資源", "景観まちづくり重要物件・景観重要建造物"),
]

NAME_KEYS = [
    "界隈名", "団体名", "文化財名", "名称", "名称等", "物件名", "施設名",
    "プレート名", "テーマ", "件名", "計画名", "name", "NAME", "Name", "title", "TITLE",
]
TYPE_KEYS = ["分類", "種別", "区分", "指定種別", "指定区分", "type", "TYPE"]
ADDRESS_KEYS = ["所在地", "住所", "設置場所", "場所", "address", "ADDRESS"]
DATE_KEYS = ["指定年月日", "指定日", "設置年度", "年度", "年月日", "date", "DATE"]
ID_KEYS = ["ID", "id", "Id", "番号", "No", "NO", "fid", "FID"]


def clean_scalar(value: Any) -> Any:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except Exception:
        pass
    if hasattr(value, "item"):
        try:
            value = value.item()
        except Exception:
            pass
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, str):
        return unicodedata.normalize("NFKC", value).strip()
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def norm_key(key: Any) -> str:
    value = unicodedata.normalize("NFKC", str(key))
    return re.sub(r"[\s_\-‐‑–—・（）()]+", "", value).lower()


def nonempty(value: Any) -> bool:
    return value not in (None, "", "nan", "NaN")


def pick(props: dict[str, Any], exact: list[str], fuzzy: tuple[str, ...]) -> Any:
    for key in exact:
        if key in props and nonempty(props[key]):
            return props[key]
    normalized = [(key, norm_key(key)) for key in props]
    for token in fuzzy:
        token_n = norm_key(token)
        for key, key_n in normalized:
            if token_n in key_n and nonempty(props[key]):
                return props[key]
    return None


def pick_id(props: dict[str, Any]) -> int | None:
    value = pick(props, ID_KEYS, ("id", "番号"))
    if value is not None:
        try:
            return int(float(str(value)))
        except Exception:
            pass
    # Conservative fallback: only accept a unique integer in the 1..16 range.
    found = []
    for value in props.values():
        try:
            n = int(float(str(value)))
        except Exception:
            continue
        if 1 <= n <= 16:
            found.append(n)
    return found[0] if len(set(found)) == 1 else None


def download(url: str, destination: Path) -> None:
    if destination.exists() and destination.stat().st_size:
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    with requests.get(url, stream=True, timeout=180) as response:
        response.raise_for_status()
        with destination.open("wb") as handle:
            for chunk in response.iter_content(1024 * 1024):
                handle.write(chunk)


def read_shapefiles(zip_path: Path) -> gpd.GeoDataFrame:
    frames: list[gpd.GeoDataFrame] = []
    with tempfile.TemporaryDirectory(prefix="chiyoda-shp-") as tmp:
        extract_root = Path(tmp)
        with ZipFile(zip_path) as archive:
            archive.extractall(extract_root)

        shapefiles = sorted(extract_root.rglob("*.shp"))
        if not shapefiles:
            raise RuntimeError(f"No .shp file found in {zip_path.name}")

        for shp in shapefiles:
            last_error: Exception | None = None
            frame = None
            for encoding in ("utf-8", "cp932", "shift_jis"):
                try:
                    frame = gpd.read_file(shp, encoding=encoding)
                    # Force attribute decoding while the encoding attempt is active.
                    if len(frame):
                        _ = frame.iloc[0].to_dict()
                    break
                except Exception as exc:
                    last_error = exc
                    frame = None
            if frame is None:
                raise RuntimeError(f"Could not read {shp.name}: {last_error}")

            if frame.crs is None:
                minx, miny, maxx, maxy = frame.total_bounds
                if 120 <= minx <= 150 and 20 <= miny <= 50 and 120 <= maxx <= 150 and 20 <= maxy <= 50:
                    frame = frame.set_crs("EPSG:4326")
                else:
                    raise RuntimeError(
                        f"{shp.name} has no CRS and does not look like lon/lat; refusing to guess."
                    )
            else:
                frame = frame.to_crs("EPSG:4326")

            frame["_source_shp"] = shp.name
            frames.append(frame)

    if len(frames) == 1:
        return frames[0]
    return gpd.GeoDataFrame(
        pd.concat(frames, ignore_index=True),
        geometry="geometry",
        crs="EPSG:4326",
    )


def feature_collection(
    frame: gpd.GeoDataFrame,
    source: Source,
    *,
    force_kaiwai_names: bool = False,
) -> dict[str, Any]:
    features: list[dict[str, Any]] = []

    for index, row in frame.iterrows():
        geometry = row.geometry
        if geometry is None or geometry.is_empty:
            continue

        props = {
            str(key): clean_scalar(value)
            for key, value in row.items()
            if key != "geometry" and clean_scalar(value) is not None
        }

        source_id = pick_id(props)
        name = pick(props, NAME_KEYS, ("名称", "界隈", "団体", "文化財", "物件", "テーマ"))
        if not name and force_kaiwai_names and source_id in KAIWAI_NAMES:
            name = KAIWAI_NAMES[source_id]

        feature_props = dict(props)
        feature_props.update({
            "n": clean_scalar(name) or source.label,
            "t": clean_scalar(props.get("詳細分類") or pick(props, TYPE_KEYS, ("種別", "分類", "区分"))) or source.category,
            "a": clean_scalar(pick(props, ADDRESS_KEYS, ("所在地", "住所", "場所"))),
            "d": clean_scalar(pick(props, DATE_KEYS, ("指定年月", "指定日", "年度", "年月日"))),
            "_category": source.category,
            "_dataset": source.key,
            "_source_name": "千代田区「まちなかのウォーカブルな要素の分布状況」",
            "_source_url": SOURCE_PAGE,
            "_source_date": SOURCE_UPDATED,
            "_data_quality": "official_gis",
        })
        if source_id is not None:
            feature_props["_source_id"] = source_id
        feature_props["i"] = f"{source.key}:{index}"

        # Remove only empty aliases; keep original official attributes intact.
        feature_props = {k: v for k, v in feature_props.items() if v is not None}

        features.append({
            "type": "Feature",
            "properties": feature_props,
            "geometry": rounded_coordinates(mapping(orient_polygons(set_precision(make_valid(geometry), 0.000001)))),
        })

    return {"type": "FeatureCollection", "features": features}


def write_geojson(path: Path, collection: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(collection, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


def rounded_coordinates(value):
    if isinstance(value, dict):
        return {key: rounded_coordinates(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [rounded_coordinates(item) for item in value]
    return round(value, 6) if isinstance(value, float) else value


def landscape_name(value):
    # The three aliases are already verified in build_reference_snapshot.mjs.
    aliases = {
        "大成大手町ビル（旧大手町野村ビル）": "大手町野村ビル",
        "猿楽町町会詰所": "神田猿楽町町会詰所",
        "鷹岡株式会社": "鷹岡（株）",
    }
    text = unicodedata.normalize("NFKC", aliases.get(value, value)).replace("株式会社", "株")
    return "".join(char.lower() for char in text if char.isalnum())


def merge_existing_landscape(features):
    path = OUTPUT_DIR / "landscape-properties.json"
    if not path.exists():
        return features
    existing = json.loads(path.read_text(encoding="utf-8"))["features"]
    by_name = {landscape_name(item["properties"]["n"]): item for item in existing}
    merged = {}
    result = []
    for item in features:
        props = item["properties"]
        if props["_category"] != "景観資源":
            result.append(item)
            continue
        previous = by_name.get(landscape_name(props["n"]))
        if previous is None:
            result.append(item)
            continue
        old = previous["properties"]
        identity = f"landscape:{old['i']}"
        if identity in merged:
            merged[identity]["properties"]["t"] = "景観まちづくり重要物件・景観重要建造物"
            continue
        props.update({
            "i": identity, "n": old["n"], "a": old["a"], "d": old["d"],
            "_source_url": old["u"], "_coordinate_quality": "official-point",
        })
        merged[identity] = item
        result.append(item)
    for previous in existing:
        old = previous["properties"]
        identity = f"landscape:{old['i']}"
        if identity in merged:
            continue
        result.append({
            **previous,
            "properties": {
                "i": identity, "n": old["n"], "t": "景観まちづくり重要物件",
                "a": old["a"], "d": old["d"], "_category": "景観資源",
                "_dataset": "landscape_assets", "_source_url": old["u"],
                "_source_date": "2024-12", "_coordinate_quality": old["p"],
                "_data_quality": "official_address_representative_point" if old["p"] == "block" else "official_gis",
            },
        })
    return result


def update_search_index(path=None):
    path = path or ROOT / "public" / "data" / "map-data.json"
    if not path.exists() or not (OUTPUT_DIR / "cultural-assets.json").exists():
        return
    core = json.loads(path.read_text(encoding="utf-8"))
    removed = {i for i, item in enumerate(core["searchTypes"]) if item["d"] in ("landscapeProperties", "culturalAssets")}
    kept = [i for i in range(len(core["searchTypes"])) if i not in removed]
    remap = {old: new for new, old in enumerate(kept)}
    core["searchTypes"] = [core["searchTypes"][i] for i in kept]
    core["search"] = [[name, ward, remap[kind], index] for name, ward, kind, index in core["search"] if kind not in removed]
    type_index = len(core["searchTypes"])
    core["searchTypes"].append({"d": "culturalAssets", "k": "文化・歴史資源", "l": "cultural-assets-points"})
    culture = json.loads((OUTPUT_DIR / "cultural-assets.json").read_text(encoding="utf-8"))
    core["search"].extend([[item["properties"]["n"], "千代田区", type_index, index] for index, item in enumerate(culture["features"])])
    write_geojson(path, core)


def schema_summary(collections: dict[str, dict[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for output, fc in collections.items():
        features = fc["features"]
        keys: dict[str, dict[str, Any]] = {}
        geometry_types: dict[str, int] = {}

        for feature in features:
            geometry_type = feature.get("geometry", {}).get("type", "Unknown")
            geometry_types[geometry_type] = geometry_types.get(geometry_type, 0) + 1
            for key, value in feature.get("properties", {}).items():
                entry = keys.setdefault(key, {"count": 0, "samples": []})
                if nonempty(value):
                    entry["count"] += 1
                    rendered = value if isinstance(value, (str, int, float, bool)) else str(value)
                    if rendered not in entry["samples"] and len(entry["samples"]) < 4:
                        entry["samples"].append(rendered)

        result[output] = {
            "featureCount": len(features),
            "geometryTypes": geometry_types,
            "properties": keys,
        }
    return result


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)

    collections: dict[str, dict[str, Any]] = {}
    CACHE.mkdir(parents=True, exist_ok=True)
    cache = CACHE

    for source in SOURCES:
        zip_path = cache / source.filename
        url = f"{BASE}/{source.filename}"
        print(f"download {url}")
        download(url, zip_path)
        frame = read_shapefiles(zip_path)
        fc = feature_collection(
            frame,
            source,
            force_kaiwai_names=(source.key == "functional_kaiwai"),
        )
        collections[source.output] = fc
        write_geojson(OUTPUT_DIR / source.output, fc)
        print(f"wrote {source.output}: {len(fc['features'])} features")

    cultural_features: list[dict[str, Any]] = []
    for source in CULTURAL_SOURCES:
        zip_path = cache / source.filename
        url = f"{BASE}/{source.filename}"
        print(f"download {url}")
        download(url, zip_path)
        frame = read_shapefiles(zip_path)
        fc = feature_collection(frame, source)
        cultural_features.extend(fc["features"])
        print(f"merged {source.key}: {len(fc['features'])} features")

    cultural = {"type": "FeatureCollection", "features": merge_existing_landscape(cultural_features)}
    collections["cultural-assets.json"] = cultural
    write_geojson(OUTPUT_DIR / "cultural-assets.json", cultural)
    print(f"wrote cultural-assets.json: {len(cultural['features'])} features")

    summary = {
        "generatedFrom": SOURCE_PAGE,
        "officialPageUpdated": SOURCE_UPDATED,
        "generatedFiles": schema_summary(collections),
    }
    (REPORT_DIR / "chiyoda-official-layer-schema.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print("wrote scripts/data/chiyoda-official-layer-schema.json")
    update_search_index()


if __name__ == "__main__":
    main()
