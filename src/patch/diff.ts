/**
 * El diff en lenguaje llano — §9.3. No es opcional.
 *
 * Un parche puede llegar estando ya de viaje, con el móvil al 12 % y sin datos.
 * Lo que se enseña antes de aplicar tiene que leerse de un vistazo y decir qué
 * cambia y si toca algo tuyo. Rutas y JSON no valen: eso es el informe del
 * validador, que es otra pantalla y otro momento.
 */

import type { TripPayload, Localized, Waypoint, TimeRange } from '../model/types.ts';
import type { Change } from './apply.ts';
import { splitPath } from './paths.ts';

export interface DiffOptions {
  lang?: string;
  /** Waypoints con datos del usuario, para la línea «Tus datos». */
  journalledWaypoints?: ReadonlySet<string>;
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export function formatDiff(
  changes: Change[],
  base: TripPayload,
  label: string | undefined,
  version: number,
  opts: DiffOptions = {},
): string {
  const lang = opts.lang ?? base.primaryLanguage ?? 'es';
  const journalled = opts.journalledWaypoints ?? new Set<string>();

  const lines = changes.map((c) => describeChange(c, base, lang));
  const touched = changes
    .filter((c) => c.kind === 'remove')
    .map((c) => (c.before as { id?: string })?.id)
    .filter((id): id is string => typeof id === 'string' && journalled.has(id));

  const header = label ? `Parche v${version} — «${label}»` : `Parche v${version}`;

  const footer =
    journalled.size === 0
      ? 'Tus datos: nada marcado todavía'
      : touched.length === 0
        ? `Tus datos: ${journalled.size} paradas marcadas, ninguna afectada`
        : `Tus datos: ${journalled.size} paradas marcadas, ${touched.length} afectada${
            touched.length === 1 ? '' : 's'
          } (${touched.join(', ')}). El registro no se borra: quedará huérfano`;

  return [header, '', ...lines.map((l) => `  ${l}`), '', `  ${footer}`].join('\n');
}

function describeChange(c: Change, base: TripPayload, lang: string): string {
  const segments = splitPath(c.path);
  const where = contextOf(segments, base, lang);
  const field = segments[segments.length - 1];

  switch (c.kind) {
    case 'set': {
      if (field === 'startTime') return `~ ${where}: salida ${c.before} → ${c.after}`;
      if (field === 'travelFrom') return `~ ${where}: trayecto ${c.before} → ${c.after} min`;
      if (field === 'duration') return `~ ${where}: duración ${c.before} → ${c.after} min`;
      if (field === 'default' || field === 'hours') {
        return `~ ${where}: horario ${ranges(c.before)} → ${ranges(c.after)}`;
      }
      if (field === 'anchor') return `~ ${where}: nueva hora límite ${anchorTime(c.after)}`;
      return `~ ${where}: ${field} ${short(c.before)} → ${short(c.after)}`;
    }

    case 'merge': {
      if (field === 'hours') return `~ ${where}: horario ${ranges(c.after)}`;
      return `~ ${where}: se actualiza ${field}`;
    }

    case 'remove': {
      const name = waypointName(c.before as Waypoint, base, lang);
      return `− ${where}: se elimina ${name}`;
    }

    case 'insert': {
      const w = c.after as Waypoint;
      const name = waypointName(w, base, lang);
      const mins = typeof w?.duration === 'number' ? ` (${w.duration} min)` : '';
      return `+ ${where}: se añade ${name}${mins}`;
    }
  }
}

/** «Domingo 13» para rutas de día, o el nombre del sitio para rutas de biblioteca. */
function contextOf(segments: string[], base: TripPayload, lang: string): string {
  if (segments[0] === 'days') {
    const day = base.days.find((d) => d.id === segments[1]);
    if (!day) return segments[1] ?? 'día';
    const [y, m, d] = day.date.split('-').map(Number);
    const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
    const when = `${cap(wd)} ${d}`;

    // «Domingo 13: trayecto 12 → 25 min» no dice a qué parada. Con el nombre
    // delante, la línea se sostiene sola, que es el punto del diff.
    if (segments[2] === 'waypoints' && segments.length > 4) {
      const wp = day.waypoints.find((w) => w.id === segments[3]);
      const name = wp ? base.places[wp.place]?.name ?? wp.id : segments[3];
      return `${when} · ${name}`;
    }
    return when;
  }
  if (segments[0] === 'places') {
    return base.places[segments[1]]?.name ?? segments[1] ?? 'sitio';
  }
  return segments.slice(0, 2).join(' ');
}

function waypointName(w: Waypoint | undefined, base: TripPayload, lang: string): string {
  if (!w) return 'una parada';
  const place = base.places[w.place];
  return place?.name ?? w.place ?? w.id;
}

function ranges(v: unknown): string {
  const list = Array.isArray(v) ? v : (v as { default?: unknown })?.default;
  if (!Array.isArray(list)) return 'sin horario';
  return (
    (list as TimeRange[]).map((r) => `${r[0]}–${r[1]}`).join(', ') || 'cerrado'
  );
}

function anchorTime(v: unknown): string {
  const t = (v as { time?: string })?.time;
  return t ?? '—';
}

function short(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  return JSON.stringify(v).slice(0, 40);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function localized(v: Localized | null | undefined, lang: string): string | null {
  if (!v) return null;
  return v[lang] ?? v.es ?? Object.values(v).find((x) => typeof x === 'string') ?? null;
}
