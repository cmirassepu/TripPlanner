/**
 * Avisos lógicos — §10.2. Aquí está el valor real del validador: la estructura
 * la caza cualquiera, pero que el Teatro Romano cierre los domingos a las 14:00
 * y la llegada prevista sean las 16:20 sólo lo ve algo que sepa contar horas.
 */

import type { TripPayload, Day, Localized, Coords } from '../model/types.ts';
import { computeSchedule, anchorSemantic } from '../core/schedule.ts';
import { isOpenAt, whyClosed } from '../core/hours.ts';
import { checkSpeed, nearestNeighbour, STRAY_COORD_THRESHOLD } from '../core/geo.ts';
import { formatClock, parseClock } from '../core/time.ts';
import { issue, type Issue } from './issues.ts';

/** Umbral de día sobrecargado, en minutos (§10.2). */
const OVERLOADED_DAY = 9 * 60;

export function validatePlan(plan: TripPayload): Issue[] {
  const issues: Issue[] = [];

  for (const day of plan.days) {
    validateDay(plan, day, issues);
  }
  validatePlaces(plan, issues);

  return issues;
}

function validateDay(plan: TripPayload, day: Day, issues: Issue[]): void {
  const schedule = computeSchedule(day);
  const base = `days.${day.id}`;

  if (day.stay && !plan.stays.some((s) => s.id === day.stay)) {
    issues.push(issue('E105', `${base}.stay`, `el stay "${day.stay}" no existe`));
  }

  // La sospecha de coordenadas se mide sobre la biblioteca entera, en
  // validatePlaces, no aquí.
  for (const stop of schedule.stops) {
    const w = stop.waypoint;
    const path = `${base}.waypoints.${w.id}`;
    const place = plan.places[w.place];

    if (!place) {
      issues.push(issue('E102', `${path}.place`, `el sitio "${w.place}" no existe en places`));
      continue;
    }

    // ── Horarios ──
    const verdict = isOpenAt(place.hours, day.date, stop.arrive);
    if (verdict.state === 'unknown' && verdict.reason === 'no-hours') {
      issues.push(
        issue(
          'W214',
          path,
          `${place.name}: horario desconocido, no se puede comprobar la llegada de las ` +
            `${formatClock(stop.arrive)}`,
        ),
      );
    } else if (verdict.state === 'closed') {
      const reason = whyClosed(verdict.windows, stop.arrive);
      const windows = verdict.windows.map((r) => `${r[0]}–${r[1]}`).join(', ') || 'cerrado';
      issues.push(
        issue(
          'W211',
          path,
          reason === 'too-early'
            ? `${place.name}: llegada prevista ${formatClock(stop.arrive)}; no abre hasta ${windows}`
            : `${place.name}: llegada prevista ${formatClock(stop.arrive)}; cierra ${windows}`,
        ),
      );
    }

    // ── Anclas alcanzables ──
    if (w.anchor) {
      const t = parseClock(w.anchor.time);
      if (t === null) {
        issues.push(issue('E112', `${path}.anchor.time`, `hora inválida "${w.anchor.time}"`));
      } else {
        const semantic = anchorSemantic(w.anchor);
        const actual = semantic === 'departBy' ? stop.leave : stop.arrive;
        if (semantic !== 'notBefore' && actual > t) {
          issues.push(
            issue(
              'W212',
              `${path}.anchor`,
              `ancla inalcanzable: ${semantic === 'departBy' ? 'salida' : 'llegada'} prevista ` +
                `${formatClock(actual)} frente a ${w.anchor.time}` +
                `${w.anchor.hard ? ' (hard: perderla rompe el día)' : ''}. ` +
                `Faltan ${actual - t} min`,
            ),
          );
        }
      }
    }

    // ── Velocidad del tramo ──
    if (stop.index > 0) {
      const prev = schedule.stops[stop.index - 1];
      const from = plan.places[prev.waypoint.place]?.coords;
      if (from && place.coords) {
        const speed = checkSpeed(from, place.coords, w.travelFrom, w.travelMode ?? 'walking');
        if (speed?.implausible) {
          issues.push(
            issue(
              'W231',
              `${path}.travelFrom`,
              `${w.travelFrom} min para ${(speed.metres / 1000).toFixed(2)} km en modo ` +
                `${speed.mode} son ${speed.kmh === Infinity ? '∞' : speed.kmh.toFixed(1)} km/h, ` +
                `por encima del máximo plausible (${speed.limit} km/h)`,
            ),
          );
        }
      }
    }
  }

  // ── Día sobrecargado ──
  const load = schedule.end - schedule.startTime;
  if (load > OVERLOADED_DAY) {
    issues.push(
      issue(
        'W213',
        base,
        `${Math.floor(load / 60)} h ${load % 60} min de contenido entre ${day.startTime} y ` +
          `${formatClock(schedule.end)}. Por encima de las ${OVERLOADED_DAY / 60} h`,
      ),
    );
  }

  checkLocalized(plan, day.title, `${base}.title`, issues);
  checkLocalized(plan, day.intro, `${base}.intro`, issues);
}

function validatePlaces(plan: TripPayload, issues: Issue[]): void {
  // Se comprueba sobre la biblioteca entera, no día a día: una coordenada
  // alucinada está mal aunque su parada acabe de caerse del itinerario, y a la
  // siguiente reutilización del sitio vuelve a colarse.
  //
  // El criterio es el vecino más próximo, no la distancia al centro. Un viaje
  // Bangkok–Chiang Mai son dos grupos a 580 km y ninguno es sospechoso, porque
  // cada sitio tiene compañía cerca; sólo canta el que se queda solo.
  const located = Object.values(plan.places).filter(
    (p): p is typeof p & { coords: Coords } => Array.isArray(p.coords),
  );

  for (const place of located) {
    const others = located.filter((o) => o.id !== place.id).map((o) => o.coords);
    const nearest = nearestNeighbour(place.coords, others);
    if (nearest !== null && nearest > STRAY_COORD_THRESHOLD) {
      issues.push(
        issue(
          'W230',
          `places.${place.id}.coords`,
          `${place.name} está a ${Math.round(nearest / 1000)} km del sitio más cercano del ` +
            `viaje. Coordenadas sospechosas (${place.coords[0]}, ${place.coords[1]})`,
        ),
      );
    }
  }

  for (const [id, place] of Object.entries(plan.places)) {
    if (!place.coords) {
      issues.push(issue('W232', `places.${id}.coords`, `${place.name}: sin resolver`));
    }

    place.facts?.forEach((fact, i) => {
      const path = `places.${id}.facts[${i}]`;
      if (fact.confidence === 'verified' && !fact.source) {
        issues.push(
          issue('W240', path, `confidence "verified" sin campo source: no hay nada que comprobar`),
        );
      }
      checkLocalized(plan, fact.text, `${path}.text`, issues);
    });
    checkLocalized(plan, place.deep, `places.${id}.deep`, issues);
  }
}

/**
 * Falta traducción sólo si el campo dice algo en algún idioma. Un `deep` con
 * todo a `null` es un campo sin rellenar, no una traducción pendiente, y
 * mezclarlos llenaría el informe de ruido.
 */
function checkLocalized(
  plan: TripPayload,
  value: Localized | null | undefined,
  path: string,
  issues: Issue[],
): void {
  if (!value) return;
  const hasContent = Object.values(value).some((v) => typeof v === 'string' && v.trim().length > 0);
  if (!hasContent) return;

  const missing = plan.languages.filter((lang) => {
    const v = value[lang];
    return typeof v !== 'string' || v.trim().length === 0;
  });

  if (missing.length) {
    issues.push(issue('W250', path, `falta la traducción en ${missing.map((m) => `"${m}"`).join(', ')}`));
  }
}
