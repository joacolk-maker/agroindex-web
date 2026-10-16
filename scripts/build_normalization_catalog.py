#!/usr/bin/env python3
"""Build a reviewable catalog for the ODEPA normalized layer.

The original annual snapshots are never changed. This catalog only proposes
deterministic, lossless text cleanups and flags every other mapping for review.
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path


FIELDS = {
    "regions": "regions",
    "markets": "markets",
    "subsectors": "subsectors",
    "products": "products",
    "varieties": "varieties",
    "qualities": "qualities",
    "units": "units",
    "origins": "origins",
}


def clean_text(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).replace("\u00a0", " ")
    value = re.sub(r"\s+", " ", value.strip())
    return value


def unit_weight_kg(value: str) -> float | None:
    match = re.search(r"(?:^|\s)(\d+(?:[.,]\d+)?)\s*kilos?\b", value.casefold())
    if not match:
        match = re.search(r"(?:^|\s)(\d+(?:[.,]\d+)?)\s*kg\b", value.casefold())
    if not match:
        return None
    return float(match.group(1).replace(",", "."))


def add_values(bucket: dict[str, Counter], years: dict[str, defaultdict[str, set[str]]], snapshot: dict, year: int) -> None:
    for field, dimension in FIELDS.items():
        for value in snapshot.get(dimension, []):
            bucket[field][value] += 1
            years[field][value].add(str(year))


def build_catalog(data_dir: Path) -> dict:
    values = {field: Counter() for field in FIELDS}
    value_years = {field: defaultdict(set) for field in FIELDS}
    files = sorted(
        path for path in data_dir.glob("odepa-*.json")
        if re.fullmatch(r"odepa-\d{4}\.json", path.name)
    )
    if not files:
        raise SystemExit(f"No se encontraron snapshots en {data_dir}")

    for path in files:
        snapshot = json.loads(path.read_text(encoding="utf-8"))
        year = snapshot["meta"]["source_year"]
        add_values(values, value_years, snapshot, year)

    catalog: dict[str, list[dict]] = {field: [] for field in FIELDS}
    for field in FIELDS:
        entries = []
        for original, count in sorted(values[field].items(), key=lambda item: (item[0].casefold(), item[0])):
            normalized = clean_text(original)
            changed = normalized != original
            entry = {
                "original": original,
                "normalized_proposal": normalized,
                "occurrences": count,
                "years": sorted(value_years[field][original]),
                "status": "auto_clean" if changed else "unchanged",
            }
            if field == "units":
                entry["weight_kg_proposal"] = unit_weight_kg(normalized)
                if entry["weight_kg_proposal"] is None:
                    entry["status"] = "review"
            catalog[field].append(entry)

    return {
        "schema_version": 1,
        "purpose": "Inventario de valores para construir la capa normalizada ODEPA.",
        "generated_from": "public/data/odepa-YYYY.json",
        "lossless_policy": "La capa original no se modifica; las reglas ambiguas requieren revisión explícita.",
        "fields": catalog,
        "summary": {
            field: {
                "distinct_values": len(entries),
                "review_values": sum(entry["status"] == "review" for entry in entries),
                "auto_clean_values": sum(entry["status"] == "auto_clean" for entry in entries),
            }
            for field, entries in catalog.items()
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, default=Path("public/data"))
    parser.add_argument("--output", type=Path, default=Path("public/data/normalization-catalog.json"))
    args = parser.parse_args()
    catalog = build_catalog(args.data_dir)
    args.output.write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps(catalog["summary"], ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
