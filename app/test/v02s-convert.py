"""Convert the two approved scenes; original assets are read-only."""

import json
from pathlib import Path

from PIL import Image, __version__ as pillow_version

root = Path(__file__).resolve().parents[1]
source = root.parent / "assets/showcase/layer"
target = root / "src/assets/samples"
target.mkdir(parents=True, exist_ok=True)
report = {"pillow": pillow_version, "images": []}
for name, person in [("festival", False), ("seaside", False), ("girl-yukata", True), ("girl", True)]:
    original = source / f"{name}.png"
    destination = target / f"{name}.webp"
    with Image.open(original) as image:
        image.save(destination, "WEBP", lossless=person, quality=90, method=6, exact=person)
        row = {
            "source": original.name,
            "output": destination.name,
            "size": image.size,
            "lossless": person,
            "quality": 90,
            "bytes": destination.stat().st_size,
        }
        if person:
            with Image.open(destination) as decoded:
                assert image.convert("RGBA").tobytes() == decoded.convert("RGBA").tobytes()
                row["rgbaExact"] = True
        report["images"].append(row)
print(json.dumps(report, ensure_ascii=False, indent=2))
