/**
 * Geometría y plausibilidad de trayectos.
 *
 * La comprobación de velocidad es DELIBERADAMENTE ASIMÉTRICA. Sobre el propio
 * fixture bueno de Sevilla hay tramos a 1,1 · 1,5 · 2,4 km/h: la Catedral con
 * cola, un niño, un rodeo por la sombra. Todos legítimos. Ir demasiado despacio
 * es una ciudad; ir demasiado rápido es un dato equivocado. Solo se avisa de lo
 * segundo, o el archivo correcto se llena de ruido y se deja de mirar.
 */

import type { Coords, TravelMode } from '../model/types.ts';

const R = 6_371_000;

/** Distancia sobre el elipsoide, en metros. */
export function haversine(a: Coords, b: Coords): number {
  const [lat1, lon1] = a.map(toRad) as [number, number];
  const [lat2, lon2] = b.map(toRad) as [number, number];
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const toRad = (d: number) => (d * Math.PI) / 180;

/** Techo por modo, en km/h. Por encima, el dato está mal, no eres rápido. */
const MAX_SPEED: Record<TravelMode, number> = {
  walking: 7,
  cycling: 30,
  driving: 130,
  transit: 200,
  flight: 1000,
};

export interface SpeedCheck {
  metres: number;
  minutes: number;
  kmh: number;
  mode: TravelMode;
  limit: number;
  implausible: boolean;
}

export function checkSpeed(
  from: Coords,
  to: Coords,
  minutes: number,
  mode: TravelMode = 'walking',
): SpeedCheck | null {
  const metres = haversine(from, to);
  const limit = MAX_SPEED[mode] ?? MAX_SPEED.walking;

  // Un trayecto de 0 min sobre una distancia real también es implausible, pero
  // 0 min sobre 0 m es sencillamente la misma parada partida en dos.
  if (minutes <= 0) {
    return metres < 100
      ? null
      : { metres, minutes, kmh: Infinity, mode, limit, implausible: true };
  }

  const kmh = metres / 1000 / (minutes / 60);
  return { metres, minutes, kmh, mode, limit, implausible: kmh > limit };
}

/**
 * Distancia al vecino más cercano del mismo día. Es lo que delata unas
 * coordenadas alucinadas: un sitio de Sevilla que aparece en Madrid queda a
 * 390 km del más próximo, mientras que un aeropuerto a las afueras se queda
 * en 23 km y no molesta.
 */
export function nearestNeighbour(point: Coords, others: Coords[]): number | null {
  if (!others.length) return null;
  return Math.min(...others.map((o) => haversine(point, o)));
}

/** Distancia para leer de un vistazo: «450 m» o «1.2 km». */
export function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres / 10) * 10} m`;
  return `${(metres / 1000).toFixed(metres < 10_000 ? 1 : 0)} km`;
}

/** Umbral de sospecha para coordenadas sueltas, en metros. */
export const STRAY_COORD_THRESHOLD = 50_000;
