"""Validate the focused anatomy descriptions without requiring binary meshes."""
import json
from pathlib import Path
from urllib.parse import urlparse

public = Path(__file__).resolve().parents[1] / "public"
brain = json.loads((public / "brain.json").read_text())
atlas = json.loads((public / "assets/atlas.json").read_text())
regions = {region["id"] for region in atlas["regions"]}
sources = set(brain["sources"])
assert len(regions) == len(atlas["regions"]) == 37
assert set(brain["regions"]) == regions, "Every atlas group needs a sourced description"
assert atlas["license"] == "CC BY 4.0"
assert atlas["reference"] == "ICBM 2009b Nonlinear Symmetric"
assert brain["version"] and brain["scope"]
assert not any(key in brain for key in ["chemicals", "activities", "synapses"])
used_sources = set()
for key, source in brain["sources"].items():
    assert all(source.get(field) for field in [
        "title", "authors", "year", "url", "method", "species", "finding", "limit"
    ]), key
    url = urlparse(source["url"])
    assert url.scheme == "https" and url.netloc and not url.username, key
for key, region in brain["regions"].items():
    assert region["summary"] and region["sources"], key
    assert set(region["sources"]) <= sources, key
    used_sources.update(region["sources"])
assert used_sources == sources, "Remove unused anatomy source records"
print(f"Brain content OK: {len(regions)} atlas groups, {len(sources)} referenced sources.")
