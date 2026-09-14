"""Offline regeneration checks for the confirmed memory-plate name correction."""

import sys
import unittest
from pathlib import Path

import geopandas as gpd
from shapely.geometry import Point

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import prepare_chiyoda_official_layers as builder


class OfficialLayerNameTests(unittest.TestCase):
    def test_confirmed_plate_name_survives_regeneration_without_guessing_other_names(self):
        typo = "有島武郎・有島生馬・里見?旧居跡"
        official = "有島武郎・有島生馬・里見弴旧居跡"
        frame = gpd.GeoDataFrame(
            {"ID": [4, 99], "件名": [typo, "未確認?名称"]},
            geometry=[Point(139.73538, 35.68763), Point(139.75, 35.69)],
            crs="EPSG:4326",
        )
        source = next(source for source in builder.SOURCES if source.key == "memory_plates")
        collection = builder.feature_collection(frame, source)
        props = collection["features"][0]["properties"]
        self.assertEqual(props["n"], official)
        self.assertEqual(props["件名"], official)
        self.assertEqual(props["_source_id"], 4)
        self.assertEqual(collection["features"][0]["geometry"]["coordinates"], [139.73538, 35.68763])
        self.assertEqual(collection["features"][1]["properties"]["n"], "未確認?名称")
        summary = builder.schema_summary({source.output: collection})[source.output]
        self.assertIn(official, summary["properties"]["n"]["samples"])
        self.assertIn(official, summary["properties"]["件名"]["samples"])
        other = builder.feature_collection(frame, builder.CULTURAL_SOURCES[0])
        self.assertEqual(other["features"][0]["properties"]["n"], typo)
        self.assertEqual(frame.iloc[0]["件名"], typo)


if __name__ == "__main__":
    unittest.main()
