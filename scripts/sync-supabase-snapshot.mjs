import { createHash } from 'node:crypto';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SUPABASE_URL = (process.env.SUPABASE_URL ?? 'https://raeschwvwcejkcaungiv.supabase.co').replace(/\/$/, '');
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_OIctI2A8DapZ-xeJHO6ACw_rZUMz-Op';
const SOURCE_URL = 'https://datos.odepa.gob.cl/dataset/33f10516-acbe-4446-b633-68244b9b6b26/resource/580beca0-e87e-4dd4-9e8a-0bd92773f4a6/download/precio_mayorista_fruta-hortaliza_2026.csv';
const DATA_YEAR = 2026;
const PAGE_SIZE = 1000;
const CONCURRENCY = 6;
const WINDOW_DAYS = Number(process.env.ODEPA_SYNC_WINDOW_DAYS ?? 30);
const REQUESTED_MODE = process.env.ODEPA_SYNC_MODE ?? 'auto';
const PUBLIC_DATA_BASE_URL = (process.env.PUBLIC_DATA_BASE_URL ?? 'https://joacolk-maker.github.io/campo-claro-odepa/data').replace(/\/$/, '');
const dataDirectory = join(process.cwd(), 'public/data');

if (!Number.isInteger(WINDOW_DAYS) || WINDOW_DAYS < 1) {
  throw new Error(`ODEPA_SYNC_WINDOW_DAYS debe ser un entero positivo; se recibio ${process.env.ODEPA_SYNC_WINDOW_DAYS}.`);
}

const headers = {
  apikey: SUPABASE_PUBLISHABLE_KEY,
  Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
};

function localDayOfMonth() {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santiago', day: 'numeric' }).format(new Date()));
}

function syncMode() {
  if (REQUESTED_MODE === 'full' || REQUESTED_MODE === 'incremental') return REQUESTED_MODE;
  if (REQUESTED_MODE !== 'auto') throw new Error(`ODEPA_SYNC_MODE invalido: ${REQUESTED_MODE}`);
  return localDayOfMonth() === 1 ? 'full' : 'incremental';
}

async function fetchWithRetry(url, options, label) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) });
      if (response.ok) return response;
      lastError = new Error(`${label}: ${response.status} ${await response.text()}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1_500));
  }
  throw lastError;
}

function filterQuery(cutoff) {
  return cutoff ? `&fecha=gte.${encodeURIComponent(cutoff)}` : '';
}

async function exactCount(table, cutoff) {
  const response = await fetchWithRetry(`${SUPABASE_URL}/rest/v1/${table}?select=id&limit=1${filterQuery(cutoff)}`, {
    headers: { ...headers, Prefer: 'count=exact', Range: '0-0' },
  }, `Supabase no pudo contar ${table}`);
  const range = response.headers.get('content-range');
  const count = Number(range?.split('/')[1]);
  if (!Number.isFinite(count)) throw new Error(`Supabase no devolvio el total de ${table}.`);
  return count;
}

async function fetchPage(start, end, cutoff) {
  const columns = [
    'id', 'fecha', 'id_region', 'region', 'mercado', 'subsector', 'producto',
    'variedad', 'calidad', 'unidad_comercializacion', 'origen', 'volumen',
    'precio_minimo', 'precio_maximo', 'precio_promedio',
  ].join(',');
  const url = `${SUPABASE_URL}/rest/v1/precios_web?select=${columns}&order=id.asc${filterQuery(cutoff)}`;
  const response = await fetchWithRetry(url, { headers: { ...headers, Range: `${start}-${end}` } }, `Supabase fallo en filas ${start}-${end}`);
  return response.json();
}

async function fetchAllRows(total, cutoff) {
  const pages = [];
  for (let start = 0; start < total; start += PAGE_SIZE) pages.push([start, Math.min(start + PAGE_SIZE - 1, total - 1)]);
  const rows = [];
  for (let index = 0; index < pages.length; index += CONCURRENCY) {
    const batch = pages.slice(index, index + CONCURRENCY);
    const results = await Promise.all(batch.map(([start, end]) => fetchPage(start, end, cutoff)));
    results.forEach((result) => rows.push(...result));
    console.log(`Supabase: ${Math.min(index + batch.length, pages.length)}/${pages.length} paginas descargadas`);
  }
  return rows;
}

function subtractDays(date, days) {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() - days);
  return result.toISOString().slice(0, 10);
}

function decodeSnapshot(snapshot) {
  return snapshot.rows.map((row) => ({
    fecha: snapshot.dates[row[0]], region: snapshot.regions[row[1]], mercado: snapshot.markets[row[2]],
    subsector: snapshot.subsectors[row[3]], producto: snapshot.products[row[4]], variedad: snapshot.varieties[row[5]],
    calidad: snapshot.qualities[row[6]], unidad_comercializacion: snapshot.units[row[7]], volumen: row[8],
    precio_minimo: row[9], precio_maximo: row[10], precio_promedio: row[11], observations: row[12],
  }));
}

function validateBaseline(snapshot) {
  if (snapshot?.meta?.schema_version !== 3 || snapshot.meta.source_year !== DATA_YEAR || !Array.isArray(snapshot.rows)) {
    throw new Error('La instantanea base de 2026 es incompatible.');
  }
  if (!snapshot.meta.max_data_date || !snapshot.dates?.includes(snapshot.meta.max_data_date)) {
    throw new Error('La instantanea base de 2026 no tiene una fecha maxima valida.');
  }
  return snapshot;
}

async function loadBaseline() {
  try {
    const response = await fetchWithRetry(
      `${PUBLIC_DATA_BASE_URL}/odepa-${DATA_YEAR}.json?v=${Date.now()}`,
      { headers: { Accept: 'application/json' } },
      'No se pudo descargar la instantanea publicada',
    );
    return { snapshot: validateBaseline(await response.json()), source: 'published_snapshot' };
  } catch (error) {
    console.warn(`${error.message}. Se usara la copia incluida en el repositorio.`);
    const snapshot = JSON.parse(await readFile(join(dataDirectory, `odepa-${DATA_YEAR}.json`), 'utf8'));
    return { snapshot: validateBaseline(snapshot), source: 'repository_snapshot' };
  }
}

function sortedValues(rows, field) {
  return [...new Set(rows.map((row) => String(row[field] ?? '')))].sort((a, b) => a.localeCompare(b, 'es'));
}

function compactSnapshot(rows, sourceRows, sync) {
  const dates = sortedValues(rows, 'fecha');
  const regions = sortedValues(rows, 'region');
  const markets = sortedValues(rows, 'mercado');
  const subsectors = sortedValues(rows, 'subsector');
  const products = sortedValues(rows, 'producto');
  const varieties = sortedValues(rows, 'variedad');
  const qualities = sortedValues(rows, 'calidad');
  const units = sortedValues(rows, 'unidad_comercializacion');
  const indexes = [dates, regions, markets, subsectors, products, varieties, qualities, units]
    .map((values) => new Map(values.map((value, index) => [value, index])));
  const generatedAt = new Date().toISOString();

  const compactRows = rows.map((row) => [
    indexes[0].get(String(row.fecha ?? '')),
    indexes[1].get(String(row.region ?? '')),
    indexes[2].get(String(row.mercado ?? '')),
    indexes[3].get(String(row.subsector ?? '')),
    indexes[4].get(String(row.producto ?? '')),
    indexes[5].get(String(row.variedad ?? '')),
    indexes[6].get(String(row.calidad ?? '')),
    indexes[7].get(String(row.unidad_comercializacion ?? '')),
    Number(row.volumen ?? 0),
    String(row.precio_minimo ?? ''),
    String(row.precio_maximo ?? ''),
    String(row.precio_promedio ?? ''),
    Number(row.observations ?? 1),
  ]).sort((a, b) => {
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] === b[index]) continue;
      if (typeof a[index] === 'number' && typeof b[index] === 'number') return a[index] - b[index];
      return String(a[index]).localeCompare(String(b[index]), 'es');
    }
    return 0;
  });

  const fingerprint = createHash('sha256').update(JSON.stringify({
    dates, regions, markets, subsectors, products, varieties, qualities, units, rows: compactRows,
  })).digest('hex');
  return {
    meta: {
      schema_version: 3,
      source_url: SOURCE_URL,
      source_year: DATA_YEAR,
      snapshot_generated_at: generatedAt,
      source_fetched_at: generatedAt,
      max_data_date: dates.at(-1),
      min_data_date: dates[0],
      source_rows: sourceRows,
      aggregated_rows: compactRows.length,
      stored_rows: compactRows.length,
      source_file_sha256: fingerprint,
      source_rows_sha256: fingerprint,
      fingerprint_scope: 'normalized public snapshot rows',
      source_system: 'supabase.precios_web',
      source_scope: 'editorial_public_view',
      sync,
    },
    dates, regions, markets, subsectors, products, varieties, qualities, units, rows: compactRows,
  };
}

function rowValueKey(row) {
  return JSON.stringify([
    row.fecha, row.region, row.mercado, row.subsector, row.producto, row.variedad, row.calidad,
    row.unidad_comercializacion, Number(row.volumen ?? 0), String(row.precio_minimo ?? ''),
    String(row.precio_maximo ?? ''), String(row.precio_promedio ?? ''), Number(row.observations ?? 1),
  ]);
}

function multiset(rows) {
  const counts = new Map();
  for (const row of rows) {
    const key = rowValueKey(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function changeMetrics(before, after) {
  const previous = multiset(before);
  const current = multiset(after);
  let added = 0;
  let removed = 0;
  for (const [key, count] of current) added += Math.max(0, count - (previous.get(key) ?? 0));
  for (const [key, count] of previous) removed += Math.max(0, count - (current.get(key) ?? 0));
  return { added_rows: added, removed_rows: removed, unchanged_rows: before.length - removed, changed: added > 0 || removed > 0 };
}

async function setWorkflowOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function rebuildManifest(updatedSnapshot, allowedSeries) {
  const current = JSON.parse(await readFile(join(dataDirectory, 'manifest.json'), 'utf8'));
  const years = [];
  const dimensions = {
    regions: new Set(), markets: new Set(), subsectors: new Set(), products: new Set(),
    varieties: new Set(), qualities: new Set(), units: new Set(),
  };
  const publishedDimensions = {
    regions: new Set(), markets: new Set(), subsectors: new Set(), products: new Set(),
    varieties: new Set(), qualities: new Set(), units: new Set(),
  };

  for (const entry of current.years) {
    const snapshot = entry.year === DATA_YEAR
      ? updatedSnapshot
      : JSON.parse(await readFile(join(dataDirectory, entry.file), 'utf8'));
    const { meta } = snapshot;
    const storedRows = snapshot.rows.length;
    const publishedRows = snapshot.rows.reduce((count, row) => (
      allowedSeries.has(snapshotPublicationKey(snapshot, row)) ? count + 1 : count
    ), 0);
    years.push({
      year: meta.source_year,
      file: entry.file,
      min_data_date: meta.min_data_date,
      max_data_date: meta.max_data_date,
      source_rows: meta.source_rows,
      aggregated_rows: meta.aggregated_rows,
      upstream_rows: meta.source_rows,
      normalized_rows: meta.aggregated_rows,
      stored_rows: storedRows,
      published_rows: publishedRows,
      source_file_sha256: meta.source_file_sha256,
    });
    const dimensionIndexes = { regions: 1, markets: 2, subsectors: 3, products: 4, varieties: 5, qualities: 6, units: 7 };
    for (const row of snapshot.rows) {
      for (const [field, index] of Object.entries(dimensionIndexes)) dimensions[field].add(snapshot[field][row[index]]);
      if (allowedSeries.has(snapshotPublicationKey(snapshot, row))) {
        for (const [field, index] of Object.entries(dimensionIndexes)) publishedDimensions[field].add(snapshot[field][row[index]]);
      }
    }
  }

  return {
    schema_version: 3,
    snapshot_generated_at: updatedSnapshot.meta.snapshot_generated_at,
    min_data_date: years[0].min_data_date,
    max_data_date: years.at(-1).max_data_date,
    source_rows: years.reduce((sum, item) => sum + item.source_rows, 0),
    aggregated_rows: years.reduce((sum, item) => sum + item.aggregated_rows, 0),
    stored_rows: years.reduce((sum, item) => sum + item.stored_rows, 0),
    published_rows: years.reduce((sum, item) => sum + item.published_rows, 0),
    dimension_counts: Object.fromEntries(Object.entries(dimensions).map(([field, values]) => [field, values.size])),
    published_dimension_counts: Object.fromEntries(Object.entries(publishedDimensions).map(([field, values]) => [field, values.size])),
    traceability: {
      historical_snapshots_immutable: true,
      historical_years: years.filter((item) => item.year !== DATA_YEAR).map((item) => item.year),
      publication_filter: 'series-rules.json',
      publication_matching_dimensions: ['subsector', 'product', 'variety', 'quality'],
    },
    years,
  };
}

function publicationKey(row) {
  return JSON.stringify([row.subsector, row.producto, row.variedad, row.calidad]);
}

function snapshotPublicationKey(snapshot, row) {
  return JSON.stringify([
    snapshot.subsectors[row[3]], snapshot.products[row[4]],
    snapshot.varieties[row[5]], snapshot.qualities[row[6]],
  ]);
}

const mode = syncMode();
const baselineResult = await loadBaseline();
const baselineRows = decodeSnapshot(baselineResult.snapshot);
const cutoff = mode === 'incremental' ? subtractDays(baselineResult.snapshot.meta.max_data_date, WINDOW_DAYS - 1) : undefined;
const viewRows = await exactCount('precios_web', cutoff);
console.log(`Supabase: ${viewRows} filas publicas${cutoff ? ` desde ${cutoff}` : ''}`);
const fetchedRows = await fetchAllRows(viewRows, cutoff);
if (fetchedRows.length !== viewRows) throw new Error(`Se esperaban ${viewRows} filas de precios_web y llegaron ${fetchedRows.length}.`);
if (!fetchedRows.length) throw new Error('Supabase no devolvio filas para la conciliacion.');

const fetchedMaxDate = fetchedRows.reduce((max, row) => row.fecha > max ? row.fecha : max, '');
if (fetchedMaxDate < baselineResult.snapshot.meta.max_data_date) {
  throw new Error(`Supabase llega hasta ${fetchedMaxDate}, antes que la copia publicada (${baselineResult.snapshot.meta.max_data_date}). No se publicara.`);
}
const rows = mode === 'full'
  ? fetchedRows
  : [...baselineRows.filter((row) => row.fecha < cutoff), ...fetchedRows];
const metrics = changeMetrics(baselineRows, rows);
const sync = {
  mode,
  window_days: mode === 'incremental' ? WINDOW_DAYS : null,
  window_start: cutoff ?? null,
  baseline: baselineResult.source,
  fetched_rows: fetchedRows.length,
  ...metrics,
};

// precios_web es el unico catalogo editorial. Sus cuatro dimensiones visibles
// se aplican tambien al historial, dejando libres todas las unidades disponibles.
const allowedSeries = new Set(rows.map(publicationKey));
const snapshot = compactSnapshot(rows, rows.length, sync);
await writeFile(join(dataDirectory, `odepa-${DATA_YEAR}.json`), `${JSON.stringify(snapshot)}\n`);
// Los snapshots 2016-2025 son evidencia histórica inmutable. Las reglas de
// publicación se aplican al consultar, nunca borrando filas de esos archivos.
const manifest = await rebuildManifest(snapshot, allowedSeries);
await writeFile(join(dataDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(join(dataDirectory, 'series-rules.json'), `${JSON.stringify({
  schema_version: 1,
  generated_at: snapshot.meta.snapshot_generated_at,
  source: 'supabase.precios_web',
  matching_dimensions: ['subsector', 'product', 'variety', 'quality'],
  total_rules: allowedSeries.size,
  allowed_rules: allowedSeries.size,
  allowed_series: [...allowedSeries].sort(),
})}\n`);

await setWorkflowOutput('changed', String(metrics.changed));
await setWorkflowOutput('mode', mode);
await setWorkflowOutput('fetched_rows', String(fetchedRows.length));

console.log(JSON.stringify({
  year: DATA_YEAR,
  mode,
  window_start: cutoff ?? null,
  baseline: baselineResult.source,
  fetched_rows: fetchedRows.length,
  added_rows: metrics.added_rows,
  removed_rows: metrics.removed_rows,
  changed: metrics.changed,
  source_rows: snapshot.meta.source_rows,
  aggregated_rows: snapshot.meta.aggregated_rows,
  min_data_date: snapshot.meta.min_data_date,
  max_data_date: snapshot.meta.max_data_date,
  publication_rules: allowedSeries.size,
}));
if (!metrics.changed) console.log('Sin nuevos datos');
