/**
 * Puente entre el plan y el registro. Es el único sitio donde se miran los dos
 * a la vez, y aun así sólo se escribe en el registro.
 */

import type { TripPayload, Day } from '../model/types.ts';
import type { Journal, SkipReason } from './types.ts';
import { statusLookup, isFreeMode } from './journal.ts';
import { computeSchedule, computeSlack } from '../core/schedule.ts';
import { isOpenAt } from '../core/hours.ts';
import { evaluate, type Alert, type AlertLevel } from '../core/alerts.ts';
import type { Minutes } from '../core/time.ts';

/**
 * §5.1 — **no se piden motivos de salto, se deducen.**
 *
 * Preguntar «¿por qué te lo saltas?» con el sol de cara y el grupo esperando es
 * la clase de fricción por la que se abandonan estas apps. El estado en ese
 * instante ya lo dice: si el sitio está cerrado, es el horario; si no daba
 * tiempo, es el tiempo; si daba, fue una decisión.
 */
export function inferSkipReason(
  plan: TripPayload,
  day: Day,
  waypointId: string,
  now: Minutes,
  journal: Journal,
): SkipReason {
  const waypoint = day.waypoints.find((w) => w.id === waypointId);
  if (!waypoint) return 'choice';

  const place = plan.places[waypoint.place];
  const schedule = computeSchedule(day);
  const stop = schedule.stops.find((s) => s.waypoint.id === waypointId);

  // ¿Estaría cerrado al llegar? Es el motivo más concreto, y manda.
  if (place && stop) {
    const verdict = isOpenAt(place.hours, day.date, Math.max(now, stop.arrive));
    if (verdict.state === 'closed') return 'closed';
  }

  // ¿Falta tiempo hasta el próximo compromiso?
  const slack = computeSlack(day, now, statusLookup(journal));
  if (slack.slack < 0) return 'time';

  return 'choice';
}

/**
 * §7.2 — en modo libre se silencian TODOS los avisos y la app registra en
 * silencio. Al desactivarlo, la holgura se recalcula desde el estado real, que
 * es lo que hace que volver al plan no sea un castigo.
 */
export function alertFor(
  day: Day,
  now: Minutes,
  journal: Journal,
  plan: TripPayload,
  previous: AlertLevel = 'green',
): Alert | null {
  if (isFreeMode(journal, day.id)) return null;

  return evaluate(day, now, {
    previous,
    statusOf: statusLookup(journal),
    nameOf: (placeId) => plan.places[placeId]?.name ?? placeId,
  });
}

/** Duraciones planificadas por id, para el multiplicador de ritmo (§5.2). */
export function plannedDurations(plan: TripPayload): Map<string, number> {
  const map = new Map<string, number>();
  for (const day of plan.days) {
    for (const w of day.waypoints) map.set(w.id, w.duration);
  }
  return map;
}

/** Todos los ids de waypoint del plan, para detectar registros huérfanos. */
export function planWaypointIds(plan: TripPayload): Set<string> {
  const ids = new Set<string>();
  for (const day of plan.days) {
    for (const w of day.waypoints) ids.add(w.id);
  }
  return ids;
}
