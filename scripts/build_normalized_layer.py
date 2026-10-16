#!/usr/bin/env python3
"""Build the lossless normalized ODEPA layer from immutable snapshots."""

from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path


DIMENSIONS = ["dates", "regions", "markets", "subsectors", "products", "varieties", "qualities", "units", "region_ids", "origins"]


def clean(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).replace("\u00a0", " ")
    return re.sub(r"\s+", " ", value.strip())


def normalize_snapshot(source: dict) -> dict:
    result = dict(source)
    maps: dict[str, dict[int, int]] = {}
    for dimension in DIMENSIONS:
        original = source[dimension]
        normalized = [clean(value) for value in original]
        unique = sorted(set(normalized), key=lambda value: (value.casefold(), value))
        index = {value: i for i, value in enumerate(unique)}
        maps[dimension] = {i: index[value] for i, value in enumerate(normalized)}
        result[dimension] = unique

    index_for_row = {0: "dates", 1: "regions", 2: "markets", 3: "subsectors", 4: "products", 5: "varieties", 6: "qualities", 7: "units", 13: "region_ids", 14: "origins"}
    result["rows"] = [
        [maps[index_for_row[i]][row[i]] if i in index_for_row else value for i, value in enumerate(row)]
        for row in source["rows"]
    ]
    result["meta"] = dict(source["meta"], normalization_schema_version=1, original_snapshot=f"odepa-{source['meta']['source_year']}.json", normalization_policy="NFKC + espacios; sin fusiones semánticas automáticas")
    return result


def main() -> None:
    data = Path("public/data")
    manifest_path = data / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for entry in manifest["years"]:
        source_path = data / entry["file"]
        normalized_name = f"normalized-{entry['file']}"
        normalized = normalize_snapshot(json.loads(source_path.read_text(encoding="utf-8")))
        (data / normalized_name).write_text(json.dumps(normalized, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        entry["original_file"] = entry["file"]
        entry["normalized_file"] = normalized_name
    manifest["normalized_layer"] = {"schema_version": 1, "policy": "Limpieza determinista de texto y remapeo de índices; capa original intacta.", "source": "odepa-YYYY.json"}
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Generados {len(manifest['years'])} snapshots normalizados")


if __name__ == "__main__":
    main()
