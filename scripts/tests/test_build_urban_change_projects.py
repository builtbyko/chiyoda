"""Offline checks for urban-change acquisition dates and table attributes."""
import importlib.util
import json
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import Mock, patch


spec = importlib.util.spec_from_file_location(
    "urban_change_dates", Path(__file__).resolve().parents[1] / "build_urban_change_projects.py"
)
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class UrbanChangeDateAndAttributeTests(unittest.TestCase):
    def test_table_separates_construction_type_without_changing_completion(self):
        for token in ("新設", "増改修", "新築", "増築"):
            with self.subTest(token=token):
                html = f"""<p id="tmp_update">更新日：2026年6月10日</p>
                <table><tr><th>建築名称</th><th>所在地</th><th>建物用途・種別</th>
                <th>延べ面積</th><th>完了予定年月</th><th>備考</th></tr>
                <tr><td>対象計画</td><td>丸の内一丁目1-3</td>
                <td>物販店舗、飲食店 {token}</td><td>223,572平方メートル</td>
                <td>2030年3月</td><td>計画</td></tr></table>"""
                records = builder.parse_env_page("https://example.test/r7.html", html)
                self.assertEqual(len(records), 1)
                self.assertEqual(records[0]["constructionType"], token)
                self.assertEqual(records[0]["uses"], "物販店舗、飲食店")
                self.assertEqual(records[0]["completion"], "2030-03")
                self.assertEqual(records[0]["grossFloorArea"], 223572)
                self.assertEqual(records[0]["sourceDate"], "2026-06-10")

    def test_old_cache_without_record_has_unknown_acquisition_date(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory, "page.html")
            cache.write_text("cached page", encoding="utf-8")
            with patch.object(builder.requests, "get") as get:
                self.assertEqual(builder.fetch_text("https://example.test/page", cache), "cached page")
                self.assertIsNone(builder.cached_retrieved_date("https://example.test/page", cache))
                get.assert_not_called()
            self.assertFalse(builder.fetch_record_path(cache).exists())

    def test_actual_http_acquisition_records_date_and_exact_url(self):
        url = "https://example.test/page"
        response = Mock(text="downloaded page", apparent_encoding="utf-8")
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory, "page.html")
            with patch.object(builder.requests, "get", return_value=response) as get:
                self.assertEqual(builder.fetch_text(url, cache), "downloaded page")
                get.assert_called_once_with(url, timeout=90)
                response.raise_for_status.assert_called_once()
            record = json.loads(builder.fetch_record_path(cache).read_text(encoding="utf-8"))
            self.assertEqual(record, {"sourceUrl": url, "retrievedDate": date.today().isoformat()})
            self.assertEqual(builder.cached_retrieved_date(url, cache), date.today().isoformat())
            self.assertIsNone(builder.cached_retrieved_date(url + "/other", cache))

    def test_cached_record_keeps_original_acquisition_date(self):
        url = "https://example.test/page"
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory, "page.html")
            cache.write_text("cached page", encoding="utf-8")
            record_path = builder.fetch_record_path(cache)
            record_path.write_text(json.dumps({"sourceUrl": url, "retrievedDate": "2024-02-29"}), encoding="utf-8")
            with patch.object(builder.requests, "get") as get:
                self.assertEqual(builder.fetch_text(url, cache), "cached page")
                self.assertEqual(builder.cached_retrieved_date(url, cache), "2024-02-29")
                get.assert_not_called()
            self.assertEqual(json.loads(record_path.read_text(encoding="utf-8"))["retrievedDate"], "2024-02-29")

    def test_invalid_records_do_not_supply_acquisition_dates(self):
        url = "https://example.test/page"
        invalid_dates = [None, 20260914, "20260914", "2026-02-30", "2026-13-01", "today",
                         (date.today() + timedelta(days=1)).isoformat()]
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory, "page.html")
            for value in invalid_dates:
                with self.subTest(value=value):
                    builder.fetch_record_path(cache).write_text(
                        json.dumps({"sourceUrl": url, "retrievedDate": value}), encoding="utf-8"
                    )
                    self.assertIsNone(builder.cached_retrieved_date(url, cache))
            for invalid_json in ("not json", "[]"):
                builder.fetch_record_path(cache).write_text(invalid_json, encoding="utf-8")
                self.assertIsNone(builder.cached_retrieved_date(url, cache))

    def test_feature_dates_remove_legacy_acquisition_and_match_own_source(self):
        list_url = "https://example.test/list"
        detail_url = "https://example.test/detail"
        features = [
            {"properties": {"sourceUrl": list_url, "retrievedDate": "2026-09-13", "completion": "2030-03"}},
            {"properties": {"sourceUrl": detail_url, "retrievedDate": "2026-09-13", "sourceDate": "2026-02"}},
        ]
        builder.stamp_feature_dates(features, {list_url: "2024-02-29"}, "2026-09-14")
        self.assertEqual(features[0]["properties"]["retrievedDate"], "2024-02-29")
        self.assertNotIn("retrievedDate", features[1]["properties"])
        self.assertTrue(all(f["properties"]["compiledDate"] == "2026-09-14" for f in features))
        self.assertEqual(features[0]["properties"]["completion"], "2030-03")
        self.assertEqual(features[1]["properties"]["sourceDate"], "2026-02")

    def test_search_metadata_uses_compilation_not_acquisition(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "projects.json"
            core = root / "core.json"
            output.write_text(json.dumps({"features": [{"properties": {
                "n": "対象案件", "w": "千代田区", "compiledDate": "2026-09-14", "retrievedDate": "2024-02-29"
            }}]}), encoding="utf-8")
            core.write_text(json.dumps({"searchTypes": [{"d": "redevelopment", "k": "都市更新"}],
                                        "search": [], "meta": {}}), encoding="utf-8")
            with patch.object(builder, "OUTPUT", output):
                builder.update_search_index(core)
            data = json.loads(core.read_text(encoding="utf-8"))
            self.assertEqual(data["meta"]["urbanChangeDate"], "2026-09-14")
            self.assertEqual(data["search"], [["対象案件", "千代田区", 0, 0]])


if __name__ == "__main__":
    unittest.main()
