/**
 * §4.9 y §9.3 — parches, rutas por id y el diff en lenguaje llano.
 *
 * El parche v2 arregla lo que dice su etiqueta y deja intacto lo que no
 * menciona. Comprobar las dos mitades importa igual: un validador que se fía
 * del `label` no sirve de nada.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { TripFile, PatchFile } from '../src/model/types.ts';
import { applyPatch } from '../src/patch/apply.ts';
import { formatDiff } from '../src/patch/diff.ts';
import { resolvePath } from '../src/patch/paths.ts';
import { computeSchedule } from '../src/core/schedule.ts';
import { isOpenAt } from '../src/core/hours.ts';
import { formatClock } from '../src/core/time.ts';
import { validateFile } from '../src/validate/validate.ts';

const root = new URL('../', import.meta.url);
const load = <T>(n: string): T =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`Prep Docs/${n}`, root)), 'utf8'));

const trip = load<TripFile>('sevilla-test.trip.json');
const patchV2 = load<PatchFile>('sevilla-parche-v2.json');
const journal = load<{ waypoints: Record<string, unknown> }>('sevilla-journal.json');
const journalled = new Set(Object.keys(journal.waypoints));

describe('§4.9 — rutas por id, nunca por índice', () => {
  test('un segmento numérico se rechaza aunque el índice exista', () => {
    const r = resolvePath(trip.payload, 'days.d01.waypoints.2');
    assert.equal(r.ok, false);
    assert.equal((r as { code: string }).code, 'E120');
  });

  test('un id que no existe se distingue de una ruta mal formada', () => {
    const r = resolvePath(trip.payload, 'days.d99.startTime');
    assert.equal(r.ok, false);
    assert.equal((r as { code: string }).code, 'E103');
  });

  test('resuelve waypoints por id dentro del array', () => {
    const r = resolvePath(trip.payload, 'days.d01.waypoints.wp-10.duration');
    assert.equal(r.ok, true);
    assert.equal((r as { value: unknown }).value, 40);
  });
});

describe('el parche v2 hace lo que dice su etiqueta', () => {
  const applied = applyPatch(trip.payload, patchV2.payload.ops, {
    journalledWaypoints: journalled,
  });

  test('Triana pasa a las 15:15 y entra dentro de horario', () => {
    const day = applied.plan.days.find((d) => d.id === 'd01')!;
    const stop = computeSchedule(day).stops.find((s) => s.waypoint.place === 'mercado-triana')!;

    assert.equal(formatClock(stop.arrive), '15:15');
    const verdict = isOpenAt(applied.plan.places['mercado-triana'].hours, day.date, stop.arrive);
    assert.equal(verdict.state, 'open');
  });

  test('el día deja de estar sobrecargado', () => {
    const day = applied.plan.days.find((d) => d.id === 'd01')!;
    const s = computeSchedule(day);
    assert.equal(formatClock(s.end), '17:27');
    assert.ok(s.end - s.startTime < 9 * 60);
  });

  test('pero la Catedral sigue rota, y el validador no se fía de la etiqueta', () => {
    const result = validateFile(patchV2, {
      base: trip.payload,
      appliedVersion: 1,
      journalledWaypoints: journalled,
    });
    const catedral = result.issues.find(
      (i) => i.code === 'W211' && i.path === 'days.d01.waypoints.wp-04',
    );
    assert.ok(catedral, 'el conflicto de la Catedral debe sobrevivir al parche');
    assert.match(catedral!.message, /11:52/);
  });

  test('reutilizar el id wp-10 tras eliminarlo se avisa: el registro se indexa por id', () => {
    const reuse = applied.issues.find((i) => i.code === 'W262');
    assert.ok(reuse, 'debería avisar de la reutilización');
    assert.match(reuse!.message, /wp-10/);
  });

  test('eliminar una parada con datos del usuario se avisa antes de aplicar', () => {
    const w260 = applied.issues.filter((i) => i.code === 'W260');
    assert.equal(w260.length, 1);
    assert.match(w260[0].message, /wp-10/);
  });

  test('no se avisa de travelFrom obsoleto si el propio parche lo corrige', () => {
    // v2 elimina wp-08 y acto seguido pone wp-09.travelFrom a 25. Eso está bien
    // hecho y no debe generar ruido; los otros dos removes sí lo dejan sin tocar.
    const stale = applied.issues.filter((i) => i.code === 'W261').map((i) => i.path);
    assert.ok(!stale.some((p) => p.endsWith('wp-09')), `no esperaba W261 en wp-09: ${stale}`);
  });
});

describe('§9.3 — el diff se lee de un vistazo', () => {
  const applied = applyPatch(trip.payload, patchV2.payload.ops, {
    journalledWaypoints: journalled,
  });
  const diff = formatDiff(applied.changes, trip.payload, patchV2.label, patchV2.version, {
    journalledWaypoints: journalled,
  });

  test('habla de sitios y días, no de rutas ni de JSON', () => {
    assert.match(diff, /Domingo 13: salida 09:15 → 09:00/);
    assert.match(diff, /− Domingo 13: se elimina Hospital de los Venerables/);
    assert.match(diff, /\+ Domingo 13: se añade Mercado de Triana \(40 min\)/);
    assert.doesNotMatch(diff, /days\.d01/, 'ninguna ruta interna debe asomar');
  });

  test('cada línea nombra la parada afectada, no sólo el día', () => {
    assert.match(diff, /Domingo 13 · Setas de Sevilla: trayecto 12 → 25 min/);
  });

  test('dice cuántos datos tuyos toca, que es lo que decide si aplicas', () => {
    assert.match(diff, /Tus datos: 6 paradas marcadas, 1 afectada/);
  });
});
