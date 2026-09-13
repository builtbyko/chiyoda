"""Offline checks: no ambiguous layer or priority section may be published."""
import importlib.util
from pathlib import Path
import unittest


spec = importlib.util.spec_from_file_location(
    "road_upgrade", Path(__file__).resolve().parents[1] / "scripts/upgrade_urban_planning_roads.py"
)
road = importlib.util.module_from_spec(spec)
spec.loader.exec_module(road)


class RoadUpgradeSafetyTests(unittest.TestCase):
    def candidate(self, **changes):
        return {
            "service": "Map_services/toshishisetsu",
            "layerName": "都市計画道路",
            "routeValues": ["放射1", "放射2", "環状1", "補助1", "補助2"],
            "score": 13,
            **changes,
        }

    def test_route_attributes_are_required(self):
        self.assertIsNone(road.choose_candidate([self.candidate(routeValues=[])]))

    def test_ledger_and_unnamed_layers_are_rejected(self):
        self.assertIsNone(road.choose_candidate([self.candidate(service="Map_services/dourodaichou")]))
        self.assertIsNone(road.choose_candidate([self.candidate(layerName="道路中心線")]))

    def test_ambiguous_layer_scores_are_rejected(self):
        self.assertIsNone(road.choose_candidate([self.candidate(), self.candidate(score=12)]))
        self.assertIsNotNone(road.choose_candidate([self.candidate()]))

    def test_single_official_line_can_be_merged_without_error(self):
        fc = {"features": [{"properties": {"routeKey": "放射9"}, "geometry": {"type": "LineString", "coordinates": [[139.7, 35.6], [139.71, 35.6]]}}]}
        self.assertEqual(road.lines_for_route(fc, "放射9").geom_type, "LineString")

    def test_missing_boundary_route_never_creates_a_segment(self):
        row = {"routeName": "放射９号線", "section": "補助124付近～環状２付近", "lengthM": "1,300"}
        feature, error = road.derive_priority_segment({"features": []}, row)
        self.assertIsNone(feature)
        self.assertEqual(error, "required route geometry missing")

    def test_multiple_intersections_are_not_chosen_by_length(self):
        def feature(key, coordinates):
            return {"properties": {"routeKey": key}, "geometry": {"type": "LineString", "coordinates": coordinates}}
        fc = {"features": [
            feature("放射9", [[139.7, 35.6], [139.72, 35.6]]),
            feature("補助124", [[139.705, 35.59], [139.705, 35.61], [139.715, 35.61], [139.715, 35.59]]),
            feature("環状2", [[139.718, 35.59], [139.718, 35.61]]),
        ]}
        row = {"routeName": "放射9号線", "section": "補助124付近～環状2付近", "lengthM": "1,300"}
        result, error = road.derive_priority_segment(fc, row)
        self.assertIsNone(result)
        self.assertIn("ambiguous boundary intersections", error)


if __name__ == "__main__":
    unittest.main()
