"""Attach verified current decisions without erasing the 2025 GIS snapshot.

Run after rebuilding the Tokyo planning layers. The current official plan may
have a newer decision than the machine-readable polygon. Both dates remain
available to the map, so an old boundary cannot masquerade as a current one.
"""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REGISTRY = ROOT / "scripts/data/district-plan-official-updates.json"
LAYERS = ROOT / "public/data/layers"


def annotate(layers: dict[str, list[dict]]) -> None:
    registry = json.loads(REGISTRY.read_text(encoding="utf-8"))
    for update in registry["updates"]:
        matches = [
            item for item in layers[update["layer"]]
            if item["properties"].get("n") == update["name"]
            and item["properties"].get("w") == update["ward"]
            and (update["layer"] != "special-zones"
                 or item["properties"].get("c") == "redevelopmentPlan")
        ]
        if len(matches) != 1:
            raise ValueError(f"Expected one planning feature: {update['name']} / {update['ward']}; got {len(matches)}")
        props = matches[0]["properties"]
        if props.get("d") != update["sourceDecision"]:
            raise ValueError(f"Source decision changed for {update['name']}: {props.get('d')}")
        if "sourceArea" in update and abs(float(props["a"]) - update["sourceArea"]) > 0.001:
            raise ValueError(f"Source area changed for {update['name']}: {props['a']}")

        props["_current_decision"] = update["currentDecision"]
        props["_current_source_url"] = update["source"]
        props["_update_note"] = update["note"]
        if "currentArea" in update:
            props["_current_area_ha"] = update["currentArea"]
        if "boundaryStatus" in update:
            props["_boundary_status"] = update["boundaryStatus"]

    for correction in registry.get("fieldCorrections", []):
        matches = [
            item for item in layers[correction["layer"]]
            if item["properties"].get("n") == correction["name"]
            and item["properties"].get("w") == correction["ward"]
        ]
        if len(matches) != 1:
            raise ValueError(f"Expected one planning feature: {correction['name']} / {correction['ward']}; got {len(matches)}")
        props = matches[0]["properties"]
        old_value = props.get(correction["field"])
        if old_value not in (correction["sourceValue"], correction["correctValue"]):
            raise ValueError(f"Unexpected {correction['field']} for {correction['name']}: {old_value}")
        props[correction["field"]] = correction["correctValue"]
        props["_current_source_url"] = correction["source"]
        props["_update_note"] = correction["note"]


def main() -> None:
    collections = {
        layer: json.loads((LAYERS / f"{layer}.json").read_text(encoding="utf-8"))
        for layer in ("district-plans", "special-zones")
    }
    annotate({layer: collection["features"] for layer, collection in collections.items()})
    for layer, collection in collections.items():
        (LAYERS / f"{layer}.json").write_text(
            json.dumps(collection, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )


if __name__ == "__main__":
    main()
