export const HORIZONS = [48, 24, 16, 8, 4, 2];
export function normalizeFlight(value) { return String(value).trim().toUpperCase().replace(/[\s-]/g, ''); }
export function pointAt(flight, horizon) { return flight.points.find(p => p.horizon === horizon) ?? null; }
export function percent(probability) {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error('Invalid probability');
  return (probability * 100).toFixed(1);
}
export function availablePoint(point) { return point?.status === 'available' && Number.isFinite(point.probability) && point.probability >= 0 && point.probability <= 1; }
export function validatePrediction(data) {
  const f = data?.flight;
  if (data?.source !== 'live_kma_kac' || !['available','pending'].includes(data.status) || !f?.flight || !f?.scheduled_at || !Array.isArray(f.points) || f.points.length !== 6) throw new Error('Invalid live response');
  if (new Set(f.points.map(p => p.horizon)).size !== 6 || HORIZONS.some(h => !pointAt(f,h))) throw new Error('Invalid horizons');
  for (const p of f.points) {
    if (!p.input_at || !['available','unavailable'].includes(p.status)) throw new Error('Invalid point');
    if (p.status === 'available') {
      percent(p.probability);
      if (!p.weather || !['observation','forecast'].includes(p.source)) throw new Error('Missing source');
    } else if (p.probability !== null) throw new Error('Unavailable point has a score');
  }
  return data;
}
