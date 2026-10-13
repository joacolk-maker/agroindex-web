export type KgConversion = {
  minKg: number;
  maxKg: number;
  source: 'declared' | 'odepa-factor';
  detail: string;
};

// Factores publicados por ODEPA en el anexo "Volúmenes y precios de frutas y
// hortalizas en mercados mayoristas de Chile, 2023". Sólo se aplican cuando la
// unidad comercial informa una cantidad de unidades, atados, matas o paquetes.
// https://bibliotecadigital.odepa.gob.cl/bitstream/handle/20.500.12650/73543/Art_VolumenesPreciosMercadosMayoristas.pdf
const odepaKgPerUnit: Record<string, number> = {
  Acelga: 1.3,
  Achicoria: 0.6,
  Ajo: 0.06,
  Albahaca: 1,
  Alcachofa: 0.15,
  Apio: 1.6,
  Berenjena: 0.25,
  Betarraga: 0.2,
  'Brócoli': 0.35,
  Cebolla: 0.25,
  Cebollín: 0.07,
  'Cebollín baby': 1.5,
  Ciboulette: 0.05,
  Cilantro: 1,
  Choclo: 0.28,
  Coco: 1,
  Coliflor: 0.65,
  Espinaca: 1,
  Lechuga: 0.5,
  Melón: 1,
  Orégano: 0.4,
  'Pepino ensalada': 0.35,
  Perejil: 1,
  Pimiento: 0.25,
  Piña: 1.5,
  Puerro: 0.3,
  Rabanito: 0.02,
  Repollo: 1.3,
  Sandia: 7,
  Zanahoria: 0.15,
  Zapallo: 7,
  'Zapallo italiano': 0.4,
};

function decimal(value: string) {
  return Number(value.replace(',', '.'));
}

function countedUnits(unit: string) {
  if (unit.includes('media docena')) return 6;
  if (unit.includes('docena')) return 12;
  if (unit.includes('cien unidades')) return 100;
  const count = unit.match(/(\d+)\s+(?:unidades|atados|matas|paquetes)/);
  if (count) return Number(count[1]);
  if (/^\$\/unidad(?:\s|$)/.test(unit)) return 1;
  return null;
}

export function getKgConversion(product: string, commercialUnit: string): KgConversion | null {
  const unit = commercialUnit.trim().toLocaleLowerCase('es-CL');
  if (!unit) return null;

  // El precio ya está expresado por kilo, aunque el volumen pueda venir en unidades.
  if (/^\$\/kilo(?:\s|$)/.test(unit)) {
    return { minKg: 1, maxKg: 1, source: 'declared', detail: 'La unidad original ya está expresada por kilo.' };
  }

  const canastillos = unit.match(/(\d+)\s+canastillos?\s+(\d+(?:[.,]\d+)?)\s+gramos?/);
  if (canastillos) {
    const kilograms = Number(canastillos[1]) * decimal(canastillos[2]) / 1000;
    return { minKg: kilograms, maxKg: kilograms, source: 'declared', detail: `${kilograms.toLocaleString('es-CL')} kg declarados por unidad comercial.` };
  }

  const kilogramRange = unit.match(/(\d+(?:[.,]\d+)?)\s+a\s+(\d+(?:[.,]\d+)?)\s+kilos?/);
  if (kilogramRange) {
    const minKg = decimal(kilogramRange[1]); const maxKg = decimal(kilogramRange[2]);
    return { minKg, maxKg, source: 'declared', detail: `Peso declarado por ODEPA: ${minKg.toLocaleString('es-CL')}–${maxKg.toLocaleString('es-CL')} kg.` };
  }

  const gramRange = unit.match(/(\d+(?:[.,]\d+)?)\s+a\s+(\d+(?:[.,]\d+)?)\s+gramos?/);
  if (gramRange) {
    const minKg = decimal(gramRange[1]) / 1000; const maxKg = decimal(gramRange[2]) / 1000;
    return { minKg, maxKg, source: 'declared', detail: `Peso declarado por ODEPA: ${gramRange[1]}–${gramRange[2]} gramos.` };
  }

  const kilograms = unit.match(/(\d+(?:[.,]\d+)?)\s+kilos?/);
  if (kilograms) {
    const value = decimal(kilograms[1]);
    return { minKg: value, maxKg: value, source: 'declared', detail: `${value.toLocaleString('es-CL')} kg declarados por unidad comercial.` };
  }

  const grams = unit.match(/(\d+(?:[.,]\d+)?)\s+gramos?/);
  if (grams) {
    const value = decimal(grams[1]) / 1000;
    return { minKg: value, maxKg: value, source: 'declared', detail: `${grams[1]} gramos declarados por unidad comercial.` };
  }

  const count = countedUnits(unit);
  const kgPerUnit = odepaKgPerUnit[product];
  if (!count || !kgPerUnit) return null;
  const totalKg = count * kgPerUnit;
  return {
    minKg: totalKg,
    maxKg: totalKg,
    source: 'odepa-factor',
    detail: `Estimación ODEPA: ${count} × ${kgPerUnit.toLocaleString('es-CL')} kg = ${totalKg.toLocaleString('es-CL')} kg.`,
  };
}

export function pricePerKgRange(price: number, conversion: KgConversion) {
  return {
    minimum: price / conversion.maxKg,
    maximum: price / conversion.minKg,
  };
}
