/**
 * Aritmética de horas de reloj, en minutos desde medianoche.
 *
 * El plan nunca guarda horas absolutas salvo `day.startTime` y `anchor.time`
 * (§2.2), así que todo lo de aquí opera sobre "HH:MM" dentro de un mismo día.
 * Las zonas horarias se aplican al comparar con el "ahora" real, no aquí.
 */

/** Minutos desde las 00:00. Puede pasar de 1440 si el día se alarga. */
export type Minutes = number;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidClock(s: unknown): s is string {
  return typeof s === 'string' && HHMM.test(s);
}

/** Devuelve `null` en vez de lanzar: los archivos malos son datos, no excepciones. */
export function parseClock(s: unknown): Minutes | null {
  if (!isValidClock(s)) return null;
  const [h, m] = s.split(':');
  return Number(h) * 60 + Number(m);
}

/** Formatea minutos como "HH:MM". Más de 24 h envuelve, pero avisa el llamante. */
export function formatClock(m: Minutes): string {
  const norm = ((Math.round(m) % 1440) + 1440) % 1440;
  const h = Math.floor(norm / 60);
  return `${String(h).padStart(2, '0')}:${String(norm % 60).padStart(2, '0')}`;
}

/** "2 h 15 min", "45 min". Para los mensajes de holgura. */
export function formatDuration(m: Minutes): string {
  const sign = m < 0 ? '−' : '';
  const abs = Math.abs(Math.round(m));
  const h = Math.floor(abs / 60);
  const min = abs % 60;
  if (h === 0) return `${sign}${min} min`;
  if (min === 0) return `${sign}${h} h`;
  return `${sign}${h} h ${min} min`;
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type DayKey = (typeof DAY_KEYS)[number];

/**
 * Día de la semana de una fecha ISO, sin depender de la zona local del
 * dispositivo — que es justo lo que rompería el conflicto del Mercado de
 * Triana según dónde estés al abrir la app.
 */
export function weekdayOf(isoDate: string): DayKey | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return null;
  const [, y, mo, d] = m;
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (Number.isNaN(dt.getTime())) return null;
  return DAY_KEYS[dt.getUTCDay()];
}
