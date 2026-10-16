import { readFile } from 'node:fs/promises';

const dataDirectory = new URL('../public/data/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', dataDirectory), 'utf8'));
const expectedColumns = [
  'Fecha', 'ID region', 'Region', 'Mercado', 'Subsector', 'Producto',
  'Variedad / Tipo', 'Calidad', 'Unidad de comercializacion', 'Origen',
  'Volumen', 'Precio minimo', 'Precio maximo', 'Precio promedio',
];

if (manifest.schema_version !== 4) {
  throw new Error('The historical manifest has an incompatible schema version.');
}
if (!manifest.snapshot_generated_at || Number.isNaN(Date.parse(manifest.snapshot_generated_at))) {
  throw new Error('The historical manifest has no valid generation timestamp.');
}
if (!Array.isArray(manifest.years) || manifest.years.length !== 11) {
  throw new Error('The historical manifest must cover 2016 through 2026.');
}

let aggregatedRows = 0;
let storedRows = 0;
let publishedRows = 0;
for (const entry of manifest.years) {
  const snapshot = JSON.parse(await readFile(new URL(entry.file, dataDirectory), 'utf8'));
  const meta = snapshot.meta ?? {};
  if (meta.schema_version !== 4 || meta.source_year !== entry.year) {
    throw new Error(`The ${entry.year} snapshot has an incompatible schema.`);
  }
  if (!Array.isArray(snapshot.rows) || snapshot.rows.length === 0) {
    throw new Error(`The ${entry.year} snapshot contains no public rows.`);
  }
  if (meta.aggregated_rows !== snapshot.rows.length || entry.aggregated_rows !== snapshot.rows.length) {
    throw new Error(`The ${entry.year} snapshot row count does not match its metadata.`);
  }
  if (meta.source_rows < meta.aggregated_rows) {
    throw new Error(`The ${entry.year} source row count cannot be lower than its normalized row count.`);
  }
  if (entry.upstream_rows !== undefined && entry.upstream_rows !== meta.source_rows) {
    throw new Error(`The ${entry.year} upstream row count does not match its immutable metadata.`);
  }
  if (entry.normalized_rows !== undefined && entry.normalized_rows !== meta.aggregated_rows) {
    throw new Error(`The ${entry.year} normalized row count does not match its immutable metadata.`);
  }
  if (entry.stored_rows !== undefined && entry.stored_rows !== snapshot.rows.length) {
    throw new Error(`The ${entry.year} stored row count does not match its snapshot.`);
  }
  if (entry.published_rows !== undefined && (entry.published_rows < 0 || entry.published_rows > snapshot.rows.length)) {
    throw new Error(`The ${entry.year} published row count is outside its stored snapshot.`);
  }
  if (!meta.source_file_sha256 || !/^[a-f0-9]{64}$/i.test(meta.source_file_sha256)) {
    throw new Error(`The ${entry.year} snapshot has no valid source fingerprint.`);
  }
  if (JSON.stringify(meta.source_columns) !== JSON.stringify(expectedColumns)) {
    throw new Error(`The ${entry.year} snapshot does not preserve the exact ODEPA columns.`);
  }
  if (!Array.isArray(snapshot.region_ids) || snapshot.region_ids.length === 0) {
    throw new Error(`The ${entry.year} snapshot does not preserve ID region.`);
  }
  if (!Array.isArray(snapshot.origins) || snapshot.origins.length === 0) {
    throw new Error(`The ${entry.year} snapshot does not preserve Origen.`);
  }
  if (snapshot.rows.some((row) => !Array.isArray(row) || row.length !== 15)) {
    throw new Error(`The ${entry.year} snapshot contains an incompatible compact row.`);
  }
  if (snapshot.rows.some((row) => !Number.isInteger(row[13]) || row[13] < 0 || row[13] >= snapshot.region_ids.length)) {
    throw new Error(`The ${entry.year} snapshot contains an invalid ID region index.`);
  }
  if (snapshot.rows.some((row) => !Number.isInteger(row[14]) || row[14] < 0 || row[14] >= snapshot.origins.length)) {
    throw new Error(`The ${entry.year} snapshot contains an invalid Origen index.`);
  }
  const indexedDimensions = [
    ['dates', 0], ['regions', 1], ['markets', 2], ['subsectors', 3],
    ['products', 4], ['varieties', 5], ['qualities', 6], ['units', 7],
  ];
  for (const [dimension, index] of indexedDimensions) {
    if (!Array.isArray(snapshot[dimension]) || snapshot[dimension].length === 0) {
      throw new Error(`The ${entry.year} snapshot has no ${dimension} dimension.`);
    }
    if (snapshot.rows.some((row) => !Number.isInteger(row[index]) || row[index] < 0 || row[index] >= snapshot[dimension].length)) {
      throw new Error(`The ${entry.year} snapshot contains an invalid ${dimension} index.`);
    }
  }
  if (snapshot.rows.some((row) => !Number.isFinite(row[8]) || row[8] < 0)) {
    throw new Error(`The ${entry.year} snapshot contains an invalid volume.`);
  }
  if (snapshot.rows.some((row) => [row[9], row[10], row[11]].some((value) => value === '' || !Number.isFinite(Number(value))))) {
    throw new Error(`The ${entry.year} snapshot contains an invalid price.`);
  }
  if (!snapshot.dates.every((date) => date.startsWith(`${entry.year}-`))) {
    throw new Error(`The ${entry.year} snapshot contains dates from another year.`);
  }
  aggregatedRows += snapshot.rows.length;
  storedRows += entry.stored_rows ?? snapshot.rows.length;
  publishedRows += entry.published_rows ?? snapshot.rows.length;
}
if (aggregatedRows !== manifest.aggregated_rows) {
  throw new Error('The historical row count does not match the manifest.');
}
if (manifest.stored_rows !== undefined && storedRows !== manifest.stored_rows) {
  throw new Error('The stored historical row count does not match the manifest.');
}
if (manifest.published_rows !== undefined && publishedRows !== manifest.published_rows) {
  throw new Error('The published historical row count does not match the manifest.');
}
if (manifest.traceability && manifest.traceability.historical_snapshots_immutable !== true) {
  throw new Error('Historical snapshots must be declared immutable.');
}

console.log(JSON.stringify({
  years: manifest.years.length,
  rows: aggregatedRows,
  stored_rows: storedRows,
  published_rows: publishedRows,
  snapshot_generated_at: manifest.snapshot_generated_at,
  min_data_date: manifest.min_data_date,
  max_data_date: manifest.max_data_date,
}));
