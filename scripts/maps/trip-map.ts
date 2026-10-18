/**
 * Mapa del viaje — `node scripts/maps/trip-map.ts <archivo.trip.json>`
 *
 * Dibuja el contorno del país (y de los vecinos, en claro) con los datos de
 * Natural Earth (dominio público) y lo guarda en `payload.map` como trazos SVG
 * ya proyectados. La app pone encima las estancias y la ruta, que salen de las
 * coordenadas del propio archivo. Así el mapa funciona sin red y pesa unos
 * pocos kB.
 *
 * Proyección: lineal en longitud y latitud, con la anchura corregida por el
 * coseno de la latitud media. Para un país cerca del ecuador es más que
 * suficiente, y la app usa la misma fórmula para colocar las estancias.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson';

type Ring = [number, number][];

interface TripMap {
  bounds: [number, number, number, number];
  width: number;
  height: number;
  land: string;
  neighbours: string;
}

const file = process.argv[2];
if (!file) {
  console.error('uso: node scripts/maps/trip-map.ts <archivo.trip.json> [país] [vecinos,separados,por,comas]');
  process.exit(1);
}
const country = process.argv[3] ?? 'Thailand';
const neighbours = (process.argv[4] ?? 'Myanmar,Laos,Cambodia,Vietnam,Malaysia').split(',');

const trip = JSON.parse(readFileSync(file, 'utf8'));
const payload = trip.payload;

/**
 * Dónde está una estancia: las coordenadas de su hotel o, si no las tiene, el
 * centro de los sitios de su zona. La app hace lo mismo al colocarla.
 */
function stayCoords(stay: { place?: string; area?: string }): [number, number] | null {
  const own = stay.place && payload.places[stay.place]?.coords;
  if (Array.isArray(own)) return own as [number, number];
  const around = (Object.values(payload.places) as { area?: string; coords?: [number, number] | null }[])
    .filter((p) => stay.area && p.area === stay.area && Array.isArray(p.coords))
    .map((p) => p.coords as [number, number]);
  if (!around.length) return null;
  return [around.reduce((a, c) => a + c[0], 0) / around.length, around.reduce((a, c) => a + c[1], 0) / around.length];
}

// Los límites salen de las estancias, con margen; así el mapa se centra en el viaje y no en el país.
const coords: [number, number][] = payload.stays
  .map(stayCoords)
  .filter((c: unknown): c is [number, number] => Array.isArray(c));
if (!coords.length) throw new Error('ninguna estancia tiene coordenadas');
const pad = 1.0;
let s = Math.min(...coords.map((c) => c[0])) - pad;
let n = Math.max(...coords.map((c) => c[0])) + pad;
let w = Math.min(...coords.map((c) => c[1])) - pad;
let e = Math.max(...coords.map((c) => c[1])) + pad;
// Un mapa de viaje queda bien entre algo más alto que ancho y el doble de alto: se estira el lado corto.
const kx = Math.cos((((s + n) / 2) * Math.PI) / 180);
const ratio = (n - s) / ((e - w) * kx);
if (ratio < 1.25) {
  const extra = ((e - w) * kx * 1.25 - (n - s)) / 2;
  s -= extra;
  n += extra;
} else if (ratio > 1.7) {
  const extra = ((n - s) / 1.7 / kx - (e - w)) / 2;
  w -= extra;
  e += extra;
}

const W = 1000;
const H = Math.round((W * (n - s)) / ((e - w) * kx));
const project = ([lon, lat]: [number, number]): [number, number] => [
  ((lon - w) / (e - w)) * W,
  ((n - lat) / (n - s)) * H,
];

const cache = join(tmpdir(), 'ne_50m_admin_0_countries.geojson');
if (!existsSync(cache)) {
  console.log('descargando Natural Earth…');
  const res = await fetch(NE_URL);
  if (!res.ok) throw new Error(`Natural Earth: ${res.status}`);
  mkdirSync(tmpdir(), { recursive: true });
  writeFileSync(cache, await res.text());
}
const ne = JSON.parse(readFileSync(cache, 'utf8'));

function ringsOf(name: string): Ring[] {
  const f = ne.features.find((x: { properties: { NAME: string } }) => x.properties.NAME === name);
  if (!f) throw new Error(`no está ${name} en Natural Earth`);
  const g = f.geometry;
  const polys: Ring[][] = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  return polys.map((p) => p[0] as Ring); // sólo el anillo exterior; los lagos no se ven a esta escala
}

/** Douglas-Peucker sobre coordenadas ya proyectadas. */
function simplify(points: [number, number][], tolerance: number): [number, number][] {
  if (points.length < 3) return points;
  const [a, b] = [points[0], points[points.length - 1]];
  let index = 0;
  let max = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = distance(points[i], a, b);
    if (d > max) {
      max = d;
      index = i;
    }
  }
  if (max <= tolerance) return [a, b];
  return [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(points.slice(index), tolerance)];
}
function distance(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (!dx && !dy) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Un trazo SVG por anillo, recortado a la caja: lo que queda fuera se pega al borde. */
function pathOf(names: string[], tolerance: number): string {
  const parts: string[] = [];
  for (const name of names) {
    for (const ring of ringsOf(name)) {
      const inside = ring.some(([lon, lat]) => lon > w && lon < e && lat > s && lat < n);
      if (!inside) continue;
      const pts = simplify(
        ring.map(project).map(([x, y]) => [Math.max(-20, Math.min(W + 20, x)), Math.max(-20, Math.min(H + 20, y))]),
        tolerance,
      );
      parts.push('M' + pts.map(([x, y]) => `${x.toFixed(0)} ${y.toFixed(0)}`).join('L') + 'Z');
    }
  }
  return parts.join('');
}

const map: TripMap = {
  bounds: [s, w, n, e].map((v) => Number(v.toFixed(4))) as TripMap['bounds'],
  width: W,
  height: H,
  land: pathOf([country], 1.5),
  neighbours: pathOf(neighbours, 3),
};

payload.map = map;
writeFileSync(file, JSON.stringify(trip, null, 2), 'utf8');
console.log(`mapa ${W}×${H}, límites ${map.bounds.join(' ')}, ${(map.land.length / 1024).toFixed(1)} kB de país y ${(map.neighbours.length / 1024).toFixed(1)} kB de vecinos`);
