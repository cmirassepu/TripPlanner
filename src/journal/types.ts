/**
 * El registro del usuario — §5.
 *
 * Vive aparte del plan. La IA nunca lo escribe y los parches nunca lo tocan
 * (§2.5). Si una parada desaparece del plan, su registro queda huérfano pero no
 * se borra: es el único dato del sistema que no se puede regenerar.
 */

import type { Coords } from '../model/types.ts';

export type WaypointStatus = 'pending' | 'current' | 'visited' | 'skipped' | 'partial';

export interface WaypointRecord {
  status: WaypointStatus;
  /** ISO 8601 con offset, siempre (§6.4). */
  arrivedAt?: string;
  leftAt?: string;
  /** Momento del salto, cuando no se llegó a entrar. */
  at?: string;
  note?: string;
  /**
   * Por qué se saltó. NO se pregunta: se deduce del estado en ese instante
   * (§5.1). Sólo el cansancio necesita que alguien lo diga, y para eso está
   * el cierre del día.
   */
  skipReason?: SkipReason;
}

/** `time` = no daba tiempo · `closed` = fuera de horario · `choice` = se decidió. */
export type SkipReason = 'time' | 'closed' | 'choice';

export interface ImprovisedWaypoint {
  id: string;
  dayId: string;
  name: string;
  /** Del GPS, porque estás allí. Por eso no pueden estar alucinadas (§7.1). */
  coords: Coords | null;
  at: string;
  note?: string;
  /** Ruta relativa dentro del paquete `.trip`, no base64 (§11.2). */
  photo?: string;
}

export interface DayRecord {
  /** Silencia los avisos y pasa a registrar en silencio (§7.2). */
  freeMode: boolean;
  closingNote: string;
}

export interface Journal {
  tripId: string;
  waypoints: Record<string, WaypointRecord>;
  improvised: ImprovisedWaypoint[];
  days: Record<string, DayRecord>;
}

export function emptyJournal(tripId: string): Journal {
  return { tripId, waypoints: {}, improvised: [], days: {} };
}
