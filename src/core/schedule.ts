/**
 * Motor de tiempos — §6.1 y §6.2.
 *
 * Dos ambigüedades de la especificación se resuelven aquí, no en el formato:
 *
 * 1. §6.2 no dice si el `travelFrom` del waypoint anclado cuenta en `necesario`.
 *    Cuenta. Hay que recorrer ese trayecto para llegar al ancla, así que
 *    omitirlo daría holgura de más justo donde más caro es equivocarse.
 *
 * 2. `anchor.type` mezcla semántica con etiqueta (§4.7): `closing`, `booking`
 *    y `transport` significan los tres "hay que llegar antes", `departure`
 *    significa "hay que haber salido" y `opening` significa "no antes de".
 *    Son tres semánticas con cinco nombres. Se derivan en `anchorSemantic()`.
 */

import type { Day, Waypoint, Anchor } from '../model/types.ts';
import { parseClock, type Minutes } from './time.ts';

/** Lo que el ancla restringe de verdad, más allá de cómo se llame. */
export type AnchorSemantic = 'arriveBy' | 'departBy' | 'notBefore';

export function anchorSemantic(a: Anchor): AnchorSemantic {
  switch (a.type) {
    case 'closing':
    case 'booking':
    case 'transport':
      return 'arriveBy';
    case 'departure':
      return 'departBy';
    case 'opening':
      return 'notBefore';
  }
}

export interface ScheduledStop {
  waypoint: Waypoint;
  /** Índice en el día, para mensajes. */
  index: number;
  /** Minutos desde medianoche. */
  arrive: Minutes;
  leave: Minutes;
}

export interface Schedule {
  dayId: string;
  date: string;
  startTime: Minutes;
  stops: ScheduledStop[];
  /** Salida de la última parada. Con esto se mide el día sobrecargado. */
  end: Minutes;
}

/**
 * §6.1 — hora(w[0]) = startTime; hora(w[n]) = hora(w[n-1]) + duration(w[n-1]) + travelFrom(w[n])
 *
 * Ojo: el `travelFrom` de la PRIMERA parada se ignora deliberadamente. El día
 * empieza donde empieza; si el archivo trae un valor ahí, es ruido, no un
 * trayecto previo. Los fixtures de Sevilla lo ponen a 0 de todas formas.
 */
export function computeSchedule(day: Day): Schedule {
  const start = parseClock(day.startTime) ?? 0;
  const stops: ScheduledStop[] = [];
  let cursor = start;

  day.waypoints.forEach((w, i) => {
    const travel = i === 0 ? 0 : numeric(w.travelFrom);
    const dwell = numeric(w.duration);
    const arrive = cursor + travel;
    const leave = arrive + dwell;
    stops.push({ waypoint: w, index: i, arrive, leave });
    cursor = leave;
  });

  return {
    dayId: day.id,
    date: day.date,
    startTime: start,
    stops,
    end: stops.length ? stops[stops.length - 1].leave : start,
  };
}

/** Los tipos malos son problema del validador; el motor no debe explotar por ellos. */
function numeric(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/* ── Holgura (§6.2) ──────────────────────────────────────────────────── */

export type WaypointStatus = 'pending' | 'current' | 'visited' | 'skipped' | 'partial';

/** El registro del usuario. El plan nunca lo escribe (§2.5). */
export type StatusLookup = (waypointId: string) => WaypointStatus;

export interface SlackResult {
  /** Minutos. Negativo = no llegas. */
  slack: Minutes;
  /** El ancla contra la que se mide. `null` = no queda ninguna por delante. */
  anchor: { waypoint: Waypoint; anchor: Anchor; time: Minutes } | null;
  /** Lo que falta por hacer antes del ancla. */
  needed: Minutes;
  /** Lo que queda de reloj. */
  available: Minutes;
  /** Paradas que entran en el cálculo, en orden. */
  pending: Waypoint[];
  /**
   * Anclas cuya hora ya pasó pero cuya parada sigue pendiente: se dejó de
   * pulsar el botón, o el día se torció. No mandan sobre la holgura —un ancla
   * perdida no se recupera— pero se informan una vez. §2.6: diario, no regañina.
   */
  missed: { waypoint: Waypoint; anchor: Anchor; time: Minutes }[];
}

/**
 * Holgura hacia atrás desde la próxima ancla. NO se recalcula el día hacia
 * delante: lo que importa es si llegas al siguiente compromiso, no a qué hora
 * acabarías todo.
 */
export function computeSlack(
  day: Day,
  now: Minutes,
  statusOf: StatusLookup = () => 'pending',
): SlackResult {
  const isOpen = (w: Waypoint) => {
    const s = statusOf(w.id);
    return s === 'pending' || s === 'current';
  };

  // Primera ancla por delante que siga viva y que sea una fecha límite.
  // `notBefore` no es un plazo: llegar pronto no consume holgura, sobra tiempo.
  const missed: SlackResult['missed'] = [];
  let anchorIdx = -1;
  for (let i = 0; i < day.waypoints.length; i++) {
    const w = day.waypoints[i];
    if (!w.anchor || !isOpen(w)) continue;
    if (anchorSemantic(w.anchor) === 'notBefore') continue;
    const t = parseClock(w.anchor.time);
    if (t === null) continue;
    // Ya pasó su hora: se anota y se sigue buscando. Medir la holgura contra un
    // ancla vencida daría un rojo permanente sobre algo que ya no tiene arreglo.
    if (t < now) {
      missed.push({ waypoint: w, anchor: w.anchor, time: t });
      continue;
    }
    anchorIdx = i;
    break;
  }

  if (anchorIdx === -1) {
    return {
      slack: Infinity,
      anchor: null,
      needed: 0,
      available: Infinity,
      pending: [],
      missed,
    };
  }

  const anchored = day.waypoints[anchorIdx];
  const anchor = anchored.anchor!;
  const anchorTime = parseClock(anchor.time)!;
  const semantic = anchorSemantic(anchor);

  // Pendientes ANTES del ancla, más el trayecto hasta ella (ver cabecera).
  const pending: Waypoint[] = [];
  let needed = 0;
  for (let i = 0; i < anchorIdx; i++) {
    const w = day.waypoints[i];
    if (!isOpen(w)) continue;
    pending.push(w);
    needed += numeric(w.duration) + (i === 0 ? 0 : numeric(w.travelFrom));
  }
  needed += numeric(anchored.travelFrom);

  // `departBy` exige haber SALIDO, así que la estancia en el sitio también cuenta.
  if (semantic === 'departBy') needed += numeric(anchored.duration);

  const available = anchorTime - now;
  return {
    slack: available - needed,
    anchor: { waypoint: anchored, anchor, time: anchorTime },
    needed,
    available,
    pending,
    missed,
  };
}
