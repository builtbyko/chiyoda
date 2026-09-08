"""Download the official source files used by the optional atlas layers."""

from __future__ import annotations

import argparse
from pathlib import Path
from zipfile import ZipFile

import requests


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE_ROOT = ROOT.parent / "work" / "chiyoda_map" / "data"

SOURCES = (
    (
        "daytime-population-2020",
        "tj20zv1100.csv",
        "https://www.toukei.metro.tokyo.lg.jp/tyukanj/2020/tj20zv1100.csv",
    ),
    (
        "land-use-tokyo-2021",
        "R03.zip",
        "https://data.storage.data.metro.tokyo.lg.jp/toshiseibi/R03.zip",
    ),
    (
        "planning-tokyo",
        "gis02_koudochiku.zip",
        "https://www.opendata.metro.tokyo.lg.jp/toshiseibi/gis02_koudochiku.zip",
    ),
    (
        "planning-tokyo",
        "gis04_chikukeikaku.zip",
        "https://www.opendata.metro.tokyo.lg.jp/toshiseibi/gis04_chikukeikaku.zip",
    ),
    (
        "planning-tokyo",
        "gis05_saikaihatsuchikukeikaku.zip",
        "https://www.opendata.metro.tokyo.lg.jp/toshiseibi/gis05_saikaihatsuchikukeikaku.zip",
    ),
    (
        "planning-tokyo",
        "gis06_koudoriyouchiku.zip",
        "https://www.opendata.metro.tokyo.lg.jp/toshiseibi/gis06_koudoriyouchiku.zip",
    ),
    (
        "planning-tokyo",
        "gis07_tokuteigaiku.zip",
        "https://www.opendata.metro.tokyo.lg.jp/toshiseibi/gis07_tokuteigaiku.zip",
    ),
    (
        "planning-tokyo",
        "gis08_toshisaiseitokubetsuchiku.zip",
        "https://www.opendata.metro.tokyo.lg.jp/toshiseibi/gis08_toshisaiseitokubetsuchiku.zip",
    ),
    (
        "green-tokyo-2026",
        "green_chuui.pdf",
        "https://data.storage.data.metro.tokyo.lg.jp/toshiseibi/green_chuui.pdf",
    ),
    (
        "green-tokyo-2026",
        "01_kouenryokuchi.zip",
        "https://data.storage.data.metro.tokyo.lg.jp/toshiseibi/01_kouenryokuchi.zip",
    ),
    (
        "land-price-2026",
        "L01-26_GML.zip",
        "https://nlftp.mlit.go.jp/ksj/gml/data/L01/L01-26/L01-26_GML.zip",
    ),
    (
        "flood-2025",
        "A31a-25_13_10_GEOJSON.zip",
        "https://nlftp.mlit.go.jp/ksj/gml/data/A31a/A31a-25/A31a-25_13_10_GEOJSON.zip",
    ),
    (
        "flood-2025",
        "A31a-25_13_20_GEOJSON.zip",
        "https://nlftp.mlit.go.jp/ksj/gml/data/A31a/A31a-25/A31a-25_13_20_GEOJSON.zip",
    ),
    (
        "shelters-gsi-2026-09-07",
        "sih-10-909-403.geojson",
        "https://cyberjapandata.gsi.go.jp/xyz/sih/10/909/403.geojson",
    ),
    (
        "shelters-gsi-2026-09-07",
        "sfh-10-909-403.geojson",
        "https://cyberjapandata.gsi.go.jp/xyz/sfh/10/909/403.geojson",
    ),
)

EXTRACTIONS = {
    "R03.zip": "expanded",
    "gis02_koudochiku.zip": "koudochiku",
    "gis04_chikukeikaku.zip": "chikukeikaku",
    "gis05_saikaihatsuchikukeikaku.zip": "saikaihatsuchikukeikaku",
    "gis06_koudoriyouchiku.zip": "koudoriyouchiku",
    "gis07_tokuteigaiku.zip": "tokuteigaiku",
    "gis08_toshisaiseitokubetsuchiku.zip": "toshisaiseitokubetsuchiku",
    "01_kouenryokuchi.zip": "expanded",
    "L01-26_GML.zip": "expanded",
    "A31a-25_13_10_GEOJSON.zip": "river-10",
    "A31a-25_13_20_GEOJSON.zip": "river-20",
}


def download(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with requests.get(url, stream=True, timeout=180) as response:
        response.raise_for_status()
        temporary = destination.with_suffix(destination.suffix + ".part")
        with temporary.open("wb") as handle:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                handle.write(chunk)
        temporary.replace(destination)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, default=DEFAULT_SOURCE_ROOT)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    for folder, filename, url in SOURCES:
        destination = args.source_root / folder / filename
        if destination.exists() and destination.stat().st_size and not args.force:
            print(f"cached  {filename} ({destination.stat().st_size:,} bytes)")
        else:
            download(url, destination)
            print(f"fetched {filename} ({destination.stat().st_size:,} bytes)")

        extract_name = EXTRACTIONS.get(filename)
        if extract_name:
            extract_root = destination.parent / extract_name
            if args.force or not extract_root.exists() or not any(extract_root.iterdir()):
                extract_root.mkdir(parents=True, exist_ok=True)
                with ZipFile(destination) as archive:
                    archive.extractall(extract_root)
                print(f"expanded {filename} -> {extract_name}")


if __name__ == "__main__":
    main()
