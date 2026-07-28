/**
 * Operaciones sobre el registro — §5 y §7.
 *
 * Todas son puras: reciben un registro y devuelven otro. Nada de mutar en
 * sitio. Así el deshacer de §9.3 es guardar la referencia anterior, y las
 * pruebas no arrastran estado entre casos.
 *
 * Ninguna función de este módulo toca el plan. Ninguna función que toque el
 * plan vive aquí. Esa frontera es §2.5 y es la que permite que un parche
 * reescriba un día entero sin perder nada tuyo.
 */

import type { Coords } from '../model/types.ts';
import type {
  Journal,
  WaypointRecord,
  WaypointStatus,
  ImprovisedWaypoint,
  SkipReason,
} from './types.ts';

/** Inyectable: las pruebas necesitan un reloj que no avance solo. */
export type Clock = () => string;

export const systemClock: Clock = () => new Date().toISOString();

/**
 * Transiciones legales (§5.1):
 *
 *   pending → current → visited
 *                     → partial
 *   pending → skipped
 *
 * Cualquier estado puede volver a `pending`: marcar por error es lo más común
 * que va a pasar con el móvil en la mano y sol de frente.
 */
const LEGAL: Record<WaypointStatus, WaypointStatus[]> = {
  pending: ['current', 'skipped', 'visited'],
  current: ['visited', 'partial', 'skipped', 'pending'],
  visited: ['pending', 'partial'],
  skipped: ['pending'],
  partial: ['pending', 'visited'],
};

export function canTransition(from: WaypointStatus, to: WaypointStatus): boolean {
  return from === to || LEGAL[from].includes(to);
}

export function statusOf(journal: Journal, waypointId: string): WaypointStatus {
  return journal.waypoints[waypointId]?.status ?? 'pending';
}

/** Adaptador para el motor de holgura (§6.2). */
export function statusLookup(journal: Journal): (id: string) => WaypointStatus {
  return (id) => statusOf(journal, id);
}

function write(journal: Journal, id: string, record: WaypointRecord): Journal {
  return { ...journal, waypoints: { ...journal.waypoints, [id]: record } };
}

/** Llegas. Sólo hay una parada `current` a la vez: la anterior se cierra sola. */
export function arrive(journal: Journal, waypointId: string, clock: Clock = systemClock): Journal {
  const now = clock();
  const previous = journal.waypoints[waypointId];

  let next: Journal = journal;
  for (const [id, rec] of Object.entries(journal.waypoints)) {
    if (id !== waypointId && rec.status === 'current') {
      next = write(next, id, { ...rec, status: 'visited', leftAt: rec.leftAt ?? now });
    }
  }

  return write(next, waypointId, { ...previous, status: 'current', arrivedAt: now });
}

/**
 * Te vas. `partial` existe porque quedarse diez minutos en vez de treinta no es
 * ni visitado ni saltado (§5.1). Se deduce de lo que se ha estado de verdad.
 */
const PARTIAL_RATIO = 0.5;

export function depart(
  journal: Journal,
  waypointId: string,
  plannedDuration: number,
  clock: Clock = systemClock,
): Journal {
  const record = journal.waypoints[waypointId];
  if (!record?.arrivedAt) return journal;

  const now = clock();
  const stayed = minutesBetween(record.arrivedAt, now);
  const status: WaypointStatus =
    plannedDuration > 0 && stayed !== null && stayed < plannedDuration * PARTIAL_RATIO
      ? 'partial'
      : 'visited';

  return write(journal, waypointId, { ...record, status, leftAt: now });
}

/** Saltar devuelve tiempo al bote, y el banner se actualiza en el acto (§6.3). */
export function skip(
  journal: Journal,
  waypointId: string,
  reason: SkipReason,
  clock: Clock = systemClock,
): Journal {
  return write(journal, waypointId, {
    ...journal.waypoints[waypointId],
    status: 'skipped',
    at: clock(),
    skipReason: reason,
  });
}

/** Deshacer una marca puesta sin querer. Conserva la nota: costó escribirla. */
export function unmark(journal: Journal, waypointId: string): Journal {
  const record = journal.waypoints[waypointId];
  if (!record) return journal;
  const { note } = record;
  return write(journal, waypointId, note ? { status: 'pending', note } : { status: 'pending' });
}

export function annotate(journal: Journal, waypointId: string, note: string): Journal {
  const record = journal.waypoints[waypointId] ?? { status: 'pending' as WaypointStatus };
  return write(journal, waypointId, { ...record, note });
}

/* ── Improvisación (§7.1) ────────────────────────────────────────────── */

/**
 * Pide sólo el nombre. Las coordenadas salen del GPS porque estás allí, y la
 * hora del reloj. Eso elimina de raíz el riesgo de coordenadas inventadas, que
 * es el fallo más caro del sistema (§4.4).
 */
export function improvise(
  journal: Journal,
  input: { dayId: string; name: string; coords: Coords | null; note?: string; photo?: string },
  clock: Clock = systemClock,
): Journal {
  const entry: ImprovisedWaypoint = {
    id: `imp-${String(journal.improvised.length + 1).padStart(2, '0')}`,
    dayId: input.dayId,
    name: input.name,
    coords: input.coords,
    at: clock(),
    ...(input.note ? { note: input.note } : {}),
    ...(input.photo ? { photo: input.photo } : {}),
  };
  return { ...journal, improvised: [...journal.improvised, entry] };
}

/* ── Modo libre (§7.2) ───────────────────────────────────────────────── */

export function setFreeMode(journal: Journal, dayId: string, on: boolean): Journal {
  const day = journal.days[dayId] ?? { freeMode: false, closingNote: '' };
  return { ...journal, days: { ...journal.days, [dayId]: { ...day, freeMode: on } } };
}

export function isFreeMode(journal: Journal, dayId: string): boolean {
  return journal.days[dayId]?.freeMode ?? false;
}

export function closeDay(journal: Journal, dayId: string, note: string): Journal {
  const day = journal.days[dayId] ?? { freeMode: false, closingNote: '' };
  return { ...journal, days: { ...journal.days, [dayId]: { ...day, closingNote: note } } };
}

/* ── Registros huérfanos (§2.5) ──────────────────────────────────────── */

/**
 * Marcas cuya parada ya no está en el plan. No se borran nunca: el plan se
 * puede regenerar, tus datos no. Se enseñan al exportar para que no se pierdan
 * en silencio.
 */
export function orphans(journal: Journal, planWaypointIds: ReadonlySet<string>): string[] {
  return Object.keys(journal.waypoints).filter((id) => !planWaypointIds.has(id));
}

/* ── Ritmo (§5.2) ────────────────────────────────────────────────────── */

export interface Pace {
  estimated: number;
  actual: number;
  /** Real ÷ estimado. >1 significa que se tarda más de lo que se planifica. */
  factor: number;
  /** Paradas con hora de entrada y de salida. Menos de tres y el dato no dice nada. */
  sample: number;
}

/**
 * Aritmética, no aprendizaje automático. Se aprende con un solo viaje y es lo
 * único que mejora de verdad la planificación siguiente.
 */
export function pace(
  journal: Journal,
  plannedDurations: ReadonlyMap<string, number>,
): Pace | null {
  let estimated = 0;
  let actual = 0;
  let sample = 0;

  for (const [id, record] of Object.entries(journal.waypoints)) {
    if (record.status !== 'visited' && record.status !== 'partial') continue;
    if (!record.arrivedAt || !record.leftAt) continue;

    const planned = plannedDurations.get(id);
    const real = minutesBetween(record.arrivedAt, record.leftAt);
    if (planned === undefined || planned <= 0 || real === null) continue;

    estimated += planned;
    actual += real;
    sample += 1;
  }

  if (sample === 0 || estimated === 0) return null;
  return { estimated, actual, factor: round2(actual / estimated), sample };
}

/* ── utilidades ──────────────────────────────────────────────────────── */

/** Diferencia en minutos entre dos ISO 8601. `null` si alguno no se entiende. */
export function minutesBetween(from: string, to: string): number | null {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 60_000);
}

const round2 = (n: number) => Math.round(n * 100) / 100;
