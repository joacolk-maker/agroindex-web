'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { getKgConversion, pricePerKgRange, type KgConversion } from './kg-equivalence';

type CompactRow = [number, number, number, number, number, number, number, number, number, string, string, string, number, number, number];
type HistoricalSnapshot = {
  meta: {
    schema_version: 4;
    source_url: string;
    source_year: number;
    snapshot_generated_at: string;
    source_fetched_at: string;
    max_data_date: string;
    min_data_date: string;
    source_rows: number;
    aggregated_rows: number;
    stored_rows?: number;
    source_file_sha256: string;
    source_rows_sha256?: string;
    fingerprint_scope?: string;
    source_system?: string;
    source_scope?: string;
  };
  dates: string[]; regions: string[]; markets: string[]; subsectors: string[];
  products: string[]; varieties: string[]; qualities: string[]; units: string[];
  region_ids: string[]; origins: string[];
  rows: CompactRow[];
};
type Manifest = {
  schema_version: 4;
  snapshot_generated_at: string;
  min_data_date: string;
  max_data_date: string;
  source_rows: number;
  aggregated_rows: number;
  stored_rows?: number;
  published_rows?: number;
  dimension_counts: Record<'regions' | 'markets' | 'subsectors' | 'products' | 'varieties' | 'qualities' | 'units' | 'region_ids' | 'origins', number>;
  published_dimension_counts?: Record<'regions' | 'markets' | 'subsectors' | 'products' | 'varieties' | 'qualities' | 'units' | 'region_ids' | 'origins', number>;
  traceability?: { historical_snapshots_immutable: boolean; historical_years: number[]; publication_filter: string; publication_matching_dimensions: string[] };
  years: { year: number; file: string; original_file?: string; normalized_file?: string; min_data_date: string; max_data_date: string; source_rows: number; aggregated_rows: number; upstream_rows?: number; normalized_rows?: number; stored_rows?: number; published_rows?: number; source_file_sha256?: string }[];
};
type SnapshotRow = { snapshot: HistoricalSnapshot; row: CompactRow };
type DailyPoint = { date: string; volume: number; minimum: number; maximum: number; average: number; observations: number };
type MarketPoint = { market: string; date: string; volume: number; minimum: number; maximum: number; average: number; observations: number };
type MarketDailyPoint = MarketPoint;
type OriginShare = { origin: string; volume: number; share: number; other?: boolean };
type Variation = { days: number; value: number; markets?: number };
type PublicationRules = { schema_version: 1; generated_at: string; source: string; matching_dimensions: string[]; total_rules: number; allowed_rules: number; allowed_series: string[] };
type SeasonalityRow = [number, number, number, number, number, number, number, number[]];
type SeasonalitySnapshot = {
  schema_version: 2;
  baseline_years: number[];
  methodology: string;
  dimensions: Record<'regions' | 'markets' | 'subsectors' | 'products' | 'varieties' | 'qualities' | 'units', string[]>;
  rows: SeasonalityRow[];
};
type GeoPoint = { lat: number; lon: number; source: 'gps' | 'region' };

const money = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
const number = new Intl.NumberFormat('es-CL');
const shortDate = new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', timeZone: 'UTC' });
const longDate = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Santiago' });
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const contactEmail = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || 'joacolk@gmail.com';
const allRegions = 'Todas las regiones';
const allMarkets = 'Todos los mercados';
const allSubsectors = 'Todos los subsectores';
const allVarieties = 'Todas las variedades';
const allQualities = 'Todas las calidades';
const variationPeriods = [7, 14, 30, 60, 90, 180, 360];
const monthLabels = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const marketColors = ['#0f766e', '#e07a4f', '#4f7cac', '#7857a8', '#2f8aa3', '#c9972e', '#a85f45', '#52677d', '#9b5f7a', '#39806e', '#78684d', '#49678f'];
const MINIMUM_REPRESENTATIVE_DAYS = 5;
const regionCoordinates: Record<string, [number, number]> = {
  'Región de Arica y Parinacota': [-18.48, -70.31], 'Región de Coquimbo': [-29.95, -71.34], 'Región de Valparaíso': [-33.05, -71.62],
  'Región Metropolitana de Santiago': [-33.45, -70.67], 'Región del Maule': [-35.43, -71.66], 'Región de Ñuble': [-36.61, -72.10],
  'Región del Biobío': [-36.82, -73.04], 'Región de La Araucanía': [-38.74, -72.60], 'Región de Los Lagos': [-41.47, -72.94],
};
const marketCoordinates: Record<string, [number, number]> = {
  'Agrícola del Norte S.A. de Arica': [-18.48, -70.31], 'Comercializadora del Agro de Limarí': [-30.60, -71.20], 'Femacal de La Calera': [-32.79, -71.20],
  'Feria Lagunitas de Puerto Montt': [-41.44, -73.10], 'Macroferia Regional de Talca': [-35.43, -71.66], 'Mapocho venta directa de Santiago': [-33.44, -70.68],
  'Mercado Mayorista Lo Valledor de Santiago': [-33.50, -70.70], 'Terminal Hortofrutícola Agro Chillán': [-36.60, -72.10], 'Terminal La Palmera de La Serena': [-29.90, -71.25],
  'Vega Central Mapocho de Santiago': [-33.43, -70.65], 'Vega Modelo de Temuco': [-38.73, -72.60], 'Vega Monumental Concepción': [-36.82, -73.03],
};

function parseDate(value: string) { return new Date(`${value}T12:00:00Z`); }
function distanceKm(a: GeoPoint, b: [number, number]) { const earth = 6371; const lat1 = a.lat * Math.PI / 180; const lat2 = b[0] * Math.PI / 180; const dLat = (b[0] - a.lat) * Math.PI / 180; const dLon = (b[1] - a.lon) * Math.PI / 180; const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2; return earth * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value)); }
function isoDate(value: Date) { return value.toISOString().slice(0, 10); }
function formatMetric(value: number, formatter: Intl.NumberFormat) { return Number.isFinite(value) ? formatter.format(value) : '—'; }
function formatPricePerKg(price: number, conversion: KgConversion | null) {
  if (!conversion || !Number.isFinite(price)) return '—';
  const range = pricePerKgRange(price, conversion);
  if (Math.abs(range.maximum - range.minimum) < .01) return `${money.format(range.minimum)}/kg`;
  return `${money.format(range.minimum)}–${money.format(range.maximum)}/kg`;
}
function equivalentLabel(unit: string) {
  return /kilo|gramo/i.test(unit) ? 'Estimación por kilo' : 'Equivalente por unidad';
}
function formatEquivalentPrice(price: number, unit: string, conversion: KgConversion | null) {
  if (!Number.isFinite(price)) return '—';
  if (/kilo|gramo/i.test(unit)) return formatPricePerKg(price, conversion);
  const count = unit.match(/(\d+)\s+(?:unidades|atados|matas|paquetes)/i);
  if (count) return `${money.format(price / Number(count[1]))}/unidad`;
  return formatPricePerKg(price, conversion);
}
function commercialVolumeLabel(volume: number, unit: string) {
  const match = unit.match(/^\$\/([^\s]+)/i);
  const rawCommercial = match ? match[1].toLocaleLowerCase('es-CL') : 'unidad';
  const commercial = rawCommercial.endsWith('s') ? rawCommercial : `${rawCommercial}s`;
  const count = unit.match(/(\d+)\s+unidades/i);
  return { primary: `${number.format(volume)} ${commercial}`, secondary: count ? `${number.format(volume * Number(count[1]))} unidades` : null };
}
function seasonDescription(category?: string) {
  if (category === 'Nula') return 'sin volumen informado';
  if (category === 'Escasa') return 'volumen bajo';
  if (category === 'Media') return 'volumen intermedio';
  return 'volumen alto';
}
function axisLabel(date: string, spanDays: number, compact = false) {
  const value = parseDate(date);
  if (compact) {
    if (spanDays > 730) return String(value.getUTCFullYear());
    if (spanDays > 120) return `${String(value.getUTCMonth() + 1).padStart(2, '0')}/${String(value.getUTCFullYear()).slice(-2)}`;
    return `${String(value.getUTCDate()).padStart(2, '0')}/${String(value.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  if (spanDays > 730) return String(value.getUTCFullYear());
  if (spanDays > 120) return new Intl.DateTimeFormat('es-CL', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(value);
  return shortDate.format(value);
}
function chartResolution(points: DailyPoint[]) {
  if (points.length < 2) return points;
  const spanDays = (parseDate(points.at(-1)!.date).getTime() - parseDate(points[0].date).getTime()) / 86400000;
  if (spanDays <= 730) return points;
  const groups = new Map<string, { volume: number; minimum: number; maximum: number; weighted: number; observations: number }>();
  points.forEach((point) => { const key = point.date.slice(0, 7); const value = groups.get(key) ?? { volume: 0, minimum: Infinity, maximum: -Infinity, weighted: 0, observations: 0 }; value.volume += point.volume; value.minimum = Math.min(value.minimum, point.minimum); value.maximum = Math.max(value.maximum, point.maximum); value.weighted += point.average * point.volume; value.observations += point.observations; groups.set(key, value); });
  return [...groups.entries()].map(([month, value]) => ({ date: `${month}-15`, volume: value.volume, minimum: value.minimum, maximum: value.maximum, average: value.weighted / value.volume, observations: value.observations }));
}
function rollingVolumeTrend(points: DailyPoint[]) {
  return points.map((point, index) => {
    const currentDate = parseDate(point.date).getTime();
    const window = points.slice(0, index + 1).filter((candidate) => currentDate - parseDate(candidate.date).getTime() <= 29 * 86400000);
    const weighted = window.reduce((sum, candidate) => {
      const age = Math.round((currentDate - parseDate(candidate.date).getTime()) / 86400000);
      const weight = Math.max(1, 30 - age);
      return { value: sum.value + candidate.volume * weight, weight: sum.weight + weight };
    }, { value: 0, weight: 0 });
    return weighted.weight ? weighted.value / weighted.weight : point.volume;
  });
}
function closestHistoricalPoint(points: DailyPoint[], targetDate: string, toleranceDays = 7) {
  const target = parseDate(targetDate).getTime();
  return points.filter((point) => Math.abs(parseDate(point.date).getTime() - target) <= toleranceDays * 86400000).sort((a, b) => {
    const distance = Math.abs(parseDate(a.date).getTime() - target) - Math.abs(parseDate(b.date).getTime() - target);
    return distance || b.date.localeCompare(a.date);
  })[0];
}
function seriesKey(snapshot: HistoricalSnapshot, row: CompactRow) {
  return JSON.stringify([snapshot.subsectors[row[3]], snapshot.products[row[4]], snapshot.varieties[row[5]], snapshot.qualities[row[6]]]);
}
function dimensionOptions(rows: SnapshotRow[], valueFor: (entry: SnapshotRow) => string, representativeOnly: boolean) {
  const statistics = new Map<string, { observations: number; dates: Set<string> }>();
  rows.forEach((entry) => {
    const value = valueFor(entry);
    const current = statistics.get(value) ?? { observations: 0, dates: new Set<string>() };
    current.observations += entry.row[12]; current.dates.add(entry.snapshot.dates[entry.row[0]]); statistics.set(value, current);
  });
  return [...statistics.entries()]
    .filter(([, stat]) => !representativeOnly || stat.dates.size >= MINIMUM_REPRESENTATIVE_DAYS)
    .map(([value]) => value).sort((a, b) => a.localeCompare(b, 'es'));
}

function PriceChart({ points }: { points: DailyPoint[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState({ minimum: true, average: true, maximum: true });
  const [hovered, setHovered] = useState<number | null>(null);
  const spanDays = points.length > 1 ? Math.round((parseDate(points.at(-1)!.date).getTime() - parseDate(points[0].date).getTime()) / 86400000) : 0;

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas || !points.length) return;
    const draw = () => {
      const context = canvas.getContext('2d'); if (!context) return;
      const ratio = window.devicePixelRatio || 1; const width = canvas.clientWidth; const height = canvas.clientHeight;
      canvas.width = width * ratio; canvas.height = height * ratio; context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height);
      const margin = { top: 18, right: 20, bottom: 44, left: 68 }; const chartWidth = width - margin.left - margin.right; const chartHeight = height - margin.top - margin.bottom;
      const x = (index: number) => margin.left + (points.length === 1 ? chartWidth / 2 : index * chartWidth / (points.length - 1));
      const shown = (['minimum', 'average', 'maximum'] as const).filter((field) => visible[field]);
      const values = points.flatMap((point) => shown.map((field) => point[field])); if (!values.length) return;
      const rawMin = Math.min(...values); const rawMax = Math.max(...values); const padding = Math.max((rawMax - rawMin) * .12, rawMax * .03, 1); const yMin = Math.max(0, rawMin - padding); const yMax = rawMax + padding;
      const y = (value: number) => margin.top + (yMax - value) * chartHeight / (yMax - yMin || 1);
      context.font = '11px Inter, system-ui, sans-serif'; context.fillStyle = '#647985'; context.strokeStyle = '#dce7e3'; context.lineWidth = 1;
      for (let tick = 0; tick <= 4; tick += 1) { const value = yMin + (yMax - yMin) * tick / 4; const yy = y(value); context.beginPath(); context.moveTo(margin.left, yy); context.lineTo(width - margin.right, yy); context.stroke(); context.textAlign = 'right'; context.fillText(money.format(value), margin.left - 10, yy + 4); }
      const compactLabels = width < 600;
      const labelCount = Math.min(compactLabels ? (width < 400 ? 3 : 4) : 6, points.length);
      for (let tick = 0; tick < labelCount; tick += 1) { const index = Math.round(tick * (points.length - 1) / Math.max(labelCount - 1, 1)); context.textAlign = tick === 0 ? 'left' : tick === labelCount - 1 ? 'right' : 'center'; context.fillText(axisLabel(points[index].date, spanDays, compactLabels), x(index), height - 14); }
      if (visible.minimum && visible.maximum) { context.beginPath(); points.forEach((point, index) => index ? context.lineTo(x(index), y(point.maximum)) : context.moveTo(x(index), y(point.maximum))); for (let index = points.length - 1; index >= 0; index -= 1) context.lineTo(x(index), y(points[index].minimum)); context.closePath(); context.fillStyle = 'rgba(15,118,110,.10)'; context.fill(); }
      const line = (field: 'minimum' | 'average' | 'maximum', color: string, widthValue: number, dash: number[] = []) => { if (!visible[field]) return; context.beginPath(); context.strokeStyle = color; context.lineWidth = widthValue; context.setLineDash(dash); points.forEach((point, index) => index ? context.lineTo(x(index), y(point[field])) : context.moveTo(x(index), y(point[field]))); context.stroke(); context.setLineDash([]); };
      line('minimum', '#d56e49', 1.5, [5, 4]); line('maximum', '#4f7cac', 1.5, [5, 4]); line('average', '#0f766e', 3);
      if (hovered !== null) { const xx = x(hovered); context.strokeStyle = '#0b253380'; context.setLineDash([3, 3]); context.beginPath(); context.moveTo(xx, margin.top); context.lineTo(xx, margin.top + chartHeight); context.stroke(); context.setLineDash([]); }
    };
    draw(); const observer = new ResizeObserver(draw); observer.observe(canvas); return () => observer.disconnect();
  }, [points, visible, hovered, spanDays]);

  if (!points.length) return <div className="empty-chart">No hay observaciones para la combinación seleccionada.</div>;
  const point = hovered === null ? null : points[hovered];
  return <><div className="chart-toggles" aria-label="Series de precio">{([['minimum', 'Mínimo'], ['average', 'Promedio'], ['maximum', 'Máximo']] as const).map(([field, label]) => <label key={field}><input type="checkbox" checked={visible[field]} onChange={() => setVisible((value) => ({ ...value, [field]: !value[field] }))} />{label}</label>)}</div><div className="canvas-wrap"><canvas ref={canvasRef} className="price-chart" role="img" aria-label="Gráfico histórico de precio mínimo, promedio y máximo" onMouseMove={(event) => { const rect = event.currentTarget.getBoundingClientRect(); const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left - 68) / Math.max(1, rect.width - 88))); setHovered(Math.round(fraction * (points.length - 1))); }} onMouseLeave={() => setHovered(null)} />{point && <div className="chart-tooltip"><strong>{longDate.format(parseDate(point.date))}</strong>{visible.minimum && <span>Mínimo {money.format(point.minimum)}</span>}{visible.average && <span>Promedio {money.format(point.average)}</span>}{visible.maximum && <span>Máximo {money.format(point.maximum)}</span>}</div>}</div></>;
}

function VolumeChart({ points, unit }: { points: DailyPoint[]; unit: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const spanDays = points.length > 1 ? Math.round((parseDate(points.at(-1)!.date).getTime() - parseDate(points[0].date).getTime()) / 86400000) : 0;
  const trend = useMemo(() => rollingVolumeTrend(points), [points]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !points.length) return;
    const draw = () => {
      const context = canvas.getContext('2d');
      if (!context) return;
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      canvas.width = width * ratio; canvas.height = height * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height);
      const margin = { top: 20, right: 18, bottom: 42, left: 68 };
      const chartWidth = width - margin.left - margin.right;
      const chartHeight = height - margin.top - margin.bottom;
      const maximum = Math.max(...points.map((point) => point.volume), ...trend, 1);
      const x = (index: number) => margin.left + (index + .5) * chartWidth / points.length;
      const y = (value: number) => margin.top + (maximum - value) * chartHeight / maximum;
      context.font = '11px Inter, system-ui, sans-serif'; context.fillStyle = '#647985'; context.strokeStyle = '#dce7e3';
      for (let tick = 0; tick <= 4; tick += 1) {
        const value = maximum * tick / 4; const yy = y(value);
        context.beginPath(); context.moveTo(margin.left, yy); context.lineTo(width - margin.right, yy); context.stroke();
        context.textAlign = 'right'; context.fillText(number.format(Math.round(value)), margin.left - 10, yy + 4);
      }
      const barWidth = Math.max(2, Math.min(18, chartWidth / Math.max(points.length, 1) * .68));
      context.fillStyle = 'rgba(15,118,110,.62)';
      points.forEach((point, index) => context.fillRect(x(index) - barWidth / 2, y(point.volume), barWidth, margin.top + chartHeight - y(point.volume)));
      if (trend.length > 1) { context.beginPath(); context.strokeStyle = '#0b2533'; context.lineWidth = 2.5; context.lineJoin = 'round'; context.lineCap = 'round'; trend.forEach((value, index) => index ? context.lineTo(x(index), y(value)) : context.moveTo(x(index), y(value))); context.stroke(); }
      const compactLabels = width < 600;
      const labelCount = Math.min(compactLabels ? (width < 400 ? 3 : 4) : 5, points.length);
      for (let tick = 0; tick < labelCount; tick += 1) {
        const index = Math.round(tick * (points.length - 1) / Math.max(labelCount - 1, 1));
        context.textAlign = tick === 0 ? 'left' : tick === labelCount - 1 ? 'right' : 'center';
        context.fillText(axisLabel(points[index].date, spanDays, compactLabels), x(index), height - 14);
      }
      if (hovered !== null) { const xx = x(hovered); context.strokeStyle = '#0b253380'; context.setLineDash([3, 3]); context.beginPath(); context.moveTo(xx, margin.top); context.lineTo(xx, margin.top + chartHeight); context.stroke(); context.setLineDash([]); }
    };
    draw(); const observer = new ResizeObserver(draw); observer.observe(canvas); return () => observer.disconnect();
  }, [points, trend, hovered, spanDays]);

  if (!points.length) return <div className="empty-chart">No hay volúmenes para la combinación seleccionada.</div>;
  const point = hovered === null ? null : points[hovered];
  return <><p className="chart-unit">Volumen expresado en unidades de comercialización: <strong>{unit}</strong><span className="trend-key">Promedio móvil ponderado · 30 días</span></p><div className="canvas-wrap"><canvas ref={canvasRef} className="price-chart" role="img" aria-label="Gráfico de volumen transado por fecha y promedio móvil ponderado de 30 días" onMouseMove={(event) => { const rect = event.currentTarget.getBoundingClientRect(); const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left - 68) / Math.max(1, rect.width - 86))); setHovered(Math.round(fraction * (points.length - 1))); }} onMouseLeave={() => setHovered(null)} />{point && <div className="chart-tooltip"><strong>{longDate.format(parseDate(point.date))}</strong><span>{number.format(point.volume)} unidades</span><span>Promedio móvil: {number.format(Math.round(trend[hovered!]))}</span></div>}</div></>;
}

function MarketEvolutionChart({ points }: { points: MarketDailyPoint[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markets = useMemo(() => [...new Set(points.map((point) => point.market))].sort((a, b) => a.localeCompare(b, 'es')), [points]);
  const dates = useMemo(() => [...new Set(points.map((point) => point.date))].sort(), [points]);
  const [activeMarkets, setActiveMarkets] = useState<string[]>([]);
  const displayedMarkets = activeMarkets.length ? activeMarkets.filter((market) => markets.includes(market)) : markets.slice(0, Math.min(5, markets.length));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !points.length || !dates.length || !displayedMarkets.length) return;
    const draw = () => {
      const context = canvas.getContext('2d'); if (!context) return;
      const ratio = window.devicePixelRatio || 1; const width = canvas.clientWidth; const height = canvas.clientHeight;
      canvas.width = width * ratio; canvas.height = height * ratio; context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height);
      const margin = { top: 22, right: 22, bottom: 42, left: 68 }; const chartWidth = width - margin.left - margin.right; const chartHeight = height - margin.top - margin.bottom;
      const displayed = points.filter((point) => displayedMarkets.includes(point.market)); const prices = displayed.map((point) => point.average); if (!prices.length) return; const rawMin = Math.min(...prices); const rawMax = Math.max(...prices);
      const padding = Math.max((rawMax - rawMin) * .1, rawMax * .03, 1); const yMin = Math.max(0, rawMin - padding); const yMax = rawMax + padding;
      const spanDays = Math.round((parseDate(dates.at(-1)!).getTime() - parseDate(dates[0]).getTime()) / 86400000);
      const x = (date: string) => margin.left + (dates.length === 1 ? chartWidth / 2 : dates.indexOf(date) * chartWidth / (dates.length - 1));
      const y = (value: number) => margin.top + (yMax - value) * chartHeight / (yMax - yMin || 1);
      context.font = '11px Inter, system-ui, sans-serif'; context.fillStyle = '#647985'; context.strokeStyle = '#dce7e3';
      for (let tick = 0; tick <= 4; tick += 1) {
        const price = yMin + (yMax - yMin) * tick / 4; const yy = y(price);
        context.beginPath(); context.moveTo(margin.left, yy); context.lineTo(width - margin.right, yy); context.stroke();
        context.textAlign = 'right'; context.fillText(money.format(price), margin.left - 10, yy + 4);
      }
      const compactLabels = width < 600;
      const labelCount = Math.min(compactLabels ? (width < 400 ? 3 : 4) : 5, dates.length);
      for (let tick = 0; tick < labelCount; tick += 1) {
        const index = Math.round(tick * (dates.length - 1) / Math.max(labelCount - 1, 1));
        context.textAlign = tick === 0 ? 'left' : tick === labelCount - 1 ? 'right' : 'center'; context.fillText(axisLabel(dates[index], spanDays, compactLabels), x(dates[index]), height - 14);
      }
      markets.filter((rowMarket) => displayedMarkets.includes(rowMarket)).forEach((rowMarket) => {
        const index = markets.indexOf(rowMarket);
        const marketSeries = points.filter((point) => point.market === rowMarket).sort((a, b) => a.date.localeCompare(b.date));
        context.beginPath(); context.strokeStyle = marketColors[index % marketColors.length]; context.lineWidth = 2.2;
        marketSeries.forEach((point, pointIndex) => pointIndex === 0 ? context.moveTo(x(point.date), y(point.average)) : context.lineTo(x(point.date), y(point.average)));
        context.stroke();
      });
    };
    draw(); const observer = new ResizeObserver(draw); observer.observe(canvas); return () => observer.disconnect();
  }, [points, markets, dates, displayedMarkets]);

  if (!points.length) return <div className="empty-chart">No hay mercados comparables para la combinación seleccionada.</div>;
  return <><div className="market-selector" aria-label="Series de mercados">{markets.map((rowMarket, index) => <label key={rowMarket}><input type="checkbox" checked={displayedMarkets.includes(rowMarket)} onChange={() => setActiveMarkets((current) => { const selected = current.length ? current : markets.slice(0, Math.min(5, markets.length)); return selected.includes(rowMarket) ? selected.filter((item) => item !== rowMarket) : [...selected, rowMarket]; })} /><i style={{ background: marketColors[index % marketColors.length] }} />{rowMarket}</label>)}</div>{displayedMarkets.length ? <canvas ref={canvasRef} className="price-chart" role="img" aria-label="Evolución del precio promedio ponderado por mercado" /> : <div className="empty-chart">Selecciona uno o más mercados para compararlos.</div>}</>;
}

export default function Home() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [snapshots, setSnapshots] = useState<Record<number, HistoricalSnapshot>>({});
  const [loadError, setLoadError] = useState(false);
  const [publicationRules, setPublicationRules] = useState<PublicationRules | null>(null);
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const requestedYears = useRef(new Set<number>());
  const marketFilterRef = useRef<HTMLDetailsElement>(null);
  const [region, setRegion] = useState(allRegions);
  const [selectedMarkets, setSelectedMarkets] = useState<string[]>([]);
  const [subsector, setSubsector] = useState(allSubsectors);
  const [product, setProduct] = useState('');
  const [variety, setVariety] = useState(allVarieties);
  const [quality, setQuality] = useState(allQualities);
  const [unit, setUnit] = useState('');
  const [representativeOnly, setRepresentativeOnly] = useState(true);
  const [geoLocation, setGeoLocation] = useState<GeoPoint | null>(null);
  const [geoStatus, setGeoStatus] = useState<'loading' | 'ready' | 'denied'>('loading');
  const [seasonality, setSeasonality] = useState<SeasonalitySnapshot | null>(null);
  const [seasonalityMonth, setSeasonalityMonth] = useState(new Date().getUTCMonth() + 1);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [contactStatus, setContactStatus] = useState('');

  useEffect(() => {
    fetch(`${basePath}/data/manifest.json`)
      .then(async (response) => { if (!response.ok) throw new Error('No se pudo cargar el manifiesto'); return await response.json() as Manifest; })
      .then((data) => {
        if (data.schema_version !== 4) throw new Error('Versión de datos incompatible');
        setManifest(data);
        const initialStart = new Date();
        initialStart.setFullYear(initialStart.getFullYear() - 1);
        setFrom(isoDate(initialStart) < data.min_data_date ? data.min_data_date : isoDate(initialStart));
        setTo(data.max_data_date);
      })
      .catch(() => setLoadError(true));
  }, []);

  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      const filter = marketFilterRef.current;
      if (filter?.open && !filter.contains(event.target as Node)) filter.open = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      const filter = marketFilterRef.current;
      if (event.key !== 'Escape' || !filter?.open) return;
      filter.open = false;
      filter.querySelector('summary')?.focus();
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) { window.setTimeout(() => setGeoStatus('denied'), 0); return; }
    navigator.geolocation.getCurrentPosition((position) => { setGeoLocation({ lat: position.coords.latitude, lon: position.coords.longitude, source: 'gps' }); setGeoStatus('ready'); }, () => setGeoStatus('denied'), { enableHighAccuracy: false, maximumAge: 300000, timeout: 8000 });
  }, []);


  useEffect(() => {
    fetch(`${basePath}/data/seasonality-v2.json`)
      .then(async (response) => { if (!response.ok) return null; return await response.json() as SeasonalitySnapshot; })
      .then((data) => setSeasonality(data))
      .catch(() => setSeasonality(null));
  }, []);

  useEffect(() => {
    fetch(`${basePath}/data/series-rules.json`)
      .then(async (response) => { if (!response.ok) return null; return await response.json() as PublicationRules; })
      .then((data) => { setPublicationRules(data); setRulesLoaded(true); })
      .catch(() => setRulesLoaded(true));
  }, []);

  const variationFrom = useMemo(() => {
    if (!to) return from;
    const start = parseDate(to); start.setUTCDate(start.getUTCDate() - 360);
    return manifest && isoDate(start) < manifest.min_data_date ? manifest.min_data_date : isoDate(start);
  }, [manifest, from, to]);
  const loadFrom = from && variationFrom ? (from < variationFrom ? from : variationFrom) : from;
  const requiredYears = useMemo(() => manifest?.years.filter((item) => item.max_data_date >= loadFrom && item.min_data_date <= to) ?? [], [manifest, loadFrom, to]);
  useEffect(() => {
    if (!manifest || !from || !to) return;
    requiredYears.forEach((item) => {
      if (snapshots[item.year] || requestedYears.current.has(item.year)) return;
      requestedYears.current.add(item.year);
      fetch(`${basePath}/data/${item.normalized_file ?? item.file}`)
        .then(async (response) => { if (!response.ok) throw new Error(`No se pudo cargar ${item.year}`); return await response.json() as HistoricalSnapshot; })
        .then((data) => {
          if (data.meta.schema_version !== 4) throw new Error('Versión anual incompatible');
          setSnapshots((current) => ({ ...current, [item.year]: data }));
        })
        .catch(() => { requestedYears.current.delete(item.year); setLoadError(true); });
    });
  }, [manifest, requiredYears, snapshots, from, to]);

  const dataReady = rulesLoaded && requiredYears.length > 0 && requiredYears.every((item) => snapshots[item.year]);
  const allowedSeries = useMemo(() => publicationRules ? new Set(publicationRules.allowed_series) : null, [publicationRules]);
  const catalog = useMemo(() => {
    if (!dataReady) return { rows: [], comparisonRows: [], historyRows: [], comparisonHistoryRows: [], options: { regions: [], markets: [], subsectors: [], products: [] } };
    const options = { regions: new Set<string>(), markets: new Set<string>(), subsectors: new Set<string>(), products: new Set<string>() };
    const rows: SnapshotRow[] = [];
    const comparisonRows: SnapshotRow[] = [];
    const historyRows: SnapshotRow[] = [];
    const comparisonHistoryRows: SnapshotRow[] = [];
    requiredYears.forEach(({ year }) => {
      const snapshot = snapshots[year];
      if (!snapshot) return;
      snapshot.rows.forEach((row) => {
        if (allowedSeries && !allowedSeries.has(seriesKey(snapshot, row))) return;
        const date = snapshot.dates[row[0]];
        if (date > to) return;
        const rowRegion = snapshot.regions[row[1]];
        const rowMarket = snapshot.markets[row[2]];
        const rowSubsector = snapshot.subsectors[row[3]];
        const rowProduct = snapshot.products[row[4]];
        const inVisibleRange = date >= from;
        if (inVisibleRange) options.regions.add(rowRegion);
        const regionMatches = region === allRegions || rowRegion === region;
        if (inVisibleRange && regionMatches) options.markets.add(rowMarket);
        const marketMatches = selectedMarkets.length === 0 || selectedMarkets.includes(rowMarket);
        if (inVisibleRange && regionMatches && marketMatches) options.subsectors.add(rowSubsector);
        const subsectorMatches = subsector === allSubsectors || rowSubsector === subsector;
        if (inVisibleRange && regionMatches && marketMatches && subsectorMatches) options.products.add(rowProduct);
        if (regionMatches && marketMatches && subsectorMatches) historyRows.push({ snapshot, row });
        if (regionMatches && marketMatches && subsectorMatches) comparisonHistoryRows.push({ snapshot, row });
        if (inVisibleRange && regionMatches && marketMatches && subsectorMatches) comparisonRows.push({ snapshot, row });
        if (inVisibleRange && regionMatches && marketMatches && subsectorMatches) rows.push({ snapshot, row });
      });
    });
    const sort = (values: Set<string>) => [...values].sort((a, b) => a.localeCompare(b, 'es'));
    return {
      rows, comparisonRows, historyRows, comparisonHistoryRows,
      options: { regions: sort(options.regions), markets: sort(options.markets), subsectors: sort(options.subsectors), products: sort(options.products) },
    };
  }, [dataReady, requiredYears, snapshots, from, to, region, selectedMarkets, subsector, allowedSeries]);

  const { regions: regionOptions, markets: marketOptions, subsectors: subsectorOptions } = catalog.options;
  const marketLabel = selectedMarkets.length === 0 ? allMarkets : selectedMarkets.length === 1 ? selectedMarkets[0] : `${selectedMarkets.length} mercados seleccionados`;
  const productOptions = useMemo(() => dimensionOptions(catalog.historyRows, ({ snapshot, row }) => snapshot.products[row[4]], representativeOnly), [catalog.historyRows, representativeOnly]);
  const effectiveProduct = productOptions.includes(product) ? product : '';
  const series = useMemo(() => {
    const productRows = catalog.rows.filter(({ snapshot, row }) => snapshot.products[row[4]] === effectiveProduct);
    const comparisonProductRows = catalog.comparisonRows.filter(({ snapshot, row }) => snapshot.products[row[4]] === effectiveProduct);
    const historyProductRows = catalog.historyRows.filter(({ snapshot, row }) => snapshot.products[row[4]] === effectiveProduct);
    const comparisonHistoryProductRows = catalog.comparisonHistoryRows.filter(({ snapshot, row }) => snapshot.products[row[4]] === effectiveProduct);
    const varietyOptions = dimensionOptions(historyProductRows, ({ snapshot, row }) => snapshot.varieties[row[5]], representativeOnly);
    const effectiveVariety = variety === allVarieties || varietyOptions.includes(variety) ? variety : allVarieties;
    const varietyMatches = ({ snapshot, row }: SnapshotRow) => effectiveVariety === allVarieties || snapshot.varieties[row[5]] === effectiveVariety;
    const varietyRows = productRows.filter(varietyMatches);
    const comparisonVarietyRows = comparisonProductRows.filter(varietyMatches);
    const historyVarietyRows = historyProductRows.filter(varietyMatches);
    const comparisonHistoryVarietyRows = comparisonHistoryProductRows.filter(varietyMatches);
    const qualityOptions = dimensionOptions(historyVarietyRows, ({ snapshot, row }) => snapshot.qualities[row[6]], representativeOnly);
    const effectiveQuality = quality === allQualities || qualityOptions.includes(quality) ? quality : allQualities;
    const qualityMatches = ({ snapshot, row }: SnapshotRow) => effectiveQuality === allQualities || snapshot.qualities[row[6]] === effectiveQuality;
    const qualityRows = varietyRows.filter(qualityMatches);
    const comparisonQualityRows = comparisonVarietyRows.filter(qualityMatches);
    const historyQualityRows = historyVarietyRows.filter(qualityMatches);
    const comparisonHistoryQualityRows = comparisonHistoryVarietyRows.filter(qualityMatches);
    const unitOptions = dimensionOptions(historyQualityRows, ({ snapshot, row }) => snapshot.units[row[7]], representativeOnly);
    const effectiveUnit = unitOptions.includes(unit) ? unit : (unitOptions.length === 1 ? unitOptions[0] : '');
    const unitMatches = ({ snapshot, row }: SnapshotRow) => snapshot.units[row[7]] === effectiveUnit;
    return {
      rows: qualityRows.filter(unitMatches), comparisonRows: comparisonQualityRows.filter(unitMatches), variationRows: historyQualityRows.filter(unitMatches), comparisonVariationRows: comparisonHistoryQualityRows.filter(unitMatches),
      varietyOptions, qualityOptions, unitOptions, effectiveVariety, effectiveQuality, effectiveUnit,
    };
  }, [catalog, effectiveProduct, variety, quality, unit, representativeOnly]);

  const { varietyOptions, qualityOptions, unitOptions, effectiveVariety, effectiveQuality, effectiveUnit } = series;

  const dailyPoints = useMemo(() => {
    const groups = new Map<string, { volume: number; minimum: number; maximum: number; weighted: number; observations: number }>();
    series.rows.forEach(({ snapshot, row }) => {
      const date = snapshot.dates[row[0]];
      const current = groups.get(date) ?? { volume: 0, minimum: Infinity, maximum: -Infinity, weighted: 0, observations: 0 };
      current.volume += row[8]; current.minimum = Math.min(current.minimum, Number(row[9])); current.maximum = Math.max(current.maximum, Number(row[10])); current.weighted += Number(row[11]) * row[8]; current.observations += row[12]; groups.set(date, current);
    });
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, group]) => ({ date, volume: group.volume, minimum: group.minimum, maximum: group.maximum, average: group.weighted / group.volume, observations: group.observations }));
  }, [series.rows]);
  const displayPoints = useMemo(() => chartResolution(dailyPoints), [dailyPoints]);

  const marketDailyPoints = useMemo(() => {
    const groups = new Map<string, { market: string; date: string; volume: number; minimum: number; maximum: number; weighted: number; observations: number }>();
    series.comparisonRows.forEach(({ snapshot, row }) => {
      const rowMarket = snapshot.markets[row[2]];
      const date = snapshot.dates[row[0]]; const key = `${rowMarket}\u0000${date}`;
      const current = groups.get(key) ?? { market: rowMarket, date, volume: 0, minimum: Infinity, maximum: -Infinity, weighted: 0, observations: 0 };
      current.volume += row[8]; current.minimum = Math.min(current.minimum, Number(row[9])); current.maximum = Math.max(current.maximum, Number(row[10])); current.weighted += Number(row[11]) * row[8]; current.observations += row[12]; groups.set(key, current);
    });
    return [...groups.values()].map((group) => ({ market: group.market, date: group.date, volume: group.volume, minimum: group.minimum, maximum: group.maximum, average: group.weighted / group.volume, observations: group.observations })).sort((a, b) => a.date.localeCompare(b.date));
  }, [series.comparisonRows]);

  const marketVariationDailyPoints = useMemo(() => {
    const groups = new Map<string, { market: string; date: string; volume: number; minimum: number; maximum: number; weighted: number; observations: number }>();
    series.comparisonVariationRows.forEach(({ snapshot, row }) => {
      const marketName = snapshot.markets[row[2]]; const date = snapshot.dates[row[0]]; const key = `${marketName}\u0000${date}`;
      const current = groups.get(key) ?? { market: marketName, date, volume: 0, minimum: Infinity, maximum: -Infinity, weighted: 0, observations: 0 };
      current.volume += row[8]; current.minimum = Math.min(current.minimum, Number(row[9])); current.maximum = Math.max(current.maximum, Number(row[10])); current.weighted += Number(row[11]) * row[8]; current.observations += row[12]; groups.set(key, current);
    });
    return [...groups.values()].map((group) => ({ market: group.market, date: group.date, volume: group.volume, minimum: group.minimum, maximum: group.maximum, average: group.weighted / group.volume, observations: group.observations })).sort((a, b) => a.date.localeCompare(b.date));
  }, [series.comparisonVariationRows]);

  const marketPoints = useMemo(() => {
    const latest = new Map<string, MarketPoint>();
    marketDailyPoints.forEach((point) => latest.set(point.market, point));
    return [...latest.values()].sort((a, b) => b.average - a.average);
  }, [marketDailyPoints]);
  const marketRows = useMemo(() => marketPoints.map((row) => {
    const seriesPoints = marketVariationDailyPoints.filter((point) => point.market === row.market && point.date <= row.date);
    const variation = (days: number) => {
      const target = parseDate(row.date); target.setUTCDate(target.getUTCDate() - days);
      const reference = closestHistoricalPoint(seriesPoints, isoDate(target), days === 30 ? 7 : 4);
      return reference?.average ? (row.average / reference.average - 1) * 100 : Number.NaN;
    };
    return { ...row, variation7: variation(7), variation30: variation(30) };
  }), [marketPoints, marketVariationDailyPoints]);

  const latestPoint = dailyPoints[dailyPoints.length - 1];
  const kgConversion = useMemo(() => getKgConversion(effectiveProduct, effectiveUnit), [effectiveProduct, effectiveUnit]);
  const activity = useMemo(() => {
    const start = from ? parseDate(from) : undefined; const end = to ? parseDate(to) : undefined;
    const calendarDays = start && end ? Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1) : dailyPoints.length;
    const markets = new Set(series.rows.map(({ snapshot, row }) => snapshot.markets[row[2]])).size;
    return { days: dailyPoints.length, calendarDays, markets };
  }, [dailyPoints, series.rows, from, to]);
  const originShares = useMemo<OriginShare[]>(() => {
    const totals = new Map<string, number>();
    series.rows.forEach(({ snapshot, row }) => {
      const origin = snapshot.origins[row[14]] || 'Sin especificar';
      totals.set(origin, (totals.get(origin) ?? 0) + row[8]);
    });
    const total = [...totals.values()].reduce((sum, value) => sum + value, 0);
    if (!total) return [];
    const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    const selected: OriginShare[] = [];
    let cumulative = 0;
    for (const [origin, volume] of sorted) {
      selected.push({ origin, volume, share: volume / total });
      cumulative += volume / total;
      if (cumulative >= 0.8) break;
    }
    const remainder = Math.max(0, total - selected.reduce((sum, item) => sum + item.volume, 0));
    if (remainder > 0) selected.push({ origin: 'Otros', volume: remainder, share: remainder / total, other: true });
    return selected;
  }, [series.rows]);
  const locationPoint = useMemo(() => geoLocation ?? (regionCoordinates[region] ? { lat: regionCoordinates[region][0], lon: regionCoordinates[region][1], source: 'region' as const } : null), [geoLocation, region]);
  const nearestMarketToday = useMemo(() => {
    if (!latestPoint || !locationPoint) return undefined;
    return marketDailyPoints.filter((point) => point.date === latestPoint.date && marketCoordinates[point.market]).map((point) => ({ point, distance: distanceKm(locationPoint, marketCoordinates[point.market]) })).sort((a, b) => a.distance - b.distance)[0];
  }, [marketDailyPoints, latestPoint, locationPoint]);
  const variations = useMemo<Variation[]>(() => variationPeriods.map((days): Variation => {
    // Comparamos la misma canasta de mercados en ambas fechas. Así, una variación
    // no cambia de signo sólo porque hoy un mercado tuvo más volumen que hace un mes.
    const comparable = marketPoints.flatMap((market) => {
      const history = marketVariationDailyPoints.filter((point) => point.market === market.market && point.date <= market.date);
      const target = parseDate(market.date); target.setUTCDate(target.getUTCDate() - days);
      const reference = closestHistoricalPoint(history, isoDate(target), 7);
      return reference?.average && reference.volume > 0 ? [{ current: market.average, reference: reference.average, weight: reference.volume }] : [];
    });
    const totalWeight = comparable.reduce((sum, item) => sum + item.weight, 0);
    if (!totalWeight) return { days, value: Number.NaN, markets: 0 };
    const currentIndex = comparable.reduce((sum, item) => sum + item.current * item.weight, 0) / totalWeight;
    const referenceIndex = comparable.reduce((sum, item) => sum + item.reference * item.weight, 0) / totalWeight;
    return { days, value: referenceIndex ? (currentIndex / referenceIndex - 1) * 100 : Number.NaN, markets: comparable.length };
  }), [marketPoints, marketVariationDailyPoints]);
  const productSeasonality = useMemo(() => {
    if (!seasonality || !effectiveProduct || !effectiveUnit) return null;
    const { dimensions, rows } = seasonality;
    const volumes = Array(12).fill(0);
    rows.forEach((row) => {
      const [rowRegion, rowMarket, rowSubsector, rowProduct, rowVariety, rowQuality, rowUnit, monthlyVolumes] = row;
      if (!Array.isArray(monthlyVolumes) || monthlyVolumes.length !== 12) return;
      if ((region !== allRegions && dimensions.regions[rowRegion] !== region)
        || (selectedMarkets.length > 0 && !selectedMarkets.includes(dimensions.markets[rowMarket]))
        || (subsector !== allSubsectors && dimensions.subsectors[rowSubsector] !== subsector)
        || dimensions.products[rowProduct] !== effectiveProduct
        || (effectiveVariety !== allVarieties && dimensions.varieties[rowVariety] !== effectiveVariety)
        || (effectiveQuality !== allQualities && dimensions.qualities[rowQuality] !== effectiveQuality)
        || dimensions.units[rowUnit] !== effectiveUnit) return;
      monthlyVolumes.forEach((volume, index) => { volumes[index] += volume; });
    });
    const maximum = Math.max(...volumes, 0);
    if (!maximum) return null;
    return {
      months: volumes.map((volume, index) => {
        const relativeVolume = volume / maximum;
        const category = relativeVolume < .15 ? 'Nula' : relativeVolume < .4 ? 'Escasa' : relativeVolume < .75 ? 'Media' : 'Alta';
        return { month: index + 1, label: monthLabels[index], volume, relativeVolume, category };
      }),
    };
  }, [seasonality, region, selectedMarkets, subsector, effectiveProduct, effectiveVariety, effectiveQuality, effectiveUnit]);
  const selectedSeason = productSeasonality?.months[seasonalityMonth - 1];

  const setQuickRange = (days?: number) => {
    if (!manifest) return;
    if (!days) { setFrom(manifest.min_data_date); setTo(manifest.max_data_date); return; }
    const start = parseDate(manifest.max_data_date);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    setFrom(isoDate(start) < manifest.min_data_date ? manifest.min_data_date : isoDate(start));
    setTo(manifest.max_data_date);
  };

  const resetFilters = () => {
    if (!manifest) return;
    setRegion(allRegions); setSelectedMarkets([]); setSubsector(allSubsectors); setProduct('');
    setVariety(allVarieties); setQuality(allQualities); setUnit(''); setQuickRange(365);
  };

  const generatedAt = manifest ? longDate.format(new Date(manifest.snapshot_generated_at)) : '—';
  const maxDataDate = manifest ? longDate.format(parseDate(manifest.max_data_date)) : '—';

  const handleContactSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!contactEmail) {
      setContactStatus('Vista local: el formulario está listo. Antes de publicar definiremos el correo de destino.');
      return;
    }
    const subject = `Solicitud AgroIndex · ${String(form.get('empresa') || form.get('nombre') || 'Contacto')}`;
    const body = [`Nombre: ${form.get('nombre')}`, `Empresa: ${form.get('empresa') || '—'}`, `Email: ${form.get('email')}`, '', String(form.get('solicitud'))].join('\n');
    window.location.href = `mailto:${contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setContactStatus('Abrimos tu correo para completar el envío.');
  };

  if (loadError) return <main className="state-page"><h1>No pudimos cargar el historial.</h1><p>La fuente quedó temporalmente indisponible. Intenta nuevamente.</p></main>;
  if (!manifest) return <main className="state-page"><span className="loader" /><h1>Preparando AgroIndex…</h1></main>;

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#inicio" aria-label="AgroIndex, inicio"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span className="brand-name"><em>AGRO</em><strong>Index</strong></span></a>
        <nav aria-label="Navegación principal"><a className="active" href="#evolucion">Evolución</a><a href="#mercados">Mercados</a><a href="#contacto">Contacto</a></nav>
      </header>

      <section className="hero" id="inicio">
        <div><p className="eyebrow">Índice de precios agrícolas · Chile</p><h1>Más información.<br /><em>Mejor decisión.</em></h1><p className="hero-copy">Información mayorista clara y comparable para entender la evolución de precios, volúmenes y tendencias en los principales mercados de Chile.</p></div>
        <div className="freshness-card"><span className="pulse" /><div><strong>Última actualización: {generatedAt}</strong><small>Última fecha de mercado disponible: {maxDataDate}</small></div></div>
        <svg className="hero-produce" viewBox="0 0 800 360" aria-hidden="true">
          <defs>
            <symbol id="sketch-corn" viewBox="0 0 100 150"><path d="M49 15c25 7 34 31 27 67-6 32-19 52-32 50-15-2-23-28-18-62 5-35 10-57 23-55Z"/><path d="M25 57C7 76 13 116 42 137M76 60c17 24 7 59-28 78M36 41l36 23M30 61l43 27M28 84l38 25M47 20l-18 85M62 31l-24 91"/></symbol>
            <symbol id="sketch-potato" viewBox="0 0 120 90"><path d="M22 18C39 4 82 6 103 25c17 16 9 42-12 54-22 13-61 8-76-10C1 52 4 33 22 18Z"/><path d="M36 30h1m42-3h1M57 50h1m31 10h1M27 62h1"/></symbol>
            <symbol id="sketch-onion" viewBox="0 0 100 120"><path d="M50 29C45 44 18 51 17 79c-1 25 19 35 33 35s35-10 33-35C81 52 55 44 50 29Z"/><path d="M50 29c-9-8-9-17-4-24m5 24c9-9 12-17 11-24M37 48c-7 19-7 47 9 64m17-64c8 19 7 47-9 64"/></symbol>
            <symbol id="sketch-watermelon" viewBox="0 0 140 100"><path d="M12 65C34 24 88 7 129 25c-15 39-76 69-117 40Z"/><path d="M12 65c43 13 95-7 117-40M45 56h1m22-10h1m23-12h1m1 21h1"/></symbol>
            <symbol id="sketch-carrot" viewBox="0 0 90 150"><path d="M23 48c17-6 34-5 49 2-8 32-21 63-43 91-6-35-8-66-6-93Z"/><path d="M43 45C32 29 33 15 38 5m10 40C47 27 54 14 64 7m-17 38C57 31 69 25 82 23M26 67l34 11M28 88l24 9"/></symbol>
            <symbol id="sketch-grapes" viewBox="0 0 110 140"><path d="M56 30c-2-15 6-23 19-25M57 28C42 11 27 14 18 21c15 9 26 11 39 7Z"/><circle cx="53" cy="43" r="14"/><circle cx="35" cy="57" r="14"/><circle cx="71" cy="59" r="14"/><circle cx="50" cy="75" r="14"/><circle cx="78" cy="86" r="14"/><circle cx="31" cy="86" r="14"/><circle cx="55" cy="104" r="14"/><circle cx="56" cy="129" r="10"/></symbol>
            <symbol id="sketch-tomato" viewBox="0 0 110 100"><path d="M55 27c28-11 47 11 43 37-4 25-24 32-43 32S16 88 12 64c-4-26 15-48 43-37Z"/><path d="M55 31 43 17m12 14 13-15m-13 15-20 2m20-2 20 3"/></symbol>
            <symbol id="sketch-lemon" viewBox="0 0 120 75"><path d="M11 37C24 6 84-4 108 26 94 61 38 81 11 37Z"/><path d="M20 43c25 18 62 7 79-14"/></symbol>
            <symbol id="sketch-apple" viewBox="0 0 100 110"><path d="M49 32c-17-12-38 1-39 27-1 24 20 48 40 45 21 4 42-20 40-45-2-26-23-39-41-27Z"/><path d="M50 31c-2-13 4-22 12-28m-9 17c12-9 25-7 32-1-12 8-22 8-32 1Z"/></symbol>
            <symbol id="sketch-avocado" viewBox="0 0 100 130"><path d="M50 9c-13 0-18 18-25 36C18 63 8 78 10 94c3 21 20 31 40 31s37-10 40-31c2-16-8-31-15-49C68 27 63 9 50 9Z"/><path d="M50 28c-9 0-13 13-19 29-5 14-13 26-11 38 2 14 14 21 30 21s28-7 30-21c2-12-6-24-11-38-6-16-10-29-19-29Z"/><circle cx="50" cy="86" r="17"/></symbol>
            <symbol id="sketch-celery" viewBox="0 0 100 140"><path d="M32 132c2-34 4-65 1-94m16 94c1-43 0-82 2-117m16 117c-1-39 2-72 8-102M24 132h54M33 39C20 31 12 19 14 8c14 1 25 12 19 31Zm18-21C40 13 35 6 38 1c10 0 18 7 13 17Zm23 14c-1-14 8-25 21-28 3 13-5 26-21 28ZM50 62c-12-10-20-9-29-5 5 13 17 17 29 5Zm18 16c11-12 21-13 30-8-5 14-18 20-30 8Z"/><path d="M32 132c12 5 24 5 35 0"/></symbol>
            <symbol id="sketch-chili" viewBox="0 0 130 80"><path d="M18 25c23 1 39-8 60-4 24 5 36 23 43 43-31-21-58-12-79-16-14-2-23-10-24-23Z"/><path d="M19 26C9 22 6 14 8 5m13 21c8 2 13-3 16-10"/></symbol>
            <symbol id="sketch-garlic" viewBox="0 0 100 100"><path d="M50 22c-5 13-28 17-33 42-4 21 13 31 33 31s37-10 33-31C78 39 55 35 50 22Z"/><path d="M50 22c-5-8-4-15 1-20m-1 29c-13 18-13 42-5 62m5-62c13 18 13 42 5 62M29 45c-7 15-5 35 5 44m37-44c7 15 5 35-5 44"/></symbol>
            <symbol id="sketch-strawberry" viewBox="0 0 100 105"><path d="M15 35c3 37 17 60 35 67 18-7 32-30 35-67-18-12-52-12-70 0Z"/><path d="M50 29C39 13 27 12 19 18c10 10 19 13 31 11Zm0 0C61 13 73 12 81 18c-10 10-19 13-31 11ZM50 28V7M34 48h1m30 0h1M27 66h1m22-4h1m22 4h1M39 82h1m21 0h1"/></symbol>
            <symbol id="sketch-lettuce" viewBox="0 0 110 100"><path d="M55 94C23 94 8 75 15 53c-8-17 7-31 24-27 5-20 27-21 35-4 18-7 31 10 24 26 13 19-8 46-43 46Z"/><path d="M55 88c-3-25-1-45 1-65M29 39c11 11 20 26 26 49m30-51C72 50 63 67 55 88M21 61c12 2 24 8 34 27m39-28C77 64 64 72 55 88"/></symbol>
            <symbol id="sketch-orange" viewBox="0 0 100 100"><circle cx="50" cy="55" r="40"/><path d="M50 15C54 5 64 1 75 5c-4 12-13 17-25 10Zm0 1C43 9 38 5 38 1"/><path d="M24 40c16-12 36-16 55-7"/></symbol>
            <symbol id="sketch-pepper" viewBox="0 0 100 110"><path d="M50 27c-4-14 3-23 13-26M50 26c-29-10-43 13-37 42 5 25 20 37 37 37s32-12 37-37c6-29-8-52-37-42Z"/><path d="M50 29c-12 14-14 45-7 73m7-73c12 14 14 45 7 73M22 37c11 6 19 6 28-8m28 8c-11 6-19 6-28-8"/></symbol>
            <symbol id="sketch-pineapple" viewBox="0 0 100 140"><path d="M21 57c5-23 53-23 58 0 5 36-8 74-29 77-21-3-34-41-29-77Z"/><path d="M50 42C38 27 34 14 36 2m14 40C48 23 54 9 64 1M50 42c9-14 22-22 34-23M50 42C39 31 25 26 14 28M27 61l46 50M21 82l32 43M73 61l-46 50M79 82l-32 43M24 68h52M21 91h58M27 114h46"/></symbol>
          </defs>
          <g className="produce-cluster produce-cluster-main">
            <use href="#sketch-chili" x="30" y="53" width="100" height="52" transform="rotate(-8 80 79)"/>
            <use href="#sketch-garlic" x="190" y="45" width="75" height="65"/>
            <use href="#sketch-celery" x="340" y="42" width="70" height="78"/>
            <use href="#sketch-onion" x="500" y="48" width="70" height="75"/>
            <use href="#sketch-corn" x="660" y="40" width="65" height="90" transform="rotate(8 693 85)"/>
            <use href="#sketch-strawberry" x="35" y="125" width="70" height="65"/>
            <use href="#sketch-lettuce" x="180" y="122" width="85" height="70"/>
            <use href="#sketch-lemon" x="330" y="135" width="95" height="58" transform="rotate(-9 378 164)"/>
            <use href="#sketch-orange" x="510" y="125" width="68" height="68"/>
            <use href="#sketch-avocado" x="670" y="120" width="62" height="80" transform="rotate(6 701 160)"/>
            <use href="#sketch-potato" x="25" y="215" width="100" height="70" transform="rotate(-8 75 250)"/>
            <use href="#sketch-pepper" x="190" y="205" width="80" height="80"/>
            <use href="#sketch-pineapple" x="350" y="198" width="65" height="90"/>
            <use href="#sketch-watermelon" x="495" y="220" width="105" height="60" transform="rotate(5 548 250)"/>
            <use href="#sketch-tomato" x="670" y="210" width="75" height="70"/>
            <use href="#sketch-carrot" x="30" y="285" width="55" height="75" transform="rotate(-10 58 323)"/>
            <use href="#sketch-grapes" x="180" y="280" width="65" height="80" transform="rotate(7 213 320)"/>
            <use href="#sketch-celery" x="330" y="292" width="45" height="60"/>
            <use href="#sketch-corn" x="500" y="275" width="55" height="82" transform="rotate(15 528 316)"/>
            <use href="#sketch-strawberry" x="665" y="287" width="65" height="60"/>
          </g>
        </svg>
      </section>

      <section className="dashboard" id="evolucion">
        <div className="filters" aria-label="Filtros del historial">
          <label>Producto<select value={effectiveProduct} onChange={(event) => { setProduct(event.target.value); setVariety(allVarieties); setQuality(allQualities); setUnit(''); }}>
            <option value="" disabled>Selecciona un producto</option>
            {productOptions.map((item) => <option key={item}>{item}</option>)}
          </select><small>{productOptions.length} productos disponibles</small></label>
          <label>Variedad<select value={effectiveVariety} onChange={(event) => { setVariety(event.target.value); setQuality(allQualities); setUnit(''); }}><option>{allVarieties}</option>{varietyOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Calidad<select value={effectiveQuality} onChange={(event) => { setQuality(event.target.value); setUnit(''); }}><option>{allQualities}</option>{qualityOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Unidad com.<select value={effectiveUnit} onChange={(event) => setUnit(event.target.value)}><option value="" disabled>Selecciona una unidad</option>{unitOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
          <div className="date-filter"><span>Rango de fechas</span><div><label><small>Fecha inicio</small><input type="date" min={manifest.min_data_date} max={to} value={from} onChange={(event) => setFrom(event.target.value)} /></label><label><small>Fecha fin</small><input type="date" min={from} max={manifest.max_data_date} value={to} onChange={(event) => setTo(event.target.value)} /></label></div></div>
          <button className="filter-search-button" type="button" onClick={() => setHasSearched(true)}>Buscar</button>
        </div>

        <div className="filter-tools" aria-label="Atajos de filtros">
          <div><span>Período rápido</span><button type="button" onClick={() => setQuickRange(7)}>7 días</button><button type="button" onClick={() => setQuickRange(30)}>30 días</button><button type="button" onClick={() => setQuickRange(90)}>90 días</button><button type="button" onClick={() => setQuickRange(180)}>180 días</button><button type="button" onClick={() => setQuickRange(365)}>1 año</button><button type="button" onClick={() => { const start = `${manifest.max_data_date.slice(0, 4)}-01-01`; setFrom(start); setTo(manifest.max_data_date); }}>Año actual</button></div>
          <button className="reset-button" type="button" onClick={() => { resetFilters(); setHasSearched(false); }}>Restablecer filtros</button>
        </div>

        {!hasSearched ? <div className="search-prompt"><strong>Selecciona los filtros y presiona Buscar</strong><span>Los indicadores y gráficos aparecerán aquí después de realizar una consulta.</span></div> : <>
        {!dataReady && <div className="data-loading"><span className="loader" /> Cargando {requiredYears.length === 1 ? requiredYears[0]?.year : `${requiredYears[0]?.year}–${requiredYears[requiredYears.length - 1]?.year}`}…</div>}
        {dataReady && !effectiveUnit && <div className="selection-prompt">Selecciona una unidad de comercialización para calcular precios y volúmenes sin mezclar formatos.</div>}
        <div className="section-heading decision-heading"><div><span className="produce-dot" /><div><div className="summary-label"><p className="eyebrow">Resumen de mercado</p><img className="summary-logo" src="/agroindex-logo-horizontal.svg" alt="AgroIndex" /></div><h2>{effectiveProduct || 'Sin producto'} {effectiveVariety} {effectiveQuality}, {effectiveUnit || 'pendiente'}</h2></div></div></div>
        {!effectiveUnit ? <section className="decision-onboarding"><span>01</span><div><p>Comienza con una unidad de comercialización</p><h3>El precio sólo es comparable dentro del mismo formato de venta.</h3><small>Elige caja, saco, malla u otra unidad para activar la referencia, el rango observado y los mercados comparables.</small></div></section> : <>
          <section className="decision-board" aria-label="Resumen para decisión de venta">
            <article className="price-reference"><p>Precio promedio ponderado al {latestPoint ? longDate.format(parseDate(latestPoint.date)) : 'último dato disponible'}</p><strong>{formatMetric(latestPoint?.average ?? Number.NaN, money)}</strong><div className={`kg-equivalent ${kgConversion ? '' : 'unavailable'}`}><span>{equivalentLabel(effectiveUnit)}</span><b>{formatEquivalentPrice(latestPoint?.average ?? Number.NaN, effectiveUnit, kgConversion)}</b></div></article>
            <div className="decision-secondary">
              <article className="decision-stat"><p>Rango observado hoy</p><strong className="range-values">{latestPoint ? <><span>Máximo: {money.format(latestPoint.maximum)}</span><span>Mínimo: {money.format(latestPoint.minimum)}</span></> : '—'}</strong><span>Precios en la unidad seleccionada</span></article>
              <article className="decision-stat"><p>Volumen informado</p><strong className="volume-values">{latestPoint ? <><span>{commercialVolumeLabel(latestPoint.volume, effectiveUnit).primary}</span>{commercialVolumeLabel(latestPoint.volume, effectiveUnit).secondary ? <span>{commercialVolumeLabel(latestPoint.volume, effectiveUnit).secondary}</span> : kgConversion ? <span>{number.format(latestPoint.volume * kgConversion.minKg)} kilos transados</span> : null}</> : '—'}</strong><span>Volumen informado el último día</span></article>
              <article className="decision-stat market-opportunity"><p>Mercado más cercano</p><strong>{nearestMarketToday ? nearestMarketToday.point.market : '—'}</strong><span>{nearestMarketToday ? `${Math.round(nearestMarketToday.distance)} kms distancia` : geoStatus === 'loading' ? 'Buscando ubicación…' : 'Selecciona una región o autoriza ubicación'}</span></article>
              <article className="decision-stat"><p>Actividad Registrada</p><strong>{activity.days} de {activity.calendarDays} días</strong><span>{activity.markets} mercados con operaciones</span></article>
            </div>
          </section>

        </>}

        <div className="variation-section">
          <div className="variation-heading"><div><p>Variaciones porcentuales</p><small className="variation-note">Cambio promedio del precio en los mercados que tienen datos para ambas fechas.</small></div></div>
          <div className="variation-grid">{variations.map((item) => <article className={Number.isFinite(item.value) && item.value < 0 ? 'negative' : ''} key={item.days}><span>{item.days} días</span><strong>{Number.isFinite(item.value) ? `${item.value >= 0 ? '+' : ''}${item.value.toFixed(1).replace('.', ',')}%` : '—'}</strong><small>{item.markets ? `${item.markets} mercados` : 'Sin dato comparable'}</small></article>)}</div>
        </div>

        {productSeasonality && <section className="seasonality-card" aria-label={`Estacionalidad de ${effectiveProduct}`}>
          <div className="seasonality-copy"><p className="eyebrow">Estacionalidad histórica</p><h3>¿Cuándo se transa más {effectiveProduct}?</h3><p>Promedio mensual del volumen transado informado entre {seasonality?.baseline_years[0]} y {seasonality?.baseline_years.at(-1)}, usando la selección actual de región, mercado, variedad, calidad y unidad. No representa la oferta total disponible.</p><div className="seasonality-current"><span className="season-dot" /><div><strong>{selectedSeason?.label}: {seasonDescription(selectedSeason?.category)}</strong><small>{selectedSeason ? `${Math.round(selectedSeason.relativeVolume * 100)}% del mes de mayor volumen histórico para esta selección` : ''}</small></div></div></div>
          <div className="seasonality-chart"><div className="season-bars" aria-label="Índice mensual de volumen transado histórico">{productSeasonality.months.map((item) => <button type="button" className={item.month === seasonalityMonth ? 'active' : ''} key={item.month} onClick={() => setSeasonalityMonth(item.month)}><span style={{ height: `${Math.max(8, item.relativeVolume * 100)}%` }} /><small>{item.label.slice(0, 3)}</small></button>)}</div></div>
        </section>}

        <article className="panel chart-panel">
          <div className="panel-title"><div><p>Evolución histórica</p><h3>Precio mínimo, promedio y máximo</h3></div></div>
          <PriceChart points={displayPoints} />
        </article>

        <article className="panel chart-panel">
          <div className="panel-title"><div><p>Actividad mayorista</p><h3>Volumen transado por día</h3></div></div>
          <VolumeChart points={displayPoints} unit={effectiveUnit} />
          <p className="chart-note">Suma del volumen informado para la región, mercado, serie comercial y rango seleccionados. Cada barra corresponde a una fecha reportada, excluye fines de semana.</p>
        </article>

        <article className="panel chart-panel" id="mercados">
          <div className="panel-title"><div><p>Comparación entre mercados</p><h3>Evolución del precio promedio por mercado</h3></div><span>{marketPoints.length} mercados</span></div>
          <MarketEvolutionChart points={marketDailyPoints} />
          <p className="chart-note">Cada línea usa el promedio ponderado diario del mercado, conservando región, producto, variedad, calidad y unidad seleccionadas.</p>
        </article>

        <article className="panel table-panel">
          <div className="panel-title"><div><p>Último dato disponible</p><h3>Comparación por mercado</h3></div><span>{marketPoints.length} mercados</span></div>
          <p className="comparison-note">Cada fila muestra el último día disponible de ese mercado dentro del rango. Selecciona una fila para enfocarlo en el resto del análisis.</p>
          <div className="table-scroll"><table><thead><tr><th>Mercado</th><th>Fecha</th><th>Volumen</th><th>Mínimo</th><th>Máximo</th><th>Promedio ponderado</th><th>Equiv. $/kg</th><th>Var. 7d</th><th>Var. 30d</th></tr></thead><tbody>{marketRows.map((row) => <tr className={selectedMarkets.includes(row.market) ? 'selected-row' : undefined} key={row.market}><td><button className="market-button" type="button" onClick={() => { setSelectedMarkets([row.market]); document.querySelector('#evolucion')?.scrollIntoView({ behavior: 'smooth' }); }}>{row.market}</button></td><td>{longDate.format(parseDate(row.date))}</td><td>{number.format(row.volume)}</td><td>{money.format(row.minimum)}</td><td>{money.format(row.maximum)}</td><td className="price-cell">{money.format(row.average)}</td><td className="kg-price-cell">{formatPricePerKg(row.average, kgConversion)}</td><td className={Number.isFinite(row.variation7) && row.variation7 < 0 ? 'negative-value' : 'positive-value'}>{Number.isFinite(row.variation7) ? `${row.variation7 >= 0 ? '+' : ''}${row.variation7.toFixed(1).replace('.', ',')}%` : 'No Data'}</td><td className={Number.isFinite(row.variation30) && row.variation30 < 0 ? 'negative-value' : 'positive-value'}>{Number.isFinite(row.variation30) ? `${row.variation30 >= 0 ? '+' : ''}${row.variation30.toFixed(1).replace('.', ',')}%` : 'No Data'}</td></tr>)}</tbody></table></div>
        </article>

        {effectiveUnit && originShares.length > 0 && <article className="panel origin-share-panel" aria-label="Procedencia del volumen transado">
          <div className="panel-title"><div><p>Procedencia del volumen</p><h3>Principales orígenes del volumen transado</h3></div><span>{originShares.length - (originShares.some((item) => item.other) ? 1 : 0)} principales</span></div>
          <p className="comparison-note">Participación del volumen informado para la selección actual.</p>
          <div className="origin-share-list">{originShares.map((item) => <div className={`origin-share-row${item.other ? ' other' : ''}`} key={item.origin}><div className="origin-share-label"><strong>{item.origin}</strong><span>{(item.share * 100).toFixed(1).replace('.', ',')}% · {number.format(Math.round(item.volume))}</span></div><div className="origin-share-track"><span style={{ width: `${Math.max(2, item.share * 100)}%` }} /></div></div>)}</div>
        </article>}

        <section className="contact-card" id="contacto">
          <div className="contact-copy"><p className="eyebrow">Contacto</p><p>Cuéntanos brevemente qué información necesitas y te responderemos a la brevedad.</p></div>
          <form className="contact-form" onSubmit={handleContactSubmit}>
            <label>Nombre<input name="nombre" type="text" autoComplete="name" required /></label>
            <label>Empresa<input name="empresa" type="text" autoComplete="organization" /></label>
            <label>Email<input name="email" type="email" autoComplete="email" required /></label>
            <label className="contact-request">Solicitud<textarea name="solicitud" rows={3} required /></label>
            <button type="submit">Enviar solicitud <span>→</span></button>
            {contactStatus && <p className="contact-status" role="status">{contactStatus}</p>}
          </form>
        </section>
        </>}
      </section>
    </main>
  );
}
