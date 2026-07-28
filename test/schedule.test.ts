/**
 * El objetivo de la sesión: que estos hallazgos los cante el código, no yo.
 *
 * Los tres números vienen de aplicar §6.1 al fixture de Sevilla. Dos de ellos
 * contradicen lo que el propio fixture dice de sí mismo, y esa es justo la
 * razón de escribirlos aquí.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { TripFile, Day } from '../src/model/types.ts';
import { computeSchedule, computeSlack } from '../src/core/schedule.ts';
import { isOpenAt, whyClosed, windowsFor } from '../src/core/hours.ts';
import { formatClock, parseClock, weekdayOf } from '../src/core/time.ts';

const root = new URL('../', import.meta.url);
const trip: TripFile = JSON.parse(
  readFileSync(fileURLToPath(new URL('Prep Docs/sevilla-test.trip.json', root)), 'utf8'),
);

const d01: Day = trip.payload.days.find((d) => d.id === 'd01')!;
const places = trip.payload.places;

const schedule = computeSchedule(d01);
const at = (id: string) => schedule.stops.find((s) => s.waypoint.id === id)!;

describe('§6.1 — horas calculadas desde duraciones', () => {
  test('el 13 de septiembre de 2026 es domingo', () => {
    assert.equal(weekdayOf(d01.date), 'sun');
  });

  test('la línea de tiempo completa del día', () => {
    const actual = schedule.stops.map((s) => `${s.waypoint.id} ${formatClock(s.arrive)}`);
    assert.deepEqual(actual, [
      'wp-01 09:15',
      'wp-02 09:45',
      'wp-03 10:12',
      'wp-04 12:07',
      'wp-05 13:27',
      'wp-06 14:10',
      'wp-07 15:03',
      'wp-08 16:08',
      'wp-09 17:20',
      'wp-10 18:27',
      'wp-11 19:19',
    ]);
  });

  test('día sobrecargado: más de 9 h entre salida y última parada', () => {
    const total = schedule.end - schedule.startTime;
    assert.equal(formatClock(schedule.end), '19:29');
    assert.ok(total > 9 * 60, `esperaba >9 h, salieron ${total} min`);
  });
});

describe('conflictos de horario que el fixture debe provocar', () => {
  test('Mercado de Triana: llegada 18:27, los domingos cierra a las 17:00', () => {
    const stop = at('wp-10');
    assert.equal(formatClock(stop.arrive), '18:27');

    const verdict = isOpenAt(places['mercado-triana'].hours, d01.date, stop.arrive);
    assert.equal(verdict.state, 'closed');
    assert.equal(whyClosed((verdict as { windows: [string, string][] }).windows, stop.arrive), 'too-late');
    assert.deepEqual(windowsFor(places['mercado-triana'].hours, d01.date), [['09:00', '17:00']]);
  });

  test('Catedral: llegada 12:07, los domingos NO abre hasta las 14:30', () => {
    // No declarado en `testNotes`. El fixture solo admite el conflicto de Triana.
    const stop = at('wp-04');
    assert.equal(formatClock(stop.arrive), '12:07');

    const verdict = isOpenAt(places['catedral-giralda'].hours, d01.date, stop.arrive);
    assert.equal(verdict.state, 'closed');
    assert.equal(whyClosed((verdict as { windows: [string, string][] }).windows, stop.arrive), 'too-early');
  });

  test('Venerables: horario desconocido, no se puede comprobar', () => {
    const stop = at('wp-06');
    const verdict = isOpenAt(places['venerables'].hours, d01.date, stop.arrive);
    assert.deepEqual(verdict, { state: 'unknown', reason: 'no-hours' });
  });
});

describe('§6.2 — holgura hacia atrás desde la próxima ancla', () => {
  test('Alcázar: 3 min de margen sobre la entrada de las 10:15, no 18', () => {
    // El `note` de wp-03 dice «llegada prevista 09:57… margen de 18 minutos».
    // Ese cálculo se dejó fuera los 15 min de aparcar de wp-02.
    const stop = at('wp-03');
    assert.equal(formatClock(stop.arrive), '10:12');

    const slack = computeSlack(d01, parseClock(d01.startTime)!);
    assert.equal(slack.anchor?.waypoint.id, 'wp-03');
    assert.equal(slack.anchor?.anchor.type, 'booking');
    assert.equal(slack.slack, 3);
  });

  test('un ancla vencida no manda sobre la holgura, pero se informa', () => {
    // A las 14:00 sin haber marcado nada, la entrada del Alcázar (10:15) ya
    // pasó. Medir contra ella daría un rojo permanente e irreparable.
    const slack = computeSlack(d01, parseClock('14:00')!);
    assert.equal(slack.anchor?.waypoint.id, 'wp-10');
    assert.deepEqual(
      slack.missed.map((m) => m.waypoint.id),
      ['wp-03'],
    );
  });

  test('marcar paradas como saltadas devuelve tiempo al bote', () => {
    // El bucle de §6.3: veo el problema, suelto una parada, se arregla.
    const now = parseClock('14:00')!;
    const dropped = new Set(['wp-06', 'wp-08']);

    const before = computeSlack(d01, now);
    const after = computeSlack(d01, now, (id) => (dropped.has(id) ? 'skipped' : 'pending'));

    // Venerables (35+3) y Casa de Pilatos (60+20) suman 118 min exactos.
    assert.equal(after.slack - before.slack, 118);
    assert.ok(after.slack > before.slack);
  });
});
