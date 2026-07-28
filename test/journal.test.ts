/**
 * §5 y §7 — el registro del usuario.
 *
 * La prueba que más importa es la última: un parche puede reescribir el día
 * entero y el registro sigue intacto. Ese es §2.5 y es la razón de que el
 * registro viva aparte.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { TripFile, PatchFile, Day } from '../src/model/types.ts';
import type { Journal } from '../src/journal/types.ts';
import { emptyJournal } from '../src/journal/types.ts';
import {
  arrive,
  depart,
  skip,
  unmark,
  annotate,
  improvise,
  setFreeMode,
  closeDay,
  statusOf,
  canTransition,
  orphans,
  pace,
  minutesBetween,
} from '../src/journal/journal.ts';
import { inferSkipReason, alertFor, plannedDurations, planWaypointIds } from '../src/journal/infer.ts';
import { applyPatch } from '../src/patch/apply.ts';
import { parseClock } from '../src/core/time.ts';

const root = new URL('../', import.meta.url);
const load = <T>(n: string): T =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`Prep Docs/${n}`, root)), 'utf8'));

const trip = load<TripFile>('sevilla-test.trip.json');
const patchV2 = load<PatchFile>('sevilla-parche-v2.json');
const fixture = load<Journal>('sevilla-journal.json');
const d01: Day = trip.payload.days.find((d) => d.id === 'd01')!;

/** Reloj de mentira: las pruebas no pueden depender de la hora real. */
const at = (hhmm: string) => () => `2026-09-13T${hhmm}:00+02:00`;

describe('§5.1 — estados del waypoint', () => {
  test('las transiciones legales son las del diagrama', () => {
    assert.ok(canTransition('pending', 'current'));
    assert.ok(canTransition('current', 'visited'));
    assert.ok(canTransition('current', 'partial'));
    assert.ok(canTransition('pending', 'skipped'));
    // Volver a pending siempre se puede: marcar por error es lo normal.
    assert.ok(canTransition('visited', 'pending'));
    assert.ok(!canTransition('skipped', 'visited'));
  });

  test('llegar y salir marca visitado con sus dos horas', () => {
    let j = emptyJournal('sevilla-prueba-2026');
    j = arrive(j, 'wp-03', at('10:20'));
    assert.equal(statusOf(j, 'wp-03'), 'current');

    j = depart(j, 'wp-03', 105, at('12:05'));
    assert.equal(statusOf(j, 'wp-03'), 'visited');
    assert.equal(minutesBetween(j.waypoints['wp-03'].arrivedAt!, j.waypoints['wp-03'].leftAt!), 105);
  });

  test('quedarse mucho menos de lo previsto es `partial`, ni visitado ni saltado', () => {
    let j = emptyJournal('t');
    j = arrive(j, 'wp-04', at('12:15'));
    j = depart(j, 'wp-04', 75, at('12:40')); // 25 min de 75 previstos
    assert.equal(statusOf(j, 'wp-04'), 'partial');
  });

  test('sólo hay una parada `current`: llegar a la siguiente cierra la anterior', () => {
    let j = emptyJournal('t');
    j = arrive(j, 'wp-03', at('10:12'));
    j = arrive(j, 'wp-04', at('12:07'));
    assert.equal(statusOf(j, 'wp-03'), 'visited');
    assert.equal(statusOf(j, 'wp-04'), 'current');
  });

  test('desmarcar conserva la nota, que es lo que costó escribir', () => {
    let j = emptyJournal('t');
    j = annotate(j, 'wp-05', 'El punto azul saltaba entre callejones');
    j = arrive(j, 'wp-05', at('13:27'));
    j = unmark(j, 'wp-05');
    assert.equal(statusOf(j, 'wp-05'), 'pending');
    assert.equal(j.waypoints['wp-05'].note, 'El punto azul saltaba entre callejones');
  });
});

describe('§5.1 — los motivos de salto se deducen, no se preguntan', () => {
  const done = (ids: string[]): Journal => {
    let j = emptyJournal('t');
    for (const id of ids) {
      j = arrive(j, id, at('09:00'));
      j = depart(j, id, 0, at('09:00'));
    }
    return j;
  };

  test('fuera de horario → cierre', () => {
    // Triana: llegada 18:27, cierra a las 17:00 los domingos.
    const reason = inferSkipReason(trip.payload, d01, 'wp-10', parseClock('18:00')!, done([]));
    assert.equal(reason, 'closed');
  });

  test('sin holgura → tiempo', () => {
    const j = done(['wp-01', 'wp-02', 'wp-03', 'wp-04']);
    const reason = inferSkipReason(trip.payload, d01, 'wp-08', parseClock('14:30')!, j);
    assert.equal(reason, 'time');
  });

  test('con holgura y abierto → elección', () => {
    // A las 09:15 en punto quedan los 3 min de margen del Alcázar: holgura
    // positiva. Cinco minutos más tarde ya sería 'time', que es justo lo
    // ajustado que va este día.
    const j = done(['wp-01']);
    const reason = inferSkipReason(trip.payload, d01, 'wp-05', parseClock('09:15')!, j);
    assert.equal(reason, 'choice');
  });
});

describe('§7 — improvisación y modo libre', () => {
  test('un waypoint improvisado pide sólo el nombre; lo demás sale del aparato', () => {
    let j = emptyJournal('t');
    j = improvise(
      j,
      { dayId: 'd01', name: 'Puesto de altramuces', coords: [37.3903, -5.9905] },
      at('13:50'),
    );
    assert.equal(j.improvised.length, 1);
    assert.equal(j.improvised[0].id, 'imp-01');
    assert.equal(j.improvised[0].at, '2026-09-13T13:50:00+02:00');
    // Va al registro, nunca al plan.
    assert.equal(trip.payload.days[0].waypoints.some((w) => w.id === 'imp-01'), false);
  });

  test('el modo libre silencia TODOS los avisos, incluido el rojo', () => {
    let j = emptyJournal('t');
    j = arrive(j, 'wp-01', at('09:15'));

    const before = alertFor(d01, parseClock('16:30')!, j, trip.payload);
    assert.equal(before?.level, 'red', 'sin modo libre debería estar en rojo');

    j = setFreeMode(j, 'd01', true);
    assert.equal(alertFor(d01, parseClock('16:30')!, j, trip.payload), null);

    // Al desactivarlo, recalcula desde el estado real: no hay castigo por volver.
    j = setFreeMode(j, 'd01', false);
    assert.equal(alertFor(d01, parseClock('16:30')!, j, trip.payload)?.level, 'red');
  });

  test('el cierre del día es el único sitio donde se pregunta algo', () => {
    const j = closeDay(emptyJournal('t'), 'd01', 'Se nos fue la mañana en el Alcázar');
    assert.match(j.days['d01'].closingNote, /Alcázar/);
  });
});

describe('§5.2 — ritmo', () => {
  test('compara lo estimado con lo real y saca un multiplicador', () => {
    const p = pace(fixture, plannedDurations(trip.payload));
    assert.ok(p, 'el fixture tiene paradas con entrada y salida');
    assert.equal(p!.sample, 4);
    assert.ok(p!.factor > 0);
    // Aritmética, no adivinación: el factor es real ÷ estimado.
    assert.equal(p!.factor, Math.round((p!.actual / p!.estimated) * 100) / 100);
  });

  test('sin paradas cerradas no inventa un número', () => {
    assert.equal(pace(emptyJournal('t'), plannedDurations(trip.payload)), null);
  });
});

describe('§2.5 — el plan y el registro nunca se pisan', () => {
  test('un parche reescribe el día y no toca ni un byte del registro', () => {
    const before = JSON.stringify(fixture);
    const result = applyPatch(trip.payload, patchV2.payload.ops, {
      journalledWaypoints: new Set(Object.keys(fixture.waypoints)),
    });

    assert.equal(JSON.stringify(fixture), before, 'el registro debe salir intacto');
    assert.ok(result.plan.days[0].waypoints.length < d01.waypoints.length, 'el plan sí cambió');
  });

  test('las marcas de una parada eliminada quedan huérfanas, pero no se borran', () => {
    const patched = applyPatch(trip.payload, patchV2.payload.ops).plan;
    const left = orphans(fixture, planWaypointIds(patched));

    // v2 elimina wp-06 y wp-08 (sin registro) y reutiliza wp-10 (con registro).
    assert.ok(fixture.waypoints['wp-10'], 'el registro de wp-10 sigue ahí');
    assert.deepEqual(left, [], 'wp-10 se reutilizó, y por eso W262 avisa de ello');
  });

  test('si la parada desaparece de verdad, el registro sobrevive huérfano', () => {
    const gone = applyPatch(trip.payload, [
      { op: 'remove', path: 'days.d01.waypoints.wp-05' },
    ]).plan;
    const left = orphans(fixture, planWaypointIds(gone));
    assert.deepEqual(left, ['wp-05']);
    assert.equal(fixture.waypoints['wp-05'].status, 'visited');
  });
});
