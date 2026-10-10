'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type CompactRow = [number, number, number, number, number, number, number, number, number, string, string, string, number];
type HistoricalSnapshot = {
  meta: {
    schema_version: 3;
    source_url: string;
    source_year: number;
    snapshot_generated_at: string;
    source_fetched_at: string;
    max_data_date: string;
    min_data_date: string;
    source_rows: number;
    aggregated_rows: number;
    source_file_sha256: string;
  };
  dates: string[]; regions: string[]; markets: string[]; subsectors: string[];
  products: string[]; varieties: string[]; qualities: string[]; units: string[];
  rows: CompactRow[];
};
type Manifest = {
  schema_version: 3;
  snapshot_generated_at: string;
  min_data_date: string;
  max_data_date: string;
  source_rows: number;
  aggregated_rows: number;
  dimension_counts: Record<'regions' | 'markets' | 'subsectors' | 'products' | 'varieties' | 'qualities' | 'units', number>;
  years: { year: number; file: string; min_data_date: string; max_data_date: string; source_rows: number; aggregated_rows: number }[];
};
type SnapshotRow = { snapshot: HistoricalSnapshot; row: CompactRow };
type DailyPoint = { date: string; volume: number; minimum: number; maximum: number; average: number; observations: number };
type MarketPoint = { market: string; date: string; volume: number; minimum: number; maximum: number; average: number; observations: number };
type MarketDailyPoint = MarketPoint;
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
const longDateTime = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago' });
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
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
function seasonDescription(category?: string) {
  if (category === 'Nula') return 'sin volumen informado';
  if (category === 'Escasa') return 'volumen bajo';
  if (category === 'Media') return 'volumen intermedio';
  return 'volumen alto';
}
function axisLabel(date: string, spanDays: number) {
  const value = parseDate(date);
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
      context.font = '11px Inter, system-ui, sans-serif'; context.fillStyle = '#91a8ad'; context.strokeStyle = '#25414a'; context.lineWidth = 1;
      for (let tick = 0; tick <= 4; tick += 1) { const value = yMin + (yMax - yMin) * tick / 4; const yy = y(value); context.beginPath(); context.moveTo(margin.left, yy); context.lineTo(width - margin.right, yy); context.stroke(); context.textAlign = 'right'; context.fillText(money.format(value), margin.left - 10, yy + 4); }
      const labelCount = Math.min(6, points.length);
      for (let tick = 0; tick < labelCount; tick += 1) { const index = Math.round(tick * (points.length - 1) / Math.max(labelCount - 1, 1)); context.textAlign = tick === 0 ? 'left' : tick === labelCount - 1 ? 'right' : 'center'; context.fillText(axisLabel(points[index].date, spanDays), x(index), height - 14); }
      if (visible.minimum && visible.maximum) { context.beginPath(); points.forEach((point, index) => index ? context.lineTo(x(index), y(point.maximum)) : context.moveTo(x(index), y(point.maximum))); for (let index = points.length - 1; index >= 0; index -= 1) context.lineTo(x(index), y(points[index].minimum)); context.closePath(); context.fillStyle = 'rgba(53,194,173,.13)'; context.fill(); }
      const line = (field: 'minimum' | 'average' | 'maximum', color: string, widthValue: number, dash: number[] = []) => { if (!visible[field]) return; context.beginPath(); context.strokeStyle = color; context.lineWidth = widthValue; context.setLineDash(dash); points.forEach((point, index) => index ? context.lineTo(x(index), y(point[field])) : context.moveTo(x(index), y(point[field]))); context.stroke(); context.setLineDash([]); };
      line('minimum', '#ff936c', 1.5, [5, 4]); line('maximum', '#77a8d7', 1.5, [5, 4]); line('average', '#35c2ad', 3);
      if (hovered !== null) { const xx = x(hovered); context.strokeStyle = '#d4f36a80'; context.setLineDash([3, 3]); context.beginPath(); context.moveTo(xx, margin.top); context.lineTo(xx, margin.top + chartHeight); context.stroke(); context.setLineDash([]); }
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
      context.font = '11px Inter, system-ui, sans-serif'; context.fillStyle = '#91a8ad'; context.strokeStyle = '#25414a';
      for (let tick = 0; tick <= 4; tick += 1) {
        const value = maximum * tick / 4; const yy = y(value);
        context.beginPath(); context.moveTo(margin.left, yy); context.lineTo(width - margin.right, yy); context.stroke();
        context.textAlign = 'right'; context.fillText(number.format(Math.round(value)), margin.left - 10, yy + 4);
      }
      const barWidth = Math.max(2, Math.min(18, chartWidth / Math.max(points.length, 1) * .68));
      context.fillStyle = 'rgba(53,194,173,.68)';
      points.forEach((point, index) => context.fillRect(x(index) - barWidth / 2, y(point.volume), barWidth, margin.top + chartHeight - y(point.volume)));
      if (trend.length > 1) { context.beginPath(); context.strokeStyle = '#d4f36a'; context.lineWidth = 2.5; context.lineJoin = 'round'; context.lineCap = 'round'; trend.forEach((value, index) => index ? context.lineTo(x(index), y(value)) : context.moveTo(x(index), y(value))); context.stroke(); }
      const labelCount = Math.min(5, points.length);
      for (let tick = 0; tick < labelCount; tick += 1) {
        const index = Math.round(tick * (points.length - 1) / Math.max(labelCount - 1, 1));
        context.textAlign = tick === 0 ? 'left' : tick === labelCount - 1 ? 'right' : 'center';
        context.fillText(axisLabel(points[index].date, spanDays), x(index), height - 14);
      }
      if (hovered !== null) { const xx = x(hovered); context.strokeStyle = '#d4f36a80'; context.setLineDash([3, 3]); context.beginPath(); context.moveTo(xx, margin.top); context.lineTo(xx, margin.top + chartHeight); context.stroke(); context.setLineDash([]); }
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
      context.font = '11px Inter, system-ui, sans-serif'; context.fillStyle = '#91a8ad'; context.strokeStyle = '#25414a';
      for (let tick = 0; tick <= 4; tick += 1) {
        const price = yMin + (yMax - yMin) * tick / 4; const yy = y(price);
        context.beginPath(); context.moveTo(margin.left, yy); context.lineTo(width - margin.right, yy); context.stroke();
        context.textAlign = 'right'; context.fillText(money.format(price), margin.left - 10, yy + 4);
      }
      const labelCount = Math.min(5, dates.length);
      for (let tick = 0; tick < labelCount; tick += 1) {
        const index = Math.round(tick * (dates.length - 1) / Math.max(labelCount - 1, 1));
        context.textAlign = tick === 0 ? 'left' : tick === labelCount - 1 ? 'right' : 'center'; context.fillText(axisLabel(dates[index], spanDays), x(dates[index]), height - 14);
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

  useEffect(() => {
    fetch(`${basePath}/data/manifest.json`)
      .then(async (response) => { if (!response.ok) throw new Error('No se pudo cargar el manifiesto'); return await response.json() as Manifest; })
      .then((data) => {
        if (data.schema_version !== 3) throw new Error('Versión de datos incompatible');
        setManifest(data);
        const initialStart = parseDate(data.max_data_date);
        initialStart.setUTCDate(initialStart.getUTCDate() - 89);
        setFrom(isoDate(initialStart) < data.min_data_date ? data.min_data_date : isoDate(initialStart));
        setTo(data.max_data_date);
      })
      .catch(() => setLoadError(true));
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
      fetch(`${basePath}/data/${item.file}`)
        .then(async (response) => { if (!response.ok) throw new Error(`No se pudo cargar ${item.year}`); return await response.json() as HistoricalSnapshot; })
        .then((data) => {
          if (data.meta.schema_version !== 3) throw new Error('Versión anual incompatible');
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
  const effectiveProduct = productOptions.includes(product) ? product : (productOptions[0] ?? '');
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
  const activity = useMemo(() => {
    const start = from ? parseDate(from) : undefined; const end = to ? parseDate(to) : undefined;
    const calendarDays = start && end ? Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1) : dailyPoints.length;
    const markets = new Set(series.rows.map(({ snapshot, row }) => snapshot.markets[row[2]])).size;
    return { days: dailyPoints.length, calendarDays, markets };
  }, [dailyPoints, series.rows, from, to]);
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
    setVariety(allVarieties); setQuality(allQualities); setUnit(''); setQuickRange(90);
  };

  const generatedAt = manifest ? longDateTime.format(new Date(manifest.snapshot_generated_at)) : '—';
  const maxDataDate = manifest ? longDate.format(parseDate(manifest.max_data_date)) : '—';
  const latestSnapshot = manifest ? snapshots[manifest.years[manifest.years.length - 1].year] : undefined;

  if (loadError) return <main className="state-page"><h1>No pudimos cargar el historial.</h1><p>La fuente quedó temporalmente indisponible. Intenta nuevamente.</p></main>;
  if (!manifest) return <main className="state-page"><span className="loader" /><h1>Cargando datos ODEPA…</h1></main>;

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#inicio" aria-label="AgroIndex, inicio"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span className="brand-name"><em>AGRO</em><strong>Index</strong></span></a>
        <nav aria-label="Navegación principal"><a className="active" href="#evolucion">Evolución</a><a href="#mercados">Mercados</a><a href="#fuente">Fuente</a></nav>
        <span className="official-badge"><i /> Fuente oficial ODEPA</span>
      </header>

      <section className="hero" id="inicio">
        <div><p className="eyebrow">Índice de precios agrícolas · Chile</p><h1>Por la transparencia<br /><em>de precios.</em></h1><p className="hero-copy">Información mayorista clara y comparable para entender la evolución de precios, volúmenes y tendencias en los principales mercados de Chile.</p></div>
        <div className="freshness-card"><span className="pulse" /><div><strong>Snapshot actualizado: {generatedAt}</strong><small>Última fecha de mercado disponible: {maxDataDate}</small></div></div>
      </section>

      <section className="dashboard" id="evolucion">
        <div className="filters" aria-label="Filtros del historial">
          <label>Región<select value={region} onChange={(event) => { setRegion(event.target.value); setSelectedMarkets([]); setSubsector(allSubsectors); setVariety(allVarieties); setQuality(allQualities); setUnit(''); }}><option>{allRegions}</option>{regionOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
          <details className="market-filter"><summary><span>Mercados</span><strong>{selectedMarkets.length === 0 ? 'Todos los mercados' : `${selectedMarkets.length} seleccionados`}</strong></summary><div className="market-checklist"><button type="button" className="market-all" onClick={() => { setSelectedMarkets([]); setSubsector(allSubsectors); setVariety(allVarieties); setQuality(allQualities); setUnit(''); }}>Todos los mercados</button>{marketOptions.map((item) => <label key={item}><input type="checkbox" checked={selectedMarkets.includes(item)} onChange={() => { setSelectedMarkets((current) => current.includes(item) ? current.filter((marketName) => marketName !== item) : [...current, item]); setSubsector(allSubsectors); setVariety(allVarieties); setQuality(allQualities); setUnit(''); }} />{item}</label>)}</div></details>
          <label>Subsector<select value={subsector} onChange={(event) => { setSubsector(event.target.value); setVariety(allVarieties); setQuality(allQualities); setUnit(''); }}><option>{allSubsectors}</option>{subsectorOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Producto<select value={effectiveProduct} onChange={(event) => { setProduct(event.target.value); setVariety(allVarieties); setQuality(allQualities); setUnit(''); }}>
            {productOptions.map((item) => <option key={item}>{item}</option>)}
          </select><small>{productOptions.length} productos disponibles</small></label>
          <label>Variedad<select value={effectiveVariety} onChange={(event) => { setVariety(event.target.value); setQuality(allQualities); setUnit(''); }}><option>{allVarieties}</option>{varietyOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Calidad<select value={effectiveQuality} onChange={(event) => { setQuality(event.target.value); setUnit(''); }}><option>{allQualities}</option>{qualityOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Unidad com.<select value={effectiveUnit} onChange={(event) => setUnit(event.target.value)}><option value="" disabled>Selecciona una unidad</option>{unitOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
          <div className="date-filter"><span>Rango de fechas</span><div><label><small>Fecha inicio</small><input type="date" min={manifest.min_data_date} max={to} value={from} onChange={(event) => setFrom(event.target.value)} /></label><label><small>Fecha fin</small><input type="date" min={from} max={manifest.max_data_date} value={to} onChange={(event) => setTo(event.target.value)} /></label></div></div>
        </div>

        <label className="representative-toggle"><input type="checkbox" checked={representativeOnly} onChange={(event) => { setRepresentativeOnly(event.target.checked); setVariety(allVarieties); setQuality(allQualities); setUnit(''); }} /><span><strong>Mostrar sólo series con cobertura suficiente</strong><small>Al menos {MINIMUM_REPRESENTATIVE_DAYS} días con reporte en la evidencia anual cargada; no se cuentan filas duplicadas como nuevas observaciones.</small></span></label>

        <div className="filter-tools" aria-label="Atajos de filtros">
          <div><span>Período rápido</span><button type="button" onClick={() => setQuickRange(7)}>7 días</button><button type="button" onClick={() => setQuickRange(30)}>30 días</button><button type="button" onClick={() => setQuickRange(90)}>90 días</button><button type="button" onClick={() => setQuickRange(180)}>180 días</button><button type="button" onClick={() => setQuickRange(365)}>1 año</button><button type="button" onClick={() => { const start = `${manifest.max_data_date.slice(0, 4)}-01-01`; setFrom(start); setTo(manifest.max_data_date); }}>Año actual</button></div>
          <button className="reset-button" type="button" onClick={resetFilters}>Restablecer filtros</button>
        </div>

        {!dataReady && <div className="data-loading"><span className="loader" /> Cargando {requiredYears.length === 1 ? requiredYears[0]?.year : `${requiredYears[0]?.year}–${requiredYears[requiredYears.length - 1]?.year}`}…</div>}
        {dataReady && !effectiveUnit && <div className="selection-prompt">Selecciona una unidad de comercialización para calcular precios y volúmenes sin mezclar formatos.</div>}
        <div className="section-heading decision-heading"><div><span className="produce-dot" /><div><p className="eyebrow">Lectura de venta</p><h2>{effectiveProduct || 'Sin producto'}</h2></div><span className="unit-pill">{effectiveVariety}</span><span className="unit-pill">{effectiveQuality}</span><span className="unit-pill">{effectiveUnit || 'Unidad pendiente'}</span></div><p>{marketLabel} · {region}<br />{latestPoint ? `Último registro: ${longDate.format(parseDate(latestPoint.date))}` : 'Sin datos para la selección'}</p></div>
        {!effectiveUnit ? <section className="decision-onboarding"><span>01</span><div><p>Comienza con una unidad de comercialización</p><h3>El precio sólo es comparable dentro del mismo formato de venta.</h3><small>Elige caja, saco, malla u otra unidad para activar la referencia, el rango observado y los mercados comparables.</small></div></section> : <>
          <section className="decision-board" aria-label="Resumen para decisión de venta">
            <article className="price-reference"><p>Referencia de precio hoy</p><strong>{formatMetric(latestPoint?.average ?? Number.NaN, money)}</strong><span>Promedio ponderado por volumen</span><small>{latestPoint ? `Último dato disponible: ${longDate.format(parseDate(latestPoint.date))}` : 'Sin datos para la combinación seleccionada'}</small></article>
            <article className="decision-stat"><p>Rango observado hoy</p><strong>{latestPoint ? `${money.format(latestPoint.minimum)} – ${money.format(latestPoint.maximum)}` : '—'}</strong><span>Mínimo y máximo informados</span></article>
            <article className="decision-stat"><p>Volumen informado</p><strong>{latestPoint ? number.format(latestPoint.volume) : '—'}</strong><span>Unidades transadas el último día</span></article>
            <article className="decision-stat market-opportunity"><p>Mercado más cercano</p><strong>{nearestMarketToday ? money.format(nearestMarketToday.point.average) : '—'}</strong><span>{nearestMarketToday ? `${nearestMarketToday.point.market} · ${Math.round(nearestMarketToday.distance)} km` : geoStatus === 'loading' ? 'Buscando ubicación…' : 'Selecciona una región o autoriza ubicación'}</span></article>
          </section>

          <section className="market-reading strong" aria-label="Actividad registrada">
            <div className="confidence-label"><span className="confidence-dot" /><div><strong>Actividad registrada</strong><small>{activity.days} de {activity.calendarDays} días con precio informado · {activity.markets} mercados con operaciones</small></div></div>
            <p>La disponibilidad varía según mercado, formato de venta y estacionalidad. Úsala como contexto de la lectura de precios, no como una medida de calidad de los datos.</p>
          </section>
        </>}

        {productSeasonality && <section className="seasonality-card" aria-label={`Estacionalidad de ${effectiveProduct}`}>
          <div className="seasonality-copy"><p className="eyebrow">Estacionalidad histórica</p><h3>¿Cuándo se transa más {effectiveProduct}?</h3><p>Promedio mensual del volumen transado informado por ODEPA entre {seasonality?.baseline_years[0]} y {seasonality?.baseline_years.at(-1)}, usando la selección actual de región, mercado, variedad, calidad y unidad. No representa la oferta total disponible.</p><div className="seasonality-current"><span className="season-dot" /><div><strong>{selectedSeason?.label}: {seasonDescription(selectedSeason?.category)}</strong><small>{selectedSeason ? `${Math.round(selectedSeason.relativeVolume * 100)}% del mes de mayor volumen histórico para esta selección` : ''}</small></div></div></div>
          <div className="seasonality-chart"><label>Consultar mes<select value={seasonalityMonth} onChange={(event) => setSeasonalityMonth(Number(event.target.value))}>{productSeasonality.months.map((item) => <option key={item.month} value={item.month}>{item.label}</option>)}</select></label><div className="season-bars" aria-label="Índice mensual de volumen transado histórico">{productSeasonality.months.map((item) => <button type="button" className={item.month === seasonalityMonth ? 'active' : ''} key={item.month} title={`${item.label}: ${number.format(item.volume)} unidades promedio`} onClick={() => setSeasonalityMonth(item.month)}><span style={{ height: `${Math.max(8, item.relativeVolume * 100)}%` }} /><small>{item.label.slice(0, 3)}</small></button>)}</div></div>
        </section>}

        <div className="variation-section">
          <div className="variation-heading"><div><p>Variaciones porcentuales</p><h3>Índice de precio por mercado</h3></div><span>Canasta fija · evita el efecto de mezcla por volumen</span></div>
          <div className="variation-grid">{variations.map((item) => <article className={Number.isFinite(item.value) && item.value < 0 ? 'negative' : ''} key={item.days}><span>{item.days} días</span><strong>{Number.isFinite(item.value) ? `${item.value >= 0 ? '+' : ''}${item.value.toFixed(1).replace('.', ',')}%` : '—'}</strong><small>{item.markets ? `Canasta fija · ${item.markets} mercados` : 'Sin dato comparable'}</small></article>)}</div>
        </div>

        <article className="panel chart-panel">
          <div className="panel-title"><div><p>Evolución histórica</p><h3>Precio mínimo, promedio y máximo</h3></div></div>
          <PriceChart points={displayPoints} />
          <p className="chart-note">El promedio se pondera por el volumen informado. La banda representa el rango mínimo–máximo. Cada fecha reportada ocupa un lugar consecutivo: no se reservan espacios para fines de semana ni días sin publicación. En consultas superiores a dos años, el gráfico agrupa por mes.</p>
        </article>

        <article className="panel chart-panel">
          <div className="panel-title"><div><p>Actividad mayorista</p><h3>Volumen transado por día</h3></div></div>
          <VolumeChart points={displayPoints} unit={effectiveUnit} />
          <p className="chart-note">Suma del volumen informado por ODEPA para la región, mercado, serie comercial y rango seleccionados. Cada barra corresponde a una fecha reportada, sin huecos por fines de semana; en períodos extensos se agrupa por mes.</p>
        </article>

        <article className="panel chart-panel" id="mercados">
          <div className="panel-title"><div><p>Comparación entre mercados</p><h3>Evolución del precio promedio por mercado</h3></div><span>{marketPoints.length} mercados</span></div>
          <MarketEvolutionChart points={marketDailyPoints} />
          <p className="chart-note">Cada línea usa el promedio ponderado diario del mercado, conservando región, producto, variedad, calidad y unidad seleccionadas.</p>
        </article>

        <article className="panel table-panel">
          <div className="panel-title"><div><p>Último dato disponible</p><h3>Comparación por mercado</h3></div><span>{marketPoints.length} mercados</span></div>
          <p className="comparison-note">Cada fila muestra el último día disponible de ese mercado dentro del rango. Selecciona una fila para enfocarlo en el resto del análisis.</p>
          <div className="table-scroll"><table><thead><tr><th>Mercado</th><th>Fecha</th><th>Volumen</th><th>Mínimo</th><th>Máximo</th><th>Promedio ponderado</th><th>Var. 7d</th><th>Var. 30d</th></tr></thead><tbody>{marketRows.map((row) => <tr className={selectedMarkets.includes(row.market) ? 'selected-row' : undefined} key={row.market}><td><button className="market-button" type="button" onClick={() => { setSelectedMarkets([row.market]); document.querySelector('#evolucion')?.scrollIntoView({ behavior: 'smooth' }); }}>{row.market}</button></td><td>{longDate.format(parseDate(row.date))}</td><td>{number.format(row.volume)}</td><td>{money.format(row.minimum)}</td><td>{money.format(row.maximum)}</td><td className="price-cell">{money.format(row.average)}</td><td className={Number.isFinite(row.variation7) && row.variation7 < 0 ? 'negative-value' : 'positive-value'}>{Number.isFinite(row.variation7) ? `${row.variation7 >= 0 ? '+' : ''}${row.variation7.toFixed(1).replace('.', ',')}%` : 'No Data'}</td><td className={Number.isFinite(row.variation30) && row.variation30 < 0 ? 'negative-value' : 'positive-value'}>{Number.isFinite(row.variation30) ? `${row.variation30 >= 0 ? '+' : ''}${row.variation30.toFixed(1).replace('.', ',')}%` : 'No Data'}</td></tr>)}</tbody></table></div>
        </article>

        <aside className="source-card" id="fuente"><div><p className="eyebrow">Trazabilidad de datos</p><h3>{number.format(manifest.source_rows)} filas públicas verificadas · 2016–2026</h3></div>{latestSnapshot && <a href={latestSnapshot.meta.source_url} target="_blank" rel="noreferrer">Abrir CSV oficial 2026 ↗</a>}</aside>
      </section>
    </main>
  );
}
