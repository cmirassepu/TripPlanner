/**
 * Modelo de datos — §4 de la especificación.
 *
 * Estos tipos describen el formato de archivo TAL Y COMO está especificado.
 * Las ambigüedades detectadas en la revisión (semántica de `anchor.type`,
 * solape entre `priority` y `dropRank`) se resuelven en el motor, no aquí:
 * el formato del archivo no cambia.
 */

/** Texto por idioma. `languages` del viaje dice cuáles se esperan. */
export type Localized = Partial<Record<string, string | null>>;

/** [lat, lng]. `null` si no se ha resuelto todavía (§4.4). */
export type Coords = [number, number];

/** §4.4 — de dónde salen las coordenadas. Las alucinadas son el fallo más caro. */
export type CoordsSource = 'places_api' | 'geocoded' | 'user' | 'unresolved';

export type Confidence = 'verified' | 'unverified';

/** Intervalo ["HH:MM", "HH:MM"]. Si el cierre < apertura, cruza medianoche. */
export type TimeRange = [string, string];

export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface Hours {
  /** `null` = horario desconocido. Distinto de `[]`, que sería "cerrado siempre". */
  default: TimeRange[] | null;
  byDay?: Partial<Record<DayKey, TimeRange[]>>;
  closedDays?: string[];
  note?: Localized | null;
}

export interface Cost {
  adult: number | null;
  child: number | null;
  currency: string;
  note?: Localized | null;
}

export interface Fact {
  text: Localized;
  confidence: Confidence;
  /** Obligatorio cuando `confidence` es `verified` (W240). */
  source?: string | null;
}

/** `partial` = permitido con condiciones; el `note` las explica. */
export type DogAllowed = boolean | 'partial';

export interface DogPolicy {
  allowed: DogAllowed;
  note?: Localized | null;
  confidence: Confidence;
}

export interface Place {
  id: string;
  name: string;
  /** Nombre en escritura local — para enseñárselo al taxista (§4.10). */
  nameLocal?: string | null;
  coords: Coords | null;
  coordsSource: CoordsSource;
  address?: string | null;
  addressLocal?: string | null;
  category?: string | null;
  hours: Hours;
  cost?: Cost | null;
  contact?: { phone?: string | null; url?: string | null } | null;
  /** Vocabulario cerrado (§4.4). Alimenta iconos y filtros. */
  amenities?: string[];
  dog?: DogPolicy | null;
  facts?: Fact[];
  deep?: Localized | null;
  links?: {
    wikipedia?: Localized | null;
    official?: string | null;
    maps?: string | null;
  } | null;
}

export type TravelMode = 'walking' | 'driving' | 'transit' | 'cycling' | 'flight';

export type AnchorType = 'closing' | 'opening' | 'departure' | 'booking' | 'transport';

export interface Anchor {
  type: AnchorType;
  /** "HH:MM" en la zona horaria del día. */
  time: string;
  /** Perderlo rompe el día. Alimenta el nivel rojo del aviso (§4.7). */
  hard: boolean;
  label?: Localized | null;
}

export type NoteType = 'info' | 'warn' | 'dog' | 'access';

export interface Note {
  type: NoteType;
  text: Localized;
}

export interface Waypoint {
  id: string;
  /** Referencia a `places`. Rota => E102. */
  place: string;
  /** Minutos previstos en el sitio. 0 es válido; negativo es E110. */
  duration: number;
  /** Minutos de trayecto DESDE la parada anterior. */
  travelFrom: number;
  travelMode?: TravelMode;
  /** `key` no se recorta. Redundante con `dropRank`; ver nota en el motor. */
  priority?: 'key' | 'normal' | 'optional';
  /** Orden de recorte. Menor = se suelta antes. `null` = no se suelta nunca. */
  dropRank?: number | null;
  anchor?: Anchor | null;
  notes?: Note[];
}

/**
 * `explore` = cadena elástica con anclas → línea de tiempo.
 * `transit` = casi todo anclas duras → cuenta atrás.
 * `open`    = sin plan → solo base, mapa e improvisar.
 */
export type DayType = 'explore' | 'transit' | 'open';

export interface Day {
  id: string;
  /** ISO YYYY-MM-DD. De aquí sale el día de la semana para `hours.byDay`. */
  date: string;
  type: DayType;
  title?: Localized | null;
  timezone?: string | null;
  stay?: string | null;
  /** "HH:MM". La única hora absoluta del plan (§2.2). */
  startTime: string;
  intro?: Localized | null;
  waypoints: Waypoint[];
}

export interface Stay {
  id: string;
  name: string;
  place?: string | null;
  from: string;
  to: string;
  timezone?: string | null;
  confirmation?: string | null;
  notes?: Localized | null;
}

export interface TripPayload {
  title: Localized;
  startDate: string;
  endDate: string;
  defaultTimezone: string;
  languages: string[];
  primaryLanguage: string;
  currency: string;
  travellers?: { adults: number; children: number; dogs: number };
  stays: Stay[];
  places: Record<string, Place>;
  days: Day[];
}

/* ── Sobre común (§4.1) ──────────────────────────────────────────────── */

export type FileKind = 'trip' | 'day' | 'patch' | 'docs';

export interface Envelope<P = unknown> {
  format: 'trip-file';
  formatVersion: number;
  tripId: string;
  kind: FileKind;
  /** Entero creciente por viaje. */
  version: number;
  generated: string;
  label?: string;
  payload: P;
}

export type PatchOp = 'set' | 'remove' | 'insertAfter' | 'insertBefore' | 'merge';

export interface PatchOperation {
  op: PatchOp;
  /** Ruta por id, nunca por índice (§4.9). Un segmento numérico es E120. */
  path: string;
  value?: unknown;
  /** Por qué. Se muestra en el diff. */
  reason?: Localized | null;
}

export interface PatchPayload {
  ops: PatchOperation[];
}

export type TripFile = Envelope<TripPayload>;
export type PatchFile = Envelope<PatchPayload>;
