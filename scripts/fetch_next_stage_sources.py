#!/usr/bin/env python3
"""Cache next-stage reference sources outside the CHiYODA ATLAS repository."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from zipfile import ZipFile
import requests

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CACHE = ROOT.parent / "work" / "chiyoda_map" / "data" / "next-stage"

FILES = [
    (
        "chiyoda/roads",
        "walkable-roads.pdf",
        "https://www.city.chiyoda.lg.jp/documents/28083/9_douro.pdf",
    ),
    (
        "chiyoda/roads",
        "route-network.pdf",
        "https://www.city.chiyoda.lg.jp/documents/28493/rosenmozu_3.pdf",
    ),
    (
        "chiyoda/river",
        "river-guideline.pdf",
        "https://www.city.chiyoda.lg.jp/documents/28390/gideline.pdf",
    ),
    (
        "chiyoda/river",
        "river-space.zip",
        "https://www.city.chiyoda.lg.jp/documents/28083/1_kasen.zip",
    ),
]

PLATEAU_METADATA = (
    "https://www.geospatial.jp/ckan/api/3/action/package_show"
    "?id=plateau-tokyo23ku"
)


def download(url: str, destination: Path, force: bool = False) -> None:
    if destination.exists() and destination.stat().st_size and not force:
        print(f"cached  {destination}")
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".part")
    with requests.get(url, stream=True, timeout=180) as response:
        response.raise_for_status()
        with temporary.open("wb") as handle:
            for chunk in response.iter_content(1024 * 1024):
                if chunk:
                    handle.write(chunk)
    temporary.replace(destination)
    print(f"fetched {destination} ({destination.stat().st_size:,} bytes)")


def fetch_json(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with requests.get(url, timeout=60) as response:
        response.raise_for_status()
        data = response.json()
    destination.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"wrote   {destination}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-root", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    for folder, filename, url in FILES:
        path = args.cache_root / folder / filename
        try:
            download(url, path, args.force)
        except requests.RequestException as exc:
            print(f"warning: {url}: {exc}")

    river_zip = args.cache_root / "chiyoda/river/river-space.zip"
    river_expanded = args.cache_root / "chiyoda/river/river-space"
    if river_zip.exists() and (args.force or not river_expanded.exists()):
        river_expanded.mkdir(parents=True, exist_ok=True)
        with ZipFile(river_zip) as archive:
            archive.extractall(river_expanded)
        print(f"expanded {river_zip} -> {river_expanded}")

    # Metadata only: do NOT automatically download huge PLATEAU resources.
    try:
        fetch_json(
            PLATEAU_METADATA,
            args.cache_root / "plateau/metadata/plateau-tokyo23ku.json",
        )
    except Exception as exc:
        print(f"warning: PLATEAU metadata could not be fetched: {exc}")

    print()
    print("Cache root:")
    print(args.cache_root.resolve())
    print("PLATEAU data files were NOT downloaded.")


if __name__ == "__main__":
    main()
