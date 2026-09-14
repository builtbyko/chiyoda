"""Offline checks for provenance and search safety of the slope preprocessor."""

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from bs4 import BeautifulSoup
from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import transform

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("slopes_builder", ROOT / "scripts/build_slopes.py")
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)


class SlopeBuilderTests(unittest.TestCase):
    def test_only_explicit_published_coordinate_query_is_accepted(self):
        html = '<a href="https://www.google.co.jp/maps/?q=35.697839,139.760841">Google Mapで見る</a>'
        self.assertEqual(builder.published_point(BeautifulSoup(html, "html.parser")), [139.760841, 35.697839])
        precise = '<a href="https://www.google.co.jp/maps/?q=35.6978391,139.7608412">Map</a>'
        self.assertEqual(builder.published_point(BeautifulSoup(precise, "html.parser")), [139.7608412, 35.6978391])
        for html in (
            '<a href="https://www.google.com/maps/?q=錦華坂">Google Mapで見る</a>',
            '<iframe src="https://www.google.com/maps/embed?pb=!2d139.760841!3d35.697839"></iframe>',
            '<a href="https://unrelated.example/maps/?q=35.697839,139.760841">Map</a>',
            '<a href="https://www.google.com/maps/@35.697839,139.760841,16z">Map</a>',
        ):
            with self.subTest(html=html), self.assertRaises(ValueError):
                builder.published_point(BeautifulSoup(html, "html.parser"))

    def test_conflicting_explicit_points_are_not_arbitrarily_chosen(self):
        html = ('<a href="https://www.google.com/maps/?q=35.697839,139.760841">Map</a>'
                '<a href="https://www.google.com/maps/?q=35.700000,139.770000">Map</a>')
        with self.assertRaises(ValueError):
            builder.published_point(BeautifulSoup(html, "html.parser"))

    def test_homonym_requires_unambiguous_published_address(self):
        notes = [
            {"name": "富士見坂", "reading": "ふじみざか", "addressTerms": ["永田町"]},
            {"name": "富士見坂", "reading": "ふじみざか", "addressTerms": ["神田小川町"]},
        ]
        selected, reason = builder.choose_note({"name": "富士見坂", "address": "永田町二丁目"}, notes, [])
        self.assertEqual(selected, notes[0])
        self.assertIsNone(reason)
        for address in ("千代田区", "永田町・神田小川町"):
            selected, reason = builder.choose_note({"name": "富士見坂", "address": address}, notes, [])
            self.assertIsNone(selected)
            self.assertIn("Ambiguous", reason)

    def test_reviewed_title_alias_is_bound_to_exact_spot(self):
        note = {"name": "汐見坂", "reading": "しおみざか", "tourismName": "汐見坂〔しおみざか〕",
                "tourismSpotId": 11, "cityNumber": 1}
        city = [{"name": "汐見坂", "reading": "しおみざか", "number": 1}]
        item = {"name": "汐見坂〔しおみざか〕", "spotId": 11, "address": "千代田1"}
        selected, reason = builder.choose_note(item, [note], city)
        self.assertEqual(selected, note)
        self.assertIsNone(reason)
        item["spotId"] = 999
        selected, _ = builder.choose_note(item, [note], city)
        self.assertIsNone(selected)

    def test_boundary_allowance_is_limited_to_documented_slope(self):
        core = json.loads((ROOT / "public/data/map-data.json").read_text(encoding="utf-8"))
        projector = Transformer.from_crs(4326, 6677, always_xy=True)
        city = transform(projector.transform, shape(core["city"]["geometry"]))
        item = {"spotId": 199, "coordinates": [139.766993, 35.699756], "address": "外神田二丁目"}
        note = {"name": "昌平坂", "cityNumber": 55}
        distance, allowed = builder.verify_location(item, note, city)
        self.assertGreater(distance, 2)
        self.assertLessEqual(distance, 10)
        self.assertTrue(allowed)
        self.assertEqual(item["coordinates"], [139.766993, 35.699756])
        with self.assertRaises(ValueError):
            builder.verify_location({**item, "spotId": 999}, note, city)
        with self.assertRaises(ValueError):
            builder.verify_location(item, {"name": "他の坂", "cityNumber": 55}, city)
        with self.assertRaises(ValueError):
            builder.verify_location({**item, "coordinates": [139.723455, 35.71242]}, note, city)

    def test_cached_acquisition_date_is_not_fabricated(self):
        with tempfile.TemporaryDirectory() as temporary:
            cache = Path(temporary)
            (cache / "sample.html").write_text("official cached source", encoding="utf-8")
            url = builder.TOURISM_ROOT + "/app/spot/detail/175"
            with patch.object(builder, "CACHE", cache), patch.object(builder.requests.Session, "get", side_effect=AssertionError("Network forbidden")):
                fetcher = builder.Fetcher()
                self.assertEqual(fetcher.get(url, "sample"), ("official cached source", None))
                for record, expected in (
                    ({"url": url, "retrievedDate": "2026-09-13"}, "2026-09-13"),
                    ({"url": "https://visit-chiyoda.tokyo/app/spot/detail/999", "retrievedDate": "2026-09-13"}, None),
                    ({"url": url, "retrievedDate": "not-a-date"}, None),
                    ({"url": url, "retrievedDate": "2099-01-01"}, None),
                ):
                    (cache / "sample.fetch.json").write_text(json.dumps(record), encoding="utf-8")
                    self.assertEqual(fetcher.get(url, "sample")[1], expected)
                self.assertEqual(fetcher.requests, 0)

    def test_search_regeneration_preserves_other_rows_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            layer = directory / "slopes.json"
            core_path = directory / "map-data.json"
            features = [
                {"properties": {"n": "富士見坂", "a": "永田町二丁目", "sourceDate": "2023-03-08", "retrievedDate": "2026-09-13"}},
                {"properties": {"n": "富士見坂", "a": "神田小川町三丁目", "sourceDate": "2023-03-08"}},
            ]
            layer.write_text(json.dumps({"features": features}, ensure_ascii=False), encoding="utf-8")
            original = {"meta": {"chiyodaPopulation": 69139}, "searchTypes": [{"d": "towns", "k": "町丁目", "l": "town-place"}],
                        "search": [["一ツ橋一丁目", "千代田区", 0, 0]]}
            core_path.write_text(json.dumps(original, ensure_ascii=False), encoding="utf-8")
            with patch.object(builder, "OUTPUT", layer):
                builder.update_search_index(core_path)
                result = json.loads(core_path.read_text(encoding="utf-8"))
                self.assertEqual(result["search"][0], original["search"][0])
                self.assertEqual(result["searchTypes"][0], original["searchTypes"][0])
                self.assertEqual(result["searchTypes"][1], {"d": "slopes", "k": "坂", "l": "slopes-points"})
                self.assertEqual(result["search"][1:], [["富士見坂（永田町）", "千代田区", 1, 0], ["富士見坂（神田小川町）", "千代田区", 1, 1]])
                self.assertEqual(result["meta"]["slopesCount"], 2)
                self.assertNotIn("slopesRetrievedDate", result["meta"])
                self.assertEqual(result["meta"]["chiyodaPopulation"], 69139)
                first = core_path.read_bytes()
                builder.update_search_index(core_path)
                self.assertEqual(core_path.read_bytes(), first)
                for feature in features:
                    feature["properties"].pop("sourceDate", None)
                layer.write_text(json.dumps({"features": features}, ensure_ascii=False), encoding="utf-8")
                builder.update_search_index(core_path)
                without_source_dates = json.loads(core_path.read_text(encoding="utf-8"))
                self.assertNotIn("slopesSourceDate", without_source_dates["meta"])

    def test_partial_refresh_failure_never_replaces_existing_layer_or_core(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            layer = directory / "slopes.json"
            core_path = directory / "map-data.json"
            notes_path = directory / "notes.json"
            report_path = directory / "report.json"
            layer.write_text('{"existing":"verified layer"}', encoding="utf-8")
            city_geometry = json.loads((ROOT / "public/data/map-data.json").read_text(encoding="utf-8"))["city"]
            core_path.write_text(json.dumps({"city": city_geometry, "meta": {"existing": "statistics"},
                                           "searchTypes": [], "search": []}), encoding="utf-8")
            notes_path.write_text(json.dumps({"items": [{"cityNumber": 1, "name": "汐見坂", "reading": "しおみざか", "summary": "眺望にちなむ名。"}]}), encoding="utf-8")
            original_layer = layer.read_bytes()
            original_core = core_path.read_bytes()

            def fetch(url, key):
                if key == "spot-1":
                    raise builder.requests.ConnectionError("Simulated one failed official detail page")
                return "official fixture", "2026-09-14"

            city = [{"number": 1, "name": "汐見坂", "reading": "しおみざか", "url": builder.CITY_URL}]
            parsed = {"name": "汐見坂", "address": "千代田1", "coordinates": [139.756676, 35.68761], "text": ""}
            with patch.object(builder, "OUTPUT", layer), patch.object(builder, "CORE", core_path), \
                 patch.object(builder, "NOTES", notes_path), patch.object(builder, "REPORT", report_path), \
                 patch.object(builder.Fetcher, "get", side_effect=fetch), \
                 patch.object(builder, "city_entries", return_value=(city, "2023-03-08")), \
                 patch.object(builder, "catalog_ids", return_value=list(range(56))), \
                 patch.object(builder, "detail", side_effect=lambda _: dict(parsed)), \
                 patch.object(builder, "verify_location", return_value=(0, False)), \
                 patch("sys.argv", ["build_slopes.py", "--refresh"]):
                with self.assertRaisesRegex(RuntimeError, "Official source retrieval failed") as caught:
                    builder.main()
                self.assertIn("Simulated one failed official detail page", str(caught.exception))
            self.assertEqual(layer.read_bytes(), original_layer)
            self.assertEqual(core_path.read_bytes(), original_core)
            self.assertFalse(report_path.exists())

    def test_absent_generated_layer_does_not_change_base_bundle(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            core_path = directory / "map-data.json"
            core_path.write_text('{"meta":{}}', encoding="utf-8")
            with patch.object(builder, "OUTPUT", directory / "missing.json"):
                builder.update_search_index(core_path)
            self.assertEqual(core_path.read_text(encoding="utf-8"), '{"meta":{}}')


if __name__ == "__main__":
    unittest.main()
