import { createHash } from 'node:crypto';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const RESOURCE_ID = '580beca0-e87e-4dd4-9e8a-0bd92773f4a6';
const DATASTORE_URL = 'https://datos.odepa.gob.cl/api/3/action/datastore_search';
const SOURCE_URL = `https://datos.odepa.gob.cl/dataset/33f10516-acbe-4446-b633-68244b9b6b26/resource/${RESOURCE_ID}`;
const DATA_YEAR = 2026;
const PAGE_SIZE = 1000;
const WINDOW_DAYS = Number(process.env.ODEPA_SYNC_WINDOW_DAYS ?? 30);
const REQUESTED_MODE = process.env.ODEPA_SYNC_MODE ?? 'auto';
const PUBLIC_DATA_BASE_URL = (process.env.PUBLIC_DATA_BASE_URL ?? 'https://joacolk-maker.github.io/campo-claro-odepa/data').replace(/\/$/, '');
const dataDirectory = join(process.cwd(), 'public/data');
const EXPECTED_COLUMNS = [
  'Fecha', 'ID region', 'Region', 'Mercado', 'Subsector', 'Producto',
  'Variedad / Tipo', 'Calidad', 'Unidad de comercializacion', 'Origen',
  'Volumen', 'Precio minimo', 'Precio maximo', 'Precio promedio',
];

if (!Number.isInteger(WINDOW_DAYS) || WINDOW_DAYS < 1) {
  throw new Error(`ODEPA_SYNC_WINDOW_DAYS debe ser un entero positivo; se recibio ${process.env.ODEPA_SYNC_WINDOW_DAYS}.`);
}

function chileDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function syncMode() {
  if (REQUESTED_MODE === 'full' || REQUESTED_MODE === 'incremental') return REQUESTED_MODE;
  if (REQUESTED_MODE !== 'auto') throw new Error(`ODEPA_SYNC_MODE invalido: ${REQUESTED_MODE}`);
  return Number(chileDate().slice(-2)) === 1 ? 'full' : 'incremental';
}

async function fetchWithRetry(url, label) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'AgroIndex/1.0' },
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) return response;
      lastError = new Error(`${label}: ${response.status} ${await response.text()}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1_500));
  }
  throw lastError;
}

function datastoreUrl(offset, filters) {
  const params = new URLSearchParams({ resource_id: RESOURCE_ID, limit: String(PAGE_SIZE), offset: String(offset) });
  if (filters) params.set('filters', JSON.stringify(filters));
  return `${DATASTORE_URL}?${params}`;
}

function validateFields(fields) {
  const names = fields.map((field) => field.id).filter((name) => name !== '_id');
  if (JSON.stringify(names) !== JSON.stringify(EXPECTED_COLUMNS)) {
    throw new Error(`ODEPA cambio las columnas: ${JSON.stringify(names)}; se esperaban ${JSON.stringify(EXPECTED_COLUMNS)}.`);
  }
}

function decimal(value, field) {
  const raw = String(value ?? '').trim();
  if (!raw) throw new Error(`ODEPA devolvio ${field} vacio.`);
  const normalized = raw.includes(',') ? raw.replaceAll('.', '').replace(',', '.') : raw;
  const number = Number(normalized);
  if (!Number.isFinite(number)) throw new Error(`ODEPA devolvio ${field} invalido: ${raw}.`);
  return String(number);
}

function normalizeRecord(record) {
  const missing = EXPECTED_COLUMNS.filter((field) => String(record[field] ?? '').trim() === '');
  if (missing.length) throw new Error(`ODEPA devolvio campos vacios: ${missing.join(', ')}.`);
  return {
    fecha: String(record.Fecha).trim(), id_region: String(record['ID region']).trim(),
    region: String(record.Region).trim(), mercado: String(record.Mercado).trim(),
    subsector: String(record.Subsector).trim(), producto: String(record.Producto).trim(),
    variedad: String(record['Variedad / Tipo']).trim(), calidad: String(record.Calidad).trim(),
    unidad_comercializacion: String(record['Unidad de comercializacion']).trim(), origen: String(record.Origen).trim(),
    volumen: Number(decimal(record.Volumen, 'Volumen')), precio_minimo: decimal(record['Precio minimo'], 'Precio minimo'),
    precio_maximo: decimal(record['Precio maximo'], 'Precio maximo'), precio_promedio: decimal(record['Precio promedio'], 'Precio promedio'),
    observations: 1,
  };
}

async function fetchOfficialRows(filters) {
  const rows = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const response = await fetchWithRetry(datastoreUrl(offset, filters), 'ODEPA DataStore no respondio');
    const payload = await response.json();
    if (payload.success !== true || !payload.result || !Array.isArray(payload.result.records)) {
      throw new Error('ODEPA DataStore devolvio una respuesta invalida.');
    }
    validateFields(payload.result.fields ?? []);
    total = Number(payload.result.total);
    if (!Number.isFinite(total) || total < 0) throw new Error('ODEPA DataStore no devolvio un total valido.');
    rows.push(...payload.result.records.map(normalizeRecord));
    offset += payload.result.records.length;
    if (!payload.result.records.length) break;
  }
  if (rows.length !== total) throw new Error(`ODEPA anuncio ${total} filas y entrego ${rows.length}.`);
  return rows;
}

function subtractDays(date, days) {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() - days);
  return result.toISOString().slice(0, 10);
}

function datesBetween(start, end) {
  const dates = [];
  const current = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (current <= last) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

async function fetchIncrementalRows(start, end) {
  const rows = [];
  for (const date of datesBetween(start, end)) {
    const daily = await fetchOfficialRows({ Fecha: date });
    rows.push(...daily);
    if (daily.length) console.log(`ODEPA ${date}: ${daily.length} filas`);
  }
  return rows;
}

function decodeSnapshot(snapshot) {
  return snapshot.rows.flatMap((row) => Array.from({ length: Number(row[12] ?? 1) }, () => ({
    fecha: snapshot.dates[row[0]], region: snapshot.regions[row[1]], mercado: snapshot.markets[row[2]],
    subsector: snapshot.subsectors[row[3]], producto: snapshot.products[row[4]], variedad: snapshot.varieties[row[5]],
    calidad: snapshot.qualities[row[6]], unidad_comercializacion: snapshot.units[row[7]], volumen: row[8],
    precio_minimo: row[9], precio_maximo: row[10], precio_promedio: row[11], observations: 1,
    id_region: snapshot.region_ids[row[13]], origen: snapshot.origins[row[14]],
  })));
}

function validateBaseline(snapshot) {
  if (snapshot?.meta?.schema_version !== 4 || snapshot.meta.source_year !== DATA_YEAR || !Array.isArray(snapshot.rows)) {
    throw new Error('La instantanea base de 2026 es incompatible.');
  }
  if (!Array.isArray(snapshot.region_ids) || !Array.isArray(snapshot.origins)) {
    throw new Error('La instantanea base de 2026 no conserva ID region y Origen.');
  }
  return snapshot;
}

async function loadBaseline() {
  try {
    const response = await fetchWithRetry(`${PUBLIC_DATA_BASE_URL}/odepa-${DATA_YEAR}.json?v=${Date.now()}`, 'No se pudo descargar la instantanea publicada');
    return { snapshot: validateBaseline(await response.json()), source: 'published_snapshot' };
  } catch (error) {
    console.warn(`${error.message}. Se usara la copia incluida en el repositorio.`);
    return {
      snapshot: validateBaseline(JSON.parse(await readFile(join(dataDirectory, `odepa-${DATA_YEAR}.json`), 'utf8'))),
      source: 'repository_snapshot',
    };
  }
}

function sortedValues(rows, field) {
  return [...new Set(rows.map((row) => String(row[field] ?? '')))].sort((a, b) => a.localeCompare(b, 'es'));
}

function rowValueKey(row) {
  return JSON.stringify([
    row.fecha, row.id_region, row.region, row.mercado, row.subsector, row.producto,
    row.variedad, row.calidad, row.unidad_comercializacion, row.origen,
    Number(row.volumen), String(row.precio_minimo), String(row.precio_maximo), String(row.precio_promedio),
  ]);
}

function compactSnapshot(rows, sync) {
  const counts = new Map();
  for (const row of rows) {
    const key = rowValueKey(row);
    const existing = counts.get(key);
    if (existing) existing.observations += 1;
    else counts.set(key, { ...row, observations: 1 });
  }
  const normalized = [...counts.values()];
  const dimensions = [
    ['dates', 'fecha'], ['regions', 'region'], ['markets', 'mercado'], ['subsectors', 'subsector'],
    ['products', 'producto'], ['varieties', 'variedad'], ['qualities', 'calidad'], ['units', 'unidad_comercializacion'],
    ['region_ids', 'id_region'], ['origins', 'origen'],
  ];
  const values = Object.fromEntries(dimensions.map(([name, field]) => [name, sortedValues(normalized, field)]));
  const indexes = dimensions.map(([name]) => new Map(values[name].map((value, index) => [value, index])));
  const compactRows = normalized.map((row) => [
    indexes[0].get(row.fecha), indexes[1].get(row.region), indexes[2].get(row.mercado), indexes[3].get(row.subsector),
    indexes[4].get(row.producto), indexes[5].get(row.variedad), indexes[6].get(row.calidad), indexes[7].get(row.unidad_comercializacion),
    Number(row.volumen), String(row.precio_minimo), String(row.precio_maximo), String(row.precio_promedio), row.observations,
    indexes[8].get(row.id_region), indexes[9].get(row.origen),
  ]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const fingerprint = createHash('sha256').update(JSON.stringify({ ...values, rows: compactRows })).digest('hex');
  const generatedAt = new Date().toISOString();
  return {
    meta: {
      schema_version: 4, source_url: SOURCE_URL, source_resource_id: RESOURCE_ID, source_year: DATA_YEAR,
      snapshot_generated_at: generatedAt, source_fetched_at: generatedAt, min_data_date: values.dates[0],
      max_data_date: values.dates.at(-1), source_rows: rows.length, aggregated_rows: compactRows.length,
      stored_rows: compactRows.length, source_file_sha256: fingerprint, source_rows_sha256: fingerprint,
      fingerprint_scope: 'normalized full official DataStore rows', source_system: 'odepa.ckan.datastore',
      source_scope: 'full_official_resource', source_columns: EXPECTED_COLUMNS, sync,
    },
    ...values,
    rows: compactRows,
  };
}

function multiset(rows) {
  const counts = new Map();
  for (const row of rows) counts.set(rowValueKey(row), (counts.get(rowValueKey(row)) ?? 0) + 1);
  return counts;
}

function changeMetrics(before, after) {
  const previous = multiset(before);
  const current = multiset(after);
  let added = 0; let removed = 0;
  for (const [key, count] of current) added += Math.max(0, count - (previous.get(key) ?? 0));
  for (const [key, count] of previous) removed += Math.max(0, count - (current.get(key) ?? 0));
  return { added_rows: added, removed_rows: removed, unchanged_rows: before.length - removed, changed: added > 0 || removed > 0 };
}

function snapshotPublicationKey(snapshot, row) {
  return JSON.stringify([snapshot.subsectors[row[3]], snapshot.products[row[4]], snapshot.varieties[row[5]], snapshot.qualities[row[6]]]);
}

async function rebuildManifest(updatedSnapshot, allowedSeries) {
  const current = JSON.parse(await readFile(join(dataDirectory, 'manifest.json'), 'utf8'));
  const dimensionIndexes = { regions: 1, markets: 2, subsectors: 3, products: 4, varieties: 5, qualities: 6, units: 7, region_ids: 13, origins: 14 };
  const dimensions = Object.fromEntries(Object.keys(dimensionIndexes).map((name) => [name, new Set()]));
  const publishedDimensions = Object.fromEntries(Object.keys(dimensionIndexes).map((name) => [name, new Set()]));
  const years = [];
  for (const entry of current.years) {
    const snapshot = entry.year === DATA_YEAR ? updatedSnapshot : JSON.parse(await readFile(join(dataDirectory, entry.file), 'utf8'));
    let publishedRows = 0;
    for (const row of snapshot.rows) {
      const published = allowedSeries.has(snapshotPublicationKey(snapshot, row));
      publishedRows += published ? Number(row[12] ?? 1) : 0;
      for (const [field, index] of Object.entries(dimensionIndexes)) {
        const value = snapshot[field][row[index]];
        dimensions[field].add(value);
        if (published) publishedDimensions[field].add(value);
      }
    }
    years.push({
      year: snapshot.meta.source_year, file: entry.file, min_data_date: snapshot.meta.min_data_date,
      max_data_date: snapshot.meta.max_data_date, source_rows: snapshot.meta.source_rows,
      aggregated_rows: snapshot.meta.aggregated_rows, upstream_rows: snapshot.meta.source_rows,
      normalized_rows: snapshot.meta.aggregated_rows, stored_rows: snapshot.rows.length,
      published_rows: publishedRows, source_file_sha256: snapshot.meta.source_file_sha256,
    });
  }
  return {
    schema_version: 4, snapshot_generated_at: updatedSnapshot.meta.snapshot_generated_at,
    min_data_date: years[0].min_data_date, max_data_date: years.at(-1).max_data_date,
    source_rows: years.reduce((sum, item) => sum + item.source_rows, 0),
    aggregated_rows: years.reduce((sum, item) => sum + item.aggregated_rows, 0),
    stored_rows: years.reduce((sum, item) => sum + item.stored_rows, 0),
    published_rows: years.reduce((sum, item) => sum + item.published_rows, 0),
    dimension_counts: Object.fromEntries(Object.entries(dimensions).map(([field, set]) => [field, set.size])),
    published_dimension_counts: Object.fromEntries(Object.entries(publishedDimensions).map(([field, set]) => [field, set.size])),
    traceability: {
      historical_snapshots_immutable: true, historical_years: years.filter((item) => item.year !== DATA_YEAR).map((item) => item.year),
      publication_filter: 'series-rules.json', publication_matching_dimensions: ['subsector', 'product', 'variety', 'quality'],
    },
    years,
  };
}

async function setWorkflowOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

const mode = syncMode();
const baselineResult = await loadBaseline();
const baselineRows = decodeSnapshot(baselineResult.snapshot);
const cutoff = mode === 'incremental' ? subtractDays(baselineResult.snapshot.meta.max_data_date, WINDOW_DAYS - 1) : undefined;
const fetchedRows = mode === 'full' ? await fetchOfficialRows() : await fetchIncrementalRows(cutoff, chileDate());
if (!fetchedRows.length) throw new Error('ODEPA no devolvio filas para la conciliacion.');
const rows = mode === 'full' ? fetchedRows : [...baselineRows.filter((row) => row.fecha < cutoff), ...fetchedRows];
const metrics = changeMetrics(baselineRows, rows);
const sync = {
  mode, window_days: mode === 'incremental' ? WINDOW_DAYS : null, window_start: cutoff ?? null,
  baseline: baselineResult.source, fetched_rows: fetchedRows.length, ...metrics,
};
const snapshot = compactSnapshot(rows, sync);
if (snapshot.meta.max_data_date < baselineResult.snapshot.meta.max_data_date) {
  throw new Error(`ODEPA llega hasta ${snapshot.meta.max_data_date}, antes que la copia publicada (${baselineResult.snapshot.meta.max_data_date}). No se publicara.`);
}
const rules = JSON.parse(await readFile(join(dataDirectory, 'series-rules.json'), 'utf8'));
const allowedSeries = new Set(rules.allowed_series);
await writeFile(join(dataDirectory, `odepa-${DATA_YEAR}.json`), `${JSON.stringify(snapshot)}\n`);
await writeFile(join(dataDirectory, 'manifest.json'), `${JSON.stringify(await rebuildManifest(snapshot, allowedSeries), null, 2)}\n`);
await setWorkflowOutput('changed', String(metrics.changed));
await setWorkflowOutput('mode', mode);
await setWorkflowOutput('fetched_rows', String(fetchedRows.length));
console.log(JSON.stringify({
  year: DATA_YEAR, mode, window_start: cutoff ?? null, baseline: baselineResult.source,
  fetched_rows: fetchedRows.length, ...metrics, source_rows: snapshot.meta.source_rows,
  stored_rows: snapshot.meta.stored_rows, max_data_date: snapshot.meta.max_data_date,
}));
if (!metrics.changed) console.log('Sin nuevos datos');
