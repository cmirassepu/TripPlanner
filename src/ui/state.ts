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
  | { name: 'day'; tripId: string; dayId: string; tab: DayTab }
  | { name: 'stop'; tripId: string; dayId: string; waypointId: string }
  | { name: 'place'; tripId: string; dayId: string; placeId: string }
  | { name: 'bookings'; tripId: string }
  | { name: 'trip'; tripId: string }
  | { name: 'settings' };

/** Las tres vistas de un día. `plan` es la que sale por defecto. */
export type DayTab = 'plan' | 'nearby' | 'bookings';

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'settings') return { name: 'settings' };
  if (parts[0] === 'trip' && parts[1]) {
    if (parts[2] === 'day' && parts[3]) {
      const tripId = decodeURIComponent(parts[1]);
      if (parts[4] === 'stop' && parts[5]) {
        return { name: 'stop', tripId, dayId: parts[3], waypointId: decodeURIComponent(parts[5]) };
      }
      if (parts[4] === 'place' && parts[5]) {
        return { name: 'place', tripId, dayId: parts[3], placeId: decodeURIComponent(parts[5]) };
      }
      const tab: DayTab = parts[4] === 'nearby' || parts[4] === 'bookings' ? parts[4] : 'plan';
      return { name: 'day', tripId, dayId: parts[3], tab };
    }
    if (parts[2] === 'bookings') return { name: 'bookings', tripId: decodeURIComponent(parts[1]) };
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
      return `#/trip/${encodeURIComponent(route.tripId)}/day/${route.dayId}${
        route.tab === 'plan' ? '' : `/${route.tab}`
      }`;
    case 'stop':
      return `#/trip/${encodeURIComponent(route.tripId)}/day/${route.dayId}/stop/${encodeURIComponent(route.waypointId)}`;
    case 'place':
      return `#/trip/${encodeURIComponent(route.tripId)}/day/${route.dayId}/place/${encodeURIComponent(route.placeId)}`;
    case 'bookings':
      return `#/trip/${encodeURIComponent(route.tripId)}/bookings`;
  }
}

/**
 * La pantalla anterior y la siguiente a la que se está viendo: el día de al
 * lado, o la parada de al lado dentro del mismo día. `null` en los extremos y
 * en las pantallas que no tienen vecinas.
 */
export function neighbours(plan: TripPayload, route: Route): { prev: Route | null; next: Route | null } {
  if (route.name === 'day') {
    const i = plan.days.findIndex((d) => d.id === route.dayId);
    // La pestaña se conserva: quien mira las reservas quiere las del día de al lado.
    const at = (j: number): Route | null =>
      i >= 0 && plan.days[j] ? { ...route, dayId: plan.days[j].id } : null;
    return { prev: at(i - 1), next: at(i + 1) };
  }

  if (route.name === 'stop') {
    const stops = plan.days.find((d) => d.id === route.dayId)?.waypoints ?? [];
    const i = stops.findIndex((w) => w.id === route.waypointId);
    const at = (j: number): Route | null =>
      i >= 0 && stops[j] ? { ...route, waypointId: stops[j].id } : null;
    return { prev: at(i - 1), next: at(i + 1) };
  }

  return { prev: null, next: null };
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
  /** Tamaño del texto, en % del normal. Todo el estilo va en `rem`. */
  textSize: number;
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
