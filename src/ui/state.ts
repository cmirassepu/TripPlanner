/**
 * Estado de la app y rutas. Todo lo de aquí es puro y se prueba en Node: el
 * navegador sólo aporta el hash y el reloj.
 */

import type { TripPayload } from '../model/types.ts';
import type { Journal } from '../journal/types.ts';
import type { StoredPlan } from '../store/db.ts';
import type { AlertLevel } from '../core/alerts.ts';
import type { StorageStatus } from '../store/install.ts';
import { parseClock, type Minutes } from '../core/time.ts';

export type Route =
  | { name: 'library' }
  | { name: 'day'; tripId: string; dayId: string }
  | { name: 'trip'; tripId: string }
  | { name: 'settings' };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'settings') return { name: 'settings' };
  if (parts[0] === 'trip' && parts[1]) {
    if (parts[2] === 'day' && parts[3]) {
      return { name: 'day', tripId: decodeURIComponent(parts[1]), dayId: parts[3] };
    }
    return { name: 'trip', tripId: decodeURIComponent(parts[1]) };
  }
  return { name: 'library' };
}

export function routeHash(route: Route): string {
  switch (route.name) {
    case 'library':
      return '#/';
    case 'settings':
      return '#/settings';
    case 'trip':
      return `#/trip/${encodeURIComponent(route.tripId)}`;
    case 'day':
      return `#/trip/${encodeURIComponent(route.tripId)}/day/${route.dayId}`;
  }
}

/**
 * Reloj simulado. §14 paso 4 pide que los avisos sean simulables cambiando el
 * reloj, y sin esto la app es inútil fuera de las fechas del viaje: hoy es
 * julio y el fixture es de septiembre, así que todo saldría pendiente y en
 * verde para siempre.
 */
export interface SimulatedClock {
  /** ISO `YYYY-MM-DD`, o `null` para usar el del aparato. */
  date: string | null;
  /** `HH:MM`, o `null` para usar la hora real. */
  time: string | null;
}

export interface AppState {
  route: Route;
  plans: StoredPlan[];
  plan: TripPayload | null;
  journal: Journal | null;
  storage: StorageStatus;
  alert: { level: AlertLevel; dismissedAt?: AlertLevel };
  clock: SimulatedClock;
  /** Mensaje efímero de confirmación, tipo «deshecho». */
  flash: string | null;
  /**
   * Hay una versión esperando que §12.2 no ha dejado activarse por haber viaje
   * en curso. Sin una forma manual de aceptarla, una corrección urgente no
   * podría llegar hasta después del viaje, que es cuando ya no sirve.
   */
  updateReady: boolean;
}

export function today(clock: SimulatedClock, real = new Date()): string {
  if (clock.date) return clock.date;
  return `${real.getFullYear()}-${pad(real.getMonth() + 1)}-${pad(real.getDate())}`;
}

export function nowMinutes(clock: SimulatedClock, real = new Date()): Minutes {
  if (clock.time) return parseClock(clock.time) ?? 0;
  return real.getHours() * 60 + real.getMinutes();
}

const pad = (n: number) => String(n).padStart(2, '0');

/** El día que toca abrir: el de hoy si el viaje está en marcha, si no el primero. */
export function dayForToday(plan: TripPayload, todayIso: string): string {
  return plan.days.find((d) => d.date === todayIso)?.id ?? plan.days[0]?.id ?? '';
}
