/**
 * Horarios de apertura. Es lo que caza el conflicto del Mercado de Triana
 * y el de la Catedral.
 *
 * Sobre los intervalos que cruzan medianoche: un mercado nocturno con
 * [["20:00","02:00"]] es legítimo, no un error de datos. Tratar cierre < apertura
 * como intervalo invertido rechazaría medio Bangkok. Se interpreta como que
 * sigue abierto al día siguiente.
 */

import type { Hours, TimeRange } from '../model/types.ts';
import { parseClock, weekdayOf, type Minutes } from './time.ts';

export type OpenVerdict =
  | { state: 'open'; window: TimeRange }
  | { state: 'closed'; windows: TimeRange[] }
  /** Ni abierto ni cerrado: no lo sabemos. Nunca se cuenta como conflicto. */
  | { state: 'unknown'; reason: 'no-hours' | 'bad-date' };

/** Ventanas que aplican a una fecha concreta: `byDay` gana sobre `default`. */
export function windowsFor(hours: Hours | null | undefined, isoDate: string): TimeRange[] | null {
  if (!hours) return null;

  if (hours.closedDays?.includes(isoDate)) return [];

  const wd = weekdayOf(isoDate);
  if (wd && hours.byDay && Object.prototype.hasOwnProperty.call(hours.byDay, wd)) {
    return hours.byDay[wd] ?? [];
  }
  return hours.default ?? null;
}

/** ¿Está abierto a las `at` (minutos desde medianoche) en la fecha `isoDate`? */
export function isOpenAt(
  hours: Hours | null | undefined,
  isoDate: string,
  at: Minutes,
): OpenVerdict {
  if (!weekdayOf(isoDate)) return { state: 'unknown', reason: 'bad-date' };

  const windows = windowsFor(hours, isoDate);
  if (windows === null) return { state: 'unknown', reason: 'no-hours' };

  for (const w of windows) {
    if (contains(w, at)) return { state: 'open', window: w };
  }
  return { state: 'closed', windows };
}

/** Un instante cae dentro del intervalo, contando el cruce de medianoche. */
export function contains(window: TimeRange, at: Minutes): boolean {
  const open = parseClock(window[0]);
  const close = parseClock(window[1]);
  if (open === null || close === null) return false;

  // Cierre < apertura => cruza medianoche: abierto desde `open` hasta el `close` del día siguiente.
  if (close < open) return at >= open || at <= close;
  return at >= open && at <= close;
}

/** Distingue "llegas antes de abrir" de "llegas después de cerrar", que se arreglan distinto. */
export type ClosedReason = 'too-early' | 'too-late' | 'closed-all-day';

export function whyClosed(windows: TimeRange[], at: Minutes): ClosedReason {
  if (windows.length === 0) return 'closed-all-day';
  const opens = windows.map((w) => parseClock(w[0])).filter((n): n is number => n !== null);
  if (opens.length && at < Math.min(...opens)) return 'too-early';
  return 'too-late';
}
