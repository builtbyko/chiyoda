"""Offline safety checks for the supplied urban-change data builder."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from shapely.geometry import box

spec = importlib.util.spec_from_file_location("urban_change", Path(__file__).resolve().parents[1] / "scripts/build_urban_change_projects.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class UrbanChangeSafetyTests(unittest.TestCase):
    def test_missing_values_never_become_shared_nan_keys(self):
        self.assertEqual(builder.norm_text(float("nan")), "")
        self.assertEqual(builder.norm_text(builder.pd.NA), "")

    def test_ambiguous_area_is_not_guessed(self):
        self.assertIsNone(builder.extract_gfa("変更前 3,000平方メートル 変更後 4,000平方メートル"))
        self.assertEqual(builder.extract_gfa("15,000平方メートル"), 15000)

    def test_current_redevelopment_never_uses_fallback_names(self):
        with self.assertRaises(ValueError):
            builder.redevelopment_features("<h2>完了案件</h2>", [], Path("unused"))

    def test_proposal_requires_row_in_its_current_legal_section(self):
        hint = builder.KNOWN_CHIYODA_PROPOSAL_HINTS[0]
        html = f"<p>{hint}</p><h2>都市再生特別措置法等に基づく提案</h2><table><tr><td>別案件</td></tr></table>"
        self.assertEqual(builder.proposal_features(html, []), [])

    def test_latest_completed_or_small_record_suppresses_old_plan(self):
        old = {"name": "計画", "address": "一番町", "receptionNumber": "7001", "grossFloorArea": 9000, "status": "計画", "sourceUrl": "https://www.city.chiyoda.lg.jp/r7.html"}
        for latest in ({**old, "status": "完了", "sourceUrl": "https://www.city.chiyoda.lg.jp/r8.html"}, {**old, "grossFloorArea": 1000, "sourceUrl": "https://www.city.chiyoda.lg.jp/r8.html"}):
            with patch.object(builder, "location_for") as locate:
                self.assertEqual(builder.large_building_features([old, latest], [], Path("unused")), [])
                locate.assert_not_called()

    def test_geocoding_rejects_other_wards_and_nonfinite_points(self):
        builder.CHIYODA_SCOPE = box(139.7, 35.6, 139.8, 35.75)
        builder.CHIYODA_TOWNS = [("飯田橋一丁目", [139.75, 35.7])]
        address = "東京都千代田区飯田橋一丁目"
        responses = [{"geometry": {"coordinates": [139.75, 35.7]}, "properties": {"title": "東京都新宿区飯田橋一丁目"}}, {"geometry": {"coordinates": [float("nan"), 35.7]}, "properties": {"title": address}}, {"geometry": {"coordinates": [139.75, 35.7]}, "properties": {"title": address}}]
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, address + ".json").write_text(json.dumps(responses, ensure_ascii=False), encoding="utf-8")
            self.assertEqual(builder.gsi_geocode(address, Path(directory)), [139.75, 35.7])


if __name__ == "__main__":
    unittest.main()
