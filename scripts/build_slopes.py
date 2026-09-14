#!/usr/bin/env python3
"""Build named-slope guide points from a bounded official tourism catalogue.

Points come ONLY from coordinate-valued map links published on each Chiyoda
Tourism Association detail page. They do not describe slope extents, summits,
bottoms, gradient or a municipal GIS dataset. No Google request/geocoding is
performed. Cached original HTML and actual acquisition dates stay outside Git.
"""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import date, datetime, timezone, timedelta
import json
from pathlib import Path
import re
import time
from urllib.parse import parse_qs, urljoin, urlparse

from bs4 import BeautifulSoup
import requests
from pyproj import Transformer
from shapely.geometry import Point, shape
from shapely.ops import transform

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "../work/chiyoda_map/data/next-stage/slopes"
NOTES = ROOT / "scripts/data/slopes-notes.json"
OUTPUT = ROOT / "public/data/layers/slopes.json"
REPORT = ROOT / "scripts/data/slopes-build-report.json"
CORE = ROOT / "public/data/map-data.json"
CITY_URL = "https://www.city.chiyoda.lg.jp/koho/kuse/gaiyo/yokoso/saka.html"
TOURISM_ROOT = "https://visit-chiyoda.tokyo"
CATALOG_URL = TOURISM_ROOT + "/app/spot?page={page}&searchSubCategory%5B0%5D=16"
ALLOWED_HOSTS = {"www.city.chiyoda.lg.jp", "visit-chiyoda.tokyo"}
JST = timezone(timedelta(hours=9))


def write_json(path, value, *, compact=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False,
                               separators=(",", ":") if compact else None,
                               indent=None if compact else 2) + ("" if compact else "\n"),
                    encoding="utf-8")


def normalized(value):
    return re.sub(r"[\s　・～〜ー－‐-]", "", str(value or ""))


class Fetcher:
    def __init__(self, refresh=False):
        self.refresh = refresh
        self.session = requests.Session()
        self.session.headers["User-Agent"] = "CHiYODA-ATLAS-slope-data-preparation/1.0"
        self.requests = 0

    def get(self, url, key):
        if urlparse(url).hostname not in ALLOWED_HOSTS:
            raise ValueError(f"Unapproved source host: {url}")
        path = CACHE / (key + ".html")
        record = CACHE / (key + ".fetch.json")
        if path.exists() and not self.refresh:
            metadata = json.loads(record.read_text(encoding="utf-8")) if record.exists() else {}
            acquired = metadata.get("retrievedDate") if metadata.get("url") == url else None
            if acquired:
                try:
                    if date.fromisoformat(acquired) > datetime.now(JST).date():
                        acquired = None
                except (TypeError, ValueError):
                    acquired = None
            return path.read_text(encoding="utf-8"), acquired
        if self.requests >= 60:
            raise ValueError("Bounded source request budget exceeded")
        self.requests += 1
        response = self.session.get(url, timeout=35, allow_redirects=False)
        response.raise_for_status()
        if 300 <= response.status_code < 400:
            raise ValueError(f"Redirect requires source review: {url}")
        response.encoding = "utf-8"
        html = response.text
        acquired = datetime.now(JST).date().isoformat()
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_text(html, encoding="utf-8")
        write_json(record, {"url": url, "retrievedDate": acquired})
        time.sleep(0.12)
        return html, acquired


def city_entries(html):
    soup = BeautifulSoup(html, "html.parser")
    entries = []
    text = soup.get_text("\n", strip=True)
    date_match = re.search(r"更新日[：:]\s*(\d{4})年(\d{1,2})月(\d{1,2})日", text)
    source_date = "-".join((date_match[1], date_match[2].zfill(2), date_match[3].zfill(2))) if date_match else None
    for heading in soup.find_all(["h2", "h3"]):
        title = heading.get_text("", strip=True)
        match = re.match(r"(\d+)\s*[.．]\s*([^（(]+)[（(]([^）)]+)[）)]", title)
        if not match:
            continue
        anchor = heading.get("id") or heading.get("name")
        if not anchor:
            nested = heading.find(attrs={"id": True}) or heading.find(attrs={"name": True})
            anchor = (nested.get("id") or nested.get("name")) if nested else None
        if not anchor:
            sibling = heading.find_previous_sibling()
            if sibling and sibling.name in {"a", "span"}:
                nested = sibling if sibling.get("id") or sibling.get("name") else sibling.find(attrs={"name": True})
                anchor = (nested.get("id") or nested.get("name")) if nested else None
        entries.append({"number": int(match[1]), "name": match[2].strip(), "reading": match[3],
                        "url": CITY_URL + ("#" + anchor if anchor else "")})
    if len(entries) != 56 or len({row["number"] for row in entries}) != 56:
        raise ValueError(f"Official city list parser expected 56 distinct entries, got {len(entries)}")
    return entries, source_date


def catalog_ids(html):
    soup = BeautifulSoup(html, "html.parser")
    return list(dict.fromkeys(int(match[1]) for a in soup.find_all("a", href=True)
                             if (match := re.fullmatch(r"/app/spot/detail/(\d+)/?", urlparse(urljoin(TOURISM_ROOT, a["href"])).path))))


def published_point(soup):
    candidates = set()
    for anchor in soup.find_all("a", href=True):
        href = urlparse(anchor["href"])
        if href.hostname not in {"www.google.co.jp", "www.google.com", "maps.google.com"}:
            continue
        query = parse_qs(href.query).get("q", [])
        for value in query:
            match = re.fullmatch(r"\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*", value)
            if match:
                candidates.add((float(match[2]), float(match[1])))
    if len(candidates) != 1:
        raise ValueError(f"Expected one explicit published map coordinate; found {len(candidates)}")
    lon, lat = candidates.pop()
    if not 139.65 < lon < 139.85 or not 35.60 < lat < 35.76:
        raise ValueError("Published map coordinate is outside the study area")
    return [lon, lat]


def detail(html):
    soup = BeautifulSoup(html, "html.parser")
    title = soup.title.get_text("", strip=True) if soup.title else ""
    match = re.match(r"(.+?)[（(]スポット紹介[）)]", title)
    if not match:
        raise ValueError(f"Unrecognized official spot title: {title}")
    name = match[1].strip()
    address = None
    for tag in soup.find_all(["li", "dt", "dd"]):
        value = tag.get_text("", strip=True)
        if value.startswith("所在地") and len(value) > 3:
            address = value.removeprefix("所在地").lstrip(" :：")
            break
        if value == "所在地":
            sibling = tag.find_next_sibling()
            if sibling:
                address = sibling.get_text("", strip=True)
                break
    if not address:
        lines = list(soup.stripped_strings)
        for index, line in enumerate(lines):
            if line == "所在地" and index + 1 < len(lines):
                address = lines[index + 1]
                break
    if not address:
        raise ValueError("Official spot address was not found")
    return {"name": name, "address": address, "coordinates": published_point(soup),
            "text": soup.get_text("", strip=True)}


def choose_note(item, notes, city):
    candidates = [note for note in notes if note["name"] == item["name"] or (
        note.get("tourismName") == item["name"] and note.get("tourismSpotId") == item.get("spotId"))]
    if not candidates:
        return None, "No reviewed short note"
    if len(candidates) > 1:
        candidates = [note for note in candidates if any(normalized(term) in normalized(item["address"])
                      for term in note.get("addressTerms", []))]
    if len(candidates) != 1:
        return None, "Ambiguous same-name city/tourism correspondence"
    note = candidates[0]
    if note.get("cityNumber") is not None:
        city_row = next((row for row in city if row["number"] == note["cityNumber"]), None)
        if not city_row or city_row["name"] != note["name"] or city_row["reading"] != note["reading"]:
            return None, "City list name/reading does not match the reviewed note"
    return note, None


def verify_location(item, note, city_projected):
    projector = Transformer.from_crs(4326, 6677, always_xy=True)
    point = transform(projector.transform, Point(item["coordinates"]))
    distance = city_projected.distance(point)
    # Only this independently documented boundary slope gets a 10m allowance.
    # It preserves the published point; it does not redefine a ward boundary.
    boundary_slope = (item.get("spotId") == 199 and note.get("cityNumber") == 55
                      and note["name"] == "昌平坂")
    if distance > (10 if boundary_slope else 2):
        raise ValueError(f"Published point is {distance:.1f}m outside Chiyoda; published address is {item['address']}. No inferred coordinate correction applied.")
    return distance, boundary_slope


def update_search_index(core_path=None):
    """Restore only slope search rows from the generated lightweight layer.

    This entry point is offline and needs neither source pages nor notes. The
    base map-data builder may call it after replacing its own core bundle.
    """
    core_path = Path(core_path) if core_path is not None else CORE
    if not OUTPUT.exists() or not core_path.exists():
        return
    features = json.loads(OUTPUT.read_text(encoding="utf-8"))["features"]
    core = json.loads(core_path.read_text(encoding="utf-8"))
    types = core["searchTypes"]
    slopes_type = next((index for index, entry in enumerate(types) if entry.get("d") == "slopes"), None)
    if slopes_type is None:
        slopes_type = len(types)
        types.append({"d": "slopes", "k": "坂", "l": "slopes-points"})
    else:
        types[slopes_type] = {"d": "slopes", "k": "坂", "l": "slopes-points"}
    core["search"] = [row for row in core["search"] if row[2] != slopes_type]
    duplicates = Counter(feature["properties"]["n"] for feature in features)
    for feature_index, feature in enumerate(features):
        p = feature["properties"]
        address = re.sub(r"^(?:東京都)?千代田区", "", p["a"])
        # Use a literal published town-name prefix for compact homonym labels.
        town = re.match(r"^(.+?)(?:[一二三四五六七八九十]+丁目|[0-9０-９]|[～〜])", address)
        label = town[1] if town else address
        n = p["n"] + ("（" + label + "）" if duplicates[p["n"]] > 1 else "")
        core["search"].append([n, "千代田区", slopes_type, feature_index])
    core["meta"]["slopesCount"] = len(features)
    acquired = [feature["properties"].get("retrievedDate") for feature in features]
    if all(acquired):
        core["meta"]["slopesRetrievedDate"] = max(acquired)
    else:
        core["meta"].pop("slopesRetrievedDate", None)
    source_dates = [feature["properties"].get("sourceDate") for feature in features]
    if any(source_dates):
        core["meta"]["slopesSourceDate"] = max(date for date in source_dates if date)
    else:
        core["meta"].pop("slopesSourceDate", None)
    write_json(core_path, core, compact=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="Reacquire only the bounded official source pages")
    args = parser.parse_args()
    fetcher = Fetcher(args.refresh)
    city_html, city_acquired = fetcher.get(CITY_URL, "city-slopes")
    city, source_date = city_entries(city_html)
    ids = []
    for page in range(1, 4):
        html, _ = fetcher.get(CATALOG_URL.format(page=page), f"catalog-{page}")
        ids.extend(catalog_ids(html))
    ids = list(dict.fromkeys(ids))
    if len(ids) != 56:
        raise ValueError(f"Expected 56 official tourism-category spots, found {len(ids)}")
    notes = json.loads(NOTES.read_text(encoding="utf-8"))["items"]
    core = json.loads(CORE.read_text(encoding="utf-8"))
    projector = Transformer.from_crs(4326, 6677, always_xy=True)
    chiyoda = transform(projector.transform, shape(core["city"]["geometry"]))
    features, excluded, source_rows, boundary_exceptions, fetch_failures = [], [], [], [], []
    for spot_id in ids:
        url = f"{TOURISM_ROOT}/app/spot/detail/{spot_id}"
        item = None
        try:
            html, acquired = fetcher.get(url, f"spot-{spot_id}")
            item = detail(html)
            item["spotId"] = spot_id
            source_rows.append({"id": spot_id, "name": item["name"], "address": item["address"],
                                "coordinates": item["coordinates"]})
            note, reason = choose_note(item, notes, city)
            if reason:
                raise ValueError(reason)
            outside_distance, boundary_slope = verify_location(item, note, chiyoda)
            city_row = next((row for row in city if row["number"] == note.get("cityNumber")), None)
            props = {"i": f"visit-chiyoda-{spot_id}", "n": note["name"], "w": "千代田区", "r": note["reading"],
                     "a": item["address"], "summary": note["summary"], "sourceUrl": url,
                     "positionType": "tourism-guide-point", "positionSourceUrl": url,
                     "dataNature": "公式資料をATLASで整理（位置：千代田区観光協会）",
                     "_source_url": url, "_coordinate_quality": "tourism-guide-point",
                     "_data_nature": "official-materials-prepared"}
            if acquired:
                props["retrievedDate"] = acquired
            if city_row:
                props["citySourceUrl"] = city_row["url"]
            if city_row and source_date:
                props["sourceDate"] = source_date
            if boundary_slope:
                props["positionNote"] = "千代田区と文京区の境界にある坂。点は観光案内の掲載位置。"
                boundary_exceptions.append({"id": spot_id, "name": note["name"],
                                            "outsideMeters": round(outside_distance, 1),
                                            "citySourceUrl": city_row["url"],
                                            "reason": "Municipal text explicitly identifies a ward-boundary slope; published point unchanged; projected distance <=10m."})
            features.append({"type": "Feature", "properties": props,
                             "geometry": {"type": "Point", "coordinates": item["coordinates"]}})
        except requests.RequestException as exc:
            fetch_failures.append({"id": spot_id, "url": url, "reason": str(exc)})
        except ValueError as exc:
            exclusion = {"id": spot_id, "url": url, "reason": str(exc)}
            if item:
                exclusion.update({"name": item["name"], "address": item["address"],
                                  "coordinates": item["coordinates"]})
            excluded.append(exclusion)
    if fetch_failures:
        raise RuntimeError("Official source retrieval failed; existing generated layer and search bundle were not overwritten: "
                           + json.dumps(fetch_failures, ensure_ascii=False))
    if not features:
        raise ValueError("No verified published guide points; existing generated outputs were not overwritten")
    write_json(OUTPUT, {"type": "FeatureCollection", "features": features}, compact=True)
    update_search_index()
    represented = {note.get("cityNumber") for note in notes if any(
        feature["properties"]["n"] == note["name"] and (not note.get("addressTerms") or any(
        normalized(term) in normalized(feature["properties"]["a"]) for term in note["addressTerms"])) for feature in features)}
    write_json(REPORT, {"builtDate": datetime.now(JST).date().isoformat(), "citySourceUrl": CITY_URL,
                       "citySourceDate": source_date, "cityRetrievedDate": city_acquired,
                       "tourismCatalogUrl": CATALOG_URL.format(page=1), "tourismSpotCount": len(ids),
                       "featureCount": len(features), "actualNetworkRequestCount": fetcher.requests,
                       "positionType": "tourism-guide-point", "coordinatePrecision": "publisher coordinates retained",
                       "coordinateBoundaryValidation": "EPSG:6677 metre distances; normal rounding tolerance 2m; only officially described 昌平坂 (spot 199) accepts <=10m, unchanged position.",
                       "boundaryExceptions": boundary_exceptions,
                       "officialGisFound": False,
                       "officialGisCheck": "Saved municipal ArcGIS catalog: 11 services / 70 layers; no named-slope dataset identified. No geometry inferred.",
                       "sources": source_rows, "excluded": excluded,
                       "cityEntriesNotRepresented": [row for row in city if row["number"] not in represented]})
    print(json.dumps({"features": len(features), "excluded": excluded, "requests": fetcher.requests}, ensure_ascii=False))


if __name__ == "__main__":
    main()
