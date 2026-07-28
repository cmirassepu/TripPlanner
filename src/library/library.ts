/**
 * La librería — §11.1.
 *
 * Pantalla de inicio con los viajes: activo, próximos, terminados. Un viaje
 * pasa a terminado cuando pasa su `endDate`.
 *
 * La fecha de hoy se pasa siempre como argumento en vez de leer el reloj aquí
 * dentro: en un viaje largo el aparato cruza husos horarios, y el día que
 * cuenta es el del viaje, no el del sistema (§6.4).
 */

import type { TripPayload } from '../model/types.ts';
import type { Journal } from '../journal/types.ts';
import { planWaypointIds } from '../journal/infer.ts';

export type TripStatus = 'upcoming' | 'active' | 'finished';

export interface TripSummary {
  tripId: string;
  title: string;
  startDate: string;
  endDate: string;
  status: TripStatus;
  days: number;
  /** Día del viaje en el que estás, 1-indexado. `null` si no está activo. */
  currentDay: number | null;
  planned: number;
  visited: number;
  skipped: number;
  improvised: number;
}

export function statusOfTrip(plan: TripPayload, today: string): TripStatus {
  if (today < plan.startDate) return 'upcoming';
  if (today > plan.endDate) return 'finished';
  return 'active';
}

export function summarise(
  plan: TripPayload,
  journal: Journal | null,
  today: string,
): TripSummary {
  const records = Object.values(journal?.waypoints ?? {});
  const status = statusOfTrip(plan, today);

  return {
    tripId: journal?.tripId ?? '',
    title: plan.title[plan.primaryLanguage] ?? plan.title.es ?? '',
    startDate: plan.startDate,
    endDate: plan.endDate,
    status,
    days: plan.days.length,
    currentDay: status === 'active' ? daysBetween(plan.startDate, today) + 1 : null,
    planned: planWaypointIds(plan).size,
    // `partial` cuenta como visitada: se estuvo allí, aunque fuera poco.
    visited: records.filter((r) => r.status === 'visited' || r.status === 'partial').length,
    skipped: records.filter((r) => r.status === 'skipped').length,
    improvised: journal?.improvised.length ?? 0,
  };
}

/**
 * Orden de la pantalla: primero el activo, que es el que se abre a diario;
 * luego lo que viene, por cercanía; y al final lo terminado, lo más reciente
 * arriba.
 */
export function sortForLibrary(trips: TripSummary[]): TripSummary[] {
  const rank: Record<TripStatus, number> = { active: 0, upcoming: 1, finished: 2 };
  return [...trips].sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    return a.status === 'finished'
      ? b.startDate.localeCompare(a.startDate)
      : a.startDate.localeCompare(b.startDate);
  });
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}
