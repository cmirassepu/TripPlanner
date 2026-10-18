/**
 * Mapa de un día a pie — `node scripts/maps/walking-map.ts <archivo.trip.json> <dayId> [s,w,n,e]`
 *
 * Dibuja las calles, el agua y la ruta a pie entre las paradas del día con
 * datos de OpenStreetMap (ODbL; el mapa lleva su atribución), y lo guarda en
 * `day.map` como SVG. La app pone encima las paradas numeradas y el punto de
 * «estás aquí» usando los mismos límites.
 *
 * La ruta se calcula aquí, sin servidor de rutas: Dijkstra sobre las calles
 * descargadas, que para un paseo de un par de kilómetros es más que de sobra.
 * Los tramos que no son a pie (ferry, metro) van como línea recta discontinua.
 *
 * Proyección: lineal, con la anchura corregida por el coseno de la latitud. En
 * una caja de dos kilómetros el error es de centímetros.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const [file, dayId, third] = process.argv.slice(2);
const boundsArg = third && !third.startsWith('--') ? third : undefined;
if (!file || !dayId) {
  console.error('uso: node scripts/maps/walking-map.ts <archivo.trip.json> <dayId> [s,w,n,e]');
  process.exit(1);
}

const trip = JSON.parse(readFileSync(file, 'utf8'));
const payload = trip.payload;
const day = payload.days.find((d: { id: string }) => d.id === dayId);
if (!day) throw new Error(`no existe el día ${dayId}`);

type LatLon = [number, number];
interface Stop {
  id: string;
  name: string;
  coords: LatLon;
  mode: string;
}

const stops: Stop[] = day.waypoints
  .map((w: { id: string; place: string; travelMode?: string }) => ({
    id: w.id,
    name: payload.places[w.place]?.name ?? w.place,
    coords: payload.places[w.place]?.coords ?? null,
    mode: w.travelMode ?? 'walking',
  }))
  .filter((s: Stop) => s.coords);
if (stops.length < 2) throw new Error('hacen falta al menos dos paradas con coordenadas');

/* ── Límites y proyección ─────────────────────────────────────────────── */

let [s, w, n, e] = boundsArg
  ? (boundsArg.split(',').map(Number) as [number, number, number, number])
  : (() => {
      const lats = stops.map((st) => st.coords[0]);
      const lons = stops.map((st) => st.coords[1]);
      const padLat = 0.0025;
      const padLon = padLat / Math.cos((((Math.min(...lats) + Math.max(...lats)) / 2) * Math.PI) / 180);
      return [Math.min(...lats) - padLat, Math.min(...lons) - padLon, Math.max(...lats) + padLat, Math.max(...lons) + padLon];
    })();

const kx = Math.cos((((s + n) / 2) * Math.PI) / 180);
const W = 1000;
const H = Math.round((W * (n - s)) / ((e - w) * kx));
const px = ([lat, lon]: LatLon): [number, number] => [((lon - w) / (e - w)) * W, ((n - lat) / (n - s)) * H];
const metres = (a: LatLon, b: LatLon): number => {
  const R = 6371000;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/* ── Datos de OpenStreetMap ───────────────────────────────────────────── */

const bbox = `${s},${w},${n},${e}`;
const query = `[out:json][timeout:90];
(
  way["highway"~"^(primary|secondary|tertiary|residential|unclassified|living_street|pedestrian|footway|path|steps|service|primary_link|secondary_link|tertiary_link)$"](${bbox});
  way["waterway"~"^(river|canal|stream)$"](${bbox});
  way["natural"="water"](${bbox});
  relation["natural"="water"](${bbox});
  way["railway"~"^(rail|subway|light_rail|monorail)$"](${bbox});
  way["leisure"="park"](${bbox});
  way["landuse"~"^(grass|cemetery)$"](${bbox});
);
out body geom;`;

interface Way {
  type: 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
  nodes?: number[];
  geometry?: { lat: number; lon: number }[];
  members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[];
}

// `--osm <archivo>` usa una descarga previa (Overpass se satura a ratos).
const given = process.argv.indexOf('--osm');
const cache =
  given > 0 ? process.argv[given + 1] : join(tmpdir(), `osm-${createHash('sha1').update(query).digest('hex').slice(0, 12)}.json`);
if (!existsSync(cache)) {
  console.log('descargando OpenStreetMap…');
  // Dos servidores públicos de Overpass: el principal se satura a ratos.
  let text: string | null = null;
  for (const host of ['https://overpass-api.de', 'https://overpass.kumi.systems']) {
    const res = await fetch(`${host}/api/interpreter`, {
      method: 'POST',
      headers: { 'User-Agent': 'TripPlanner/1.0 (personal trip guide)' },
      body: new URLSearchParams({ data: query }),
    });
    if (res.ok) {
      text = await res.text();
      break;
    }
    console.warn(`${host}: ${res.status}`);
  }
  if (!text) throw new Error('Overpass no responde');
  writeFileSync(cache, text);
}
const elements: Way[] = JSON.parse(readFileSync(cache, 'utf8')).elements;

/* ── Capas ────────────────────────────────────────────────────────────── */

const fmt = (v: number) => v.toFixed(0);
const toPoints = (g: { lat: number; lon: number }[]) => g.map((p) => px([p.lat, p.lon]));

/** Douglas-Peucker sobre puntos proyectados: menos bytes, mismo dibujo. */
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
const path = (pts: [number, number][], close = false) =>
  'M' + simplify(pts, 1.2).map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join('L') + (close ? 'Z' : '');

const groups: Record<string, string[]> = {
  green: [],
  water: [],
  waterline: [],
  rail: [],
  minor: [],
  street: [],
  tertiary: [],
  major: [],
};

const MAJOR = new Set(['primary', 'secondary', 'primary_link', 'secondary_link']);
const STREET = new Set(['residential', 'unclassified', 'living_street', 'pedestrian']);

for (const el of elements) {
  const t = el.tags ?? {};
  if (el.type === 'relation') {
    for (const m of el.members ?? []) {
      if (m.geometry && (m.role === 'outer' || !m.role)) groups.water.push(path(toPoints(m.geometry), true));
    }
    continue;
  }
  if (!el.geometry) continue;
  const pts = toPoints(el.geometry);
  if (t.natural === 'water') groups.water.push(path(pts, true));
  else if (t.waterway) groups.waterline.push(path(pts));
  else if (t.leisure === 'park' || t.landuse) groups.green.push(path(pts, true));
  else if (t.railway) groups.rail.push(path(pts));
  else if (t.highway) {
    const h = t.highway;
    if (MAJOR.has(h)) groups.major.push(path(pts));
    else if (h === 'tertiary' || h === 'tertiary_link') groups.tertiary.push(path(pts));
    else if (STREET.has(h)) groups.street.push(path(pts));
    else groups.minor.push(path(pts));
  }
}

/* ── Nombres de calle ─────────────────────────────────────────────────── */

/**
 * Un nombre por calle, sobre su tramo más largo dentro de la caja. Sólo las
 * calles con entidad: las de barrio sin nombre no ayudan a orientarse y
 * llenarían el mapa de letra.
 */
const LABELLED = new Set([...MAJOR, 'tertiary', 'residential', 'pedestrian', 'unclassified']);
const best = new Map<string, { len: number; pts: [number, number][] }>();
for (const el of elements) {
  const t = el.tags ?? {};
  if (el.type !== 'way' || !el.geometry || !t.highway || !LABELLED.has(t.highway)) continue;
  const name = t['name:en'] ?? t.name;
  if (!name || /[^\x20-\x7EÀ-ɏ]/.test(name)) continue; // sólo nombres en alfabeto latino
  let pts = toPoints(el.geometry).filter(([x, y]) => x >= 0 && x <= W && y >= 0 && y <= H);
  if (pts.length < 2) continue;
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const prev = best.get(name);
  if (!prev || len > prev.len) best.set(name, { len, pts });
}
const labels: string[] = [];
let labelId = 0;
for (const [name, { len, pts }] of best) {
  const short = name.replace(/^Thanon /, '').replace(/ Road$/, '');
  if (len < short.length * 11 + 40) continue; // no cabe
  // De izquierda a derecha, para que el texto no salga del revés.
  const ordered = pts[0][0] <= pts[pts.length - 1][0] ? pts : [...pts].reverse();
  const id = `l${labelId++}`;
  labels.push(
    `<path id="${id}" d="${path(ordered)}" fill="none"/><text font-size="17" fill="#5E574B" letter-spacing="1"><textPath href="#${id}" startOffset="50%" text-anchor="middle" dominant-baseline="middle">${escapeXml(short)}</textPath></text>`,
  );
}

/* ── Ruta a pie ───────────────────────────────────────────────────────── */

interface Edge {
  to: number;
  cost: number;
}
const nodes = new Map<number, LatLon>();
const adj = new Map<number, Edge[]>();
for (const el of elements) {
  const t = el.tags ?? {};
  if (el.type !== 'way' || !el.nodes || !el.geometry || !t.highway) continue;
  if (t.access === 'private' || t.foot === 'no') continue;
  const factor = t.highway === 'steps' ? 1.6 : t.highway === 'service' ? 1.2 : 1;
  for (let i = 0; i < el.nodes.length; i++) {
    const g = el.geometry[i];
    nodes.set(el.nodes[i], [g.lat, g.lon]);
    if (i === 0) continue;
    const a = el.nodes[i - 1];
    const b = el.nodes[i];
    const cost = metres(nodes.get(a)!, nodes.get(b)!) * factor;
    (adj.get(a) ?? adj.set(a, []).get(a)!).push({ to: b, cost });
    (adj.get(b) ?? adj.set(b, []).get(b)!).push({ to: a, cost });
  }
}

function nearest(p: LatLon): number | null {
  let bestId: number | null = null;
  let bestD = Infinity;
  for (const [id, c] of nodes) {
    if (!adj.has(id)) continue;
    const d = metres(p, c);
    if (d < bestD) {
      bestD = d;
      bestId = id;
    }
  }
  return bestD < 150 ? bestId : null;
}

function dijkstra(from: number, to: number): LatLon[] | null {
  const dist = new Map<number, number>([[from, 0]]);
  const prev = new Map<number, number>();
  const open: [number, number][] = [[0, from]];
  const done = new Set<number>();
  while (open.length) {
    open.sort((a, b) => a[0] - b[0]);
    const [d, u] = open.shift()!;
    if (done.has(u)) continue;
    done.add(u);
    if (u === to) break;
    for (const { to: v, cost } of adj.get(u) ?? []) {
      const nd = d + cost;
      if (nd < (dist.get(v) ?? Infinity)) {
        dist.set(v, nd);
        prev.set(v, u);
        open.push([nd, v]);
      }
    }
  }
  if (!dist.has(to)) return null;
  const out: LatLon[] = [];
  for (let u: number | undefined = to; u !== undefined; u = prev.get(u)) out.push(nodes.get(u)!);
  return out.reverse();
}

const walks: string[] = [];
const hops: string[] = [];
let routed = 0;
for (let i = 1; i < stops.length; i++) {
  const a = stops[i - 1];
  const b = stops[i];
  const line = `M${fmt(px(a.coords)[0])} ${fmt(px(a.coords)[1])}L${fmt(px(b.coords)[0])} ${fmt(px(b.coords)[1])}`;
  if (b.mode !== 'walking') {
    hops.push(line);
    continue;
  }
  const from = nearest(a.coords);
  const to = nearest(b.coords);
  const route = from !== null && to !== null ? dijkstra(from, to) : null;
  if (!route) {
    console.warn(`sin ruta a pie de ${a.name} a ${b.name}: línea recta`);
    hops.push(line);
    continue;
  }
  routed++;
  walks.push(path([px(a.coords), ...route.map(px), px(b.coords)]));
}

/* ── SVG ──────────────────────────────────────────────────────────────── */

function escapeXml(t: string): string {
  return t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
const layer = (d: string[], attrs: string) => (d.length ? `<path d="${d.join('')}" ${attrs}/>` : '');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<rect width="${W}" height="${H}" fill="#F4EFE6"/>
${layer(groups.green, 'fill="#DCE8CF" stroke="none" fill-rule="evenodd"')}
${layer(groups.water, 'fill="#C9DFE8" stroke="none" fill-rule="evenodd"')}
${layer(groups.waterline, 'fill="none" stroke="#C9DFE8" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"')}
<g fill="none" stroke-linecap="round" stroke-linejoin="round">
${layer(groups.minor, 'stroke="#E2DACB" stroke-width="1.5"')}
${layer(groups.street, 'stroke="#FFFFFF" stroke-width="4"')}
${layer(groups.tertiary, 'stroke="#FFFFFF" stroke-width="6"')}
${layer(groups.major, 'stroke="#F3E3B9" stroke-width="9"')}
${layer(groups.rail, 'stroke="#B9B2A6" stroke-width="2" stroke-dasharray="8 6"')}
</g>
<g font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif">${labels.join('')}</g>
<g fill="none" stroke-linecap="round" stroke-linejoin="round">
${layer(walks, 'stroke="#FFFFFF" stroke-width="10" opacity=".9"')}
${layer(walks, 'stroke="#C65D21" stroke-width="5"')}
${layer(hops, 'stroke="#C65D21" stroke-width="4" stroke-dasharray="4 10"')}
</g>
<text x="${W - 10}" y="${H - 10}" text-anchor="end" font-size="13" fill="#8A8376" font-family="-apple-system,system-ui,sans-serif">© OpenStreetMap contributors</text>
</svg>`;

// Se guarda como imagen de tamaño fijo (WebP a 2000 px de ancho): un SVG en el
// teléfono se rasteriza de nuevo con cada zoom y se queda sin memoria. Para
// pasar de SVG a imagen se usa el visor rápido de macOS y Pillow.
const tmpSvg = join(tmpdir(), `${dayId}.svg`);
writeFileSync(tmpSvg, svg);
execFileSync('qlmanage', ['-t', '-s', '2000', '-o', tmpdir(), tmpSvg], { stdio: 'ignore' });
const webp = execFileSync(
  'python3',
  [
    '-c',
    `import sys,io,base64
from PIL import Image
im=Image.open(sys.argv[1]).convert('RGB')
# el visor rellena hasta un cuadrado: se recorta a la forma del mapa
ratio=float(sys.argv[2]); im=im.crop((0,0,im.size[0],int(im.size[0]*ratio)))
w=2000; im=im.resize((w,int(w*ratio)),Image.LANCZOS)
b=io.BytesIO(); im.save(b,'WEBP',quality=72,method=6)
sys.stdout.write('data:image/webp;base64,'+base64.b64encode(b.getvalue()).decode())`,
    `${tmpSvg}.png`,
    String(H / W),
  ],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);

day.map = {
  bounds: [s, w, n, e].map((v) => Number(v.toFixed(5))),
  width: W,
  height: H,
  src: webp,
};
writeFileSync(file, JSON.stringify(trip, null, 2), 'utf8');
if (process.argv.includes('--svg')) writeFileSync(`${dayId}.svg`, svg);
console.log(
  `${dayId}: ${W}×${H}, ${(webp.length / 1024).toFixed(0)} kB de imagen, ${labels.length} nombres, ${routed} tramos a pie de ${stops.length - 1}, ${hops.length} saltos`,
);
