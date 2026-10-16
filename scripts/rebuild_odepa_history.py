#!/usr/bin/env python3
"""Rebuild the compact ODEPA history from the official annual CSV resources."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import time
import urllib.request
from collections import Counter
from decimal import Decimal, InvalidOperation
from pathlib import Path


PACKAGE_ID = "33f10516-acbe-4446-b633-68244b9b6b26"
PACKAGE_URL = f"https://datos.odepa.gob.cl/api/3/action/package_show?id={PACKAGE_ID}"
PUBLIC_RULES_URL = "https://joacolk-maker.github.io/agroindex-web/data/series-rules.json"
EXPECTED_COLUMNS = [
    "Fecha",
    "ID region",
    "Region",
    "Mercado",
    "Subsector",
    "Producto",
    "Variedad / Tipo",
    "Calidad",
    "Unidad de comercializacion",
    "Origen",
    "Volumen",
    "Precio minimo",
    "Precio maximo",
    "Precio promedio",
]
YEARS = range(2016, 2027)


def download(url: str, attempts: int = 3) -> bytes:
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "AgroIndex/1.0"})
            with urllib.request.urlopen(request, timeout=180) as response:
                return response.read()
        except Exception as error:  # network failures are retried and then surfaced
            last_error = error
            if attempt < attempts:
                time.sleep(attempt * 2)
    raise RuntimeError(f"No se pudo descargar {url}: {last_error}") from last_error


def canonical_decimal(value: str, field: str, row_number: int) -> str:
    raw = value.strip()
    if not raw:
        raise ValueError(f"{field} vacio en la fila {row_number}")
    normalized = raw.replace(".", "").replace(",", ".") if "," in raw else raw
    try:
        number = Decimal(normalized)
    except InvalidOperation as error:
        raise ValueError(f"{field} invalido en la fila {row_number}: {raw}") from error
    text = format(number, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def numeric_volume(value: str, row_number: int) -> int | float:
    text = canonical_decimal(value, "Volumen", row_number)
    number = Decimal(text)
    return int(number) if number == number.to_integral() else float(number)


def sorted_unique(values: list[str]) -> list[str]:
    return sorted(set(values), key=lambda value: (value.casefold(), value))


def compact_csv(raw: bytes, resource: dict) -> dict:
    text = raw.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text, newline=""))
    if reader.fieldnames != EXPECTED_COLUMNS:
        raise ValueError(
            f"ODEPA cambio las columnas de {resource['year']}: {reader.fieldnames}; "
            f"se esperaban {EXPECTED_COLUMNS}"
        )

    records: Counter[tuple] = Counter()
    source_rows = 0
    for row_number, source in enumerate(reader, start=2):
        source_rows += 1
        missing = [column for column in EXPECTED_COLUMNS if source[column] is None or not source[column].strip()]
        if missing:
            raise ValueError(f"Campos vacios en {resource['year']} fila {row_number}: {missing}")
        record = (
            source["Fecha"].strip(),
            source["ID region"].strip(),
            source["Region"].strip(),
            source["Mercado"].strip(),
            source["Subsector"].strip(),
            source["Producto"].strip(),
            source["Variedad / Tipo"].strip(),
            source["Calidad"].strip(),
            source["Unidad de comercializacion"].strip(),
            source["Origen"].strip(),
            numeric_volume(source["Volumen"], row_number),
            canonical_decimal(source["Precio minimo"], "Precio minimo", row_number),
            canonical_decimal(source["Precio maximo"], "Precio maximo", row_number),
            canonical_decimal(source["Precio promedio"], "Precio promedio", row_number),
        )
        if not record[0].startswith(f"{resource['year']}-"):
            raise ValueError(f"Fecha fuera del ano {resource['year']} en la fila {row_number}: {record[0]}")
        records[record] += 1

    fields = list(zip(*records.keys()))
    dates = sorted_unique(list(fields[0]))
    region_ids = sorted_unique(list(fields[1]))
    regions = sorted_unique(list(fields[2]))
    markets = sorted_unique(list(fields[3]))
    subsectors = sorted_unique(list(fields[4]))
    products = sorted_unique(list(fields[5]))
    varieties = sorted_unique(list(fields[6]))
    qualities = sorted_unique(list(fields[7]))
    units = sorted_unique(list(fields[8]))
    origins = sorted_unique(list(fields[9]))
    dimensions = [dates, regions, markets, subsectors, products, varieties, qualities, units, region_ids, origins]
    indexes = [{value: index for index, value in enumerate(values)} for values in dimensions]

    rows = []
    for record, observations in records.items():
        rows.append([
            indexes[0][record[0]],
            indexes[1][record[2]],
            indexes[2][record[3]],
            indexes[3][record[4]],
            indexes[4][record[5]],
            indexes[5][record[6]],
            indexes[6][record[7]],
            indexes[7][record[8]],
            record[10],
            record[11],
            record[12],
            record[13],
            observations,
            indexes[8][record[1]],
            indexes[9][record[9]],
        ])
    rows.sort(key=lambda row: tuple(row))
    normalized_hash = hashlib.sha256(
        json.dumps(
            {
                "dates": dates,
                "regions": regions,
                "markets": markets,
                "subsectors": subsectors,
                "products": products,
                "varieties": varieties,
                "qualities": qualities,
                "units": units,
                "region_ids": region_ids,
                "origins": origins,
                "rows": rows,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()

    return {
        "meta": {
            "schema_version": 4,
            "source_url": resource["url"],
            "source_resource_id": resource["resource_id"],
            "source_year": resource["year"],
            "source_last_modified": resource["last_modified"],
            "source_rows": source_rows,
            "aggregated_rows": len(rows),
            "stored_rows": len(rows),
            "min_data_date": dates[0],
            "max_data_date": dates[-1],
            "source_file_sha256": hashlib.sha256(raw).hexdigest(),
            "source_rows_sha256": normalized_hash,
            "fingerprint_scope": "normalized full official snapshot rows",
            "source_system": "odepa.ckan.csv",
            "source_scope": "full_official_resource",
            "source_columns": EXPECTED_COLUMNS,
        },
        "dates": dates,
        "regions": regions,
        "markets": markets,
        "subsectors": subsectors,
        "products": products,
        "varieties": varieties,
        "qualities": qualities,
        "units": units,
        "region_ids": region_ids,
        "origins": origins,
        "rows": rows,
    }


def publication_key(snapshot: dict, row: list) -> str:
    return json.dumps(
        [snapshot["subsectors"][row[3]], snapshot["products"][row[4]], snapshot["varieties"][row[5]], snapshot["qualities"][row[6]]],
        ensure_ascii=False,
        separators=(",", ":"),
    )


def load_rules(output: Path) -> dict:
    local = output / "series-rules.json"
    if local.exists():
        return json.loads(local.read_text(encoding="utf-8"))
    rules = json.loads(download(PUBLIC_RULES_URL).decode("utf-8"))
    local.write_text(json.dumps(rules, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    return rules


def resource_catalog(package: dict) -> list[dict]:
    resources = []
    for item in package["resources"]:
        name = item.get("name", "")
        year = next((year for year in YEARS if str(year) in name), None)
        if year is None:
            continue
        resources.append({
            "year": year,
            "resource_id": item["id"],
            "url": item["url"],
            "last_modified": item.get("last_modified"),
            "description": item.get("description"),
        })
    return sorted(resources, key=lambda item: item["year"])


def rebuild_manifest(output: Path, snapshots: list[dict], rules: dict) -> dict:
    allowed = set(rules["allowed_series"])
    dimension_names = ["regions", "markets", "subsectors", "products", "varieties", "qualities", "units", "region_ids", "origins"]
    dimensions = {name: set() for name in dimension_names}
    published_dimensions = {name: set() for name in dimension_names}
    dimension_indexes = {"regions": 1, "markets": 2, "subsectors": 3, "products": 4, "varieties": 5, "qualities": 6, "units": 7, "region_ids": 13, "origins": 14}
    years = []
    for snapshot in snapshots:
        published_rows = 0
        for row in snapshot["rows"]:
            published = publication_key(snapshot, row) in allowed
            published_rows += int(published)
            for name, index in dimension_indexes.items():
                source = snapshot[name]
                value = source[row[index]]
                dimensions[name].add(value)
                if published:
                    published_dimensions[name].add(value)
        meta = snapshot["meta"]
        years.append({
            "year": meta["source_year"],
            "file": f"odepa-{meta['source_year']}.json",
            "min_data_date": meta["min_data_date"],
            "max_data_date": meta["max_data_date"],
            "source_rows": meta["source_rows"],
            "aggregated_rows": meta["aggregated_rows"],
            "upstream_rows": meta["source_rows"],
            "normalized_rows": meta["aggregated_rows"],
            "stored_rows": len(snapshot["rows"]),
            "published_rows": published_rows,
            "source_file_sha256": meta["source_file_sha256"],
        })
    return {
        "schema_version": 4,
        "snapshot_generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "min_data_date": years[0]["min_data_date"],
        "max_data_date": years[-1]["max_data_date"],
        "source_rows": sum(item["source_rows"] for item in years),
        "aggregated_rows": sum(item["aggregated_rows"] for item in years),
        "stored_rows": sum(item["stored_rows"] for item in years),
        "published_rows": sum(item["published_rows"] for item in years),
        "dimension_counts": {name: len(values) for name, values in dimensions.items()},
        "published_dimension_counts": {name: len(values) for name, values in published_dimensions.items()},
        "traceability": {
            "historical_snapshots_immutable": True,
            "historical_years": list(range(2016, 2026)),
            "publication_filter": "series-rules.json",
            "publication_matching_dimensions": ["subsector", "product", "variety", "quality"],
        },
        "years": years,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("public/data"))
    parser.add_argument("--cache-dir", type=Path, default=Path("/tmp/agroindex-odepa-raw"))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    args.cache_dir.mkdir(parents=True, exist_ok=True)

    package = json.loads(download(PACKAGE_URL).decode("utf-8"))["result"]
    resources = resource_catalog(package)
    if [item["year"] for item in resources] != list(YEARS):
        raise RuntimeError(f"El catalogo oficial no contiene exactamente 2016-2026: {[item['year'] for item in resources]}")
    rules = load_rules(args.output)
    snapshots = []
    for resource in resources:
        cache = args.cache_dir / f"odepa-{resource['year']}.csv"
        if cache.exists():
            raw = cache.read_bytes()
        else:
            print(f"Descargando ODEPA {resource['year']}...", flush=True)
            raw = download(resource["url"])
            cache.write_bytes(raw)
        snapshot = compact_csv(raw, resource)
        target = args.output / f"odepa-{resource['year']}.json"
        target.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        snapshots.append(snapshot)
        print(json.dumps({
            "year": resource["year"],
            "source_rows": snapshot["meta"]["source_rows"],
            "stored_rows": len(snapshot["rows"]),
            "origins": len(snapshot["origins"]),
            "region_ids": len(snapshot["region_ids"]),
        }, ensure_ascii=False), flush=True)

    manifest = rebuild_manifest(args.output, snapshots, rules)
    (args.output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    catalog = {
        "dataset_id": PACKAGE_ID,
        "title": package.get("title"),
        "description": package.get("notes"),
        "update_frequency": "Diaria (días hábiles)",
        "capture_methodology": package.get("notes"),
        "capture_methodology_source": "Descripción oficial del conjunto de datos ODEPA",
        "author": package.get("author"),
        "maintainer": package.get("maintainer"),
        "license_id": package.get("license_id"),
        "license_title": package.get("license_title"),
        "license_url": package.get("license_url"),
        "metadata_modified": package.get("metadata_modified"),
        "columns": EXPECTED_COLUMNS,
        "resources": resources,
    }
    (args.output / "odepa-resources.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "years": len(snapshots),
        "source_rows": manifest["source_rows"],
        "stored_rows": manifest["stored_rows"],
        "published_rows": manifest["published_rows"],
    }, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
