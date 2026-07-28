/**
 * §11 — librería y paquete `.trip`.
 *
 * La prueba que de verdad importa aquí es que el zip lo abra `unzip`, no que
 * lo abra mi propio lector: un formato que sólo entiende quien lo escribió no
 * es un formato.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { TripFile, PatchFile } from '../src/model/types.ts';
import type { Journal } from '../src/journal/types.ts';
import { buildManifest, bundleEntries, exportTrip } from '../src/export/bundle.ts';
import { crc32 } from '../src/export/zip.ts';
import { summarise, statusOfTrip, sortForLibrary } from '../src/library/library.ts';
import { applyPatch } from '../src/patch/apply.ts';

const root = new URL('../', import.meta.url);
const load = <T>(n: string): T =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`Prep Docs/${n}`, root)), 'utf8'));

const trip = load<TripFile>('sevilla-test.trip.json');
const patchV2 = load<PatchFile>('sevilla-parche-v2.json');
const journal = load<Journal>('sevilla-journal.json');

const input = {
  plan: trip.payload,
  journal,
  history: [trip, patchV2],
  media: { 'imp-01.jpg': new TextEncoder().encode('no es una foto de verdad') },
  version: 2,
  exported: '2026-09-15T10:00:00Z',
};

describe('§11.2 — el paquete .trip', () => {
  test('tiene la estructura de la especificación', () => {
    const paths = bundleEntries(input).map((e) => e.path);
    assert.deepEqual(paths, [
      'manifest.json',
      'plan.json',
      'journal.json',
      'history/001-v1-trip.json',
      'history/002-v2-patch.json',
      'media/imp-01.jpg',
    ]);
  });

  test('el manifiesto trae lo que la IA necesita para planificar el siguiente viaje', () => {
    const m = buildManifest(input);
    assert.equal(m.tripId, 'sevilla-prueba-2026');
    assert.equal(m.stats.visited, 4);
    assert.equal(m.stats.skipped, 1);
    assert.equal(m.stats.partial, 1);
    assert.equal(m.stats.improvised, 1);
    // El multiplicador de ritmo es el dato que mejora la planificación (§5.2).
    assert.ok(typeof m.stats.paceFactor === 'number');
  });

  test('las marcas huérfanas se listan, no se pierden en silencio', () => {
    const patched = applyPatch(trip.payload, [
      { op: 'remove', path: 'days.d01.waypoints.wp-05' },
    ]).plan;
    const m = buildManifest({ ...input, plan: patched });
    assert.deepEqual(m.stats.orphanedRecords, ['wp-05']);
  });

  test('el zip lo abre unzip, no sólo nosotros', () => {
    const zip = exportTrip(input);
    const dir = mkdtempSync(join(tmpdir(), 'trip-'));
    const file = join(dir, 'sevilla.trip');
    writeFileSync(file, zip);

    // -t comprueba integridad y CRC de cada entrada.
    const check = execFileSync('unzip', ['-t', file], { encoding: 'utf8' });
    assert.match(check, /No errors detected/);

    execFileSync('unzip', ['-q', file, '-d', join(dir, 'out')]);
    const extracted = readdirSync(join(dir, 'out')).sort();
    assert.deepEqual(extracted, ['history', 'journal.json', 'manifest.json', 'media', 'plan.json']);

    const back = JSON.parse(readFileSync(join(dir, 'out', 'journal.json'), 'utf8'));
    assert.deepEqual(back, journal, 'el registro tiene que volver idéntico');
  });

  test('el CRC32 es el estándar, comprobado contra un vector conocido', () => {
    assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  });
});

describe('§11.1 — la librería', () => {
  test('un viaje pasa a terminado cuando pasa su endDate', () => {
    assert.equal(statusOfTrip(trip.payload, '2026-09-01'), 'upcoming');
    assert.equal(statusOfTrip(trip.payload, '2026-09-13'), 'active');
    assert.equal(statusOfTrip(trip.payload, '2026-09-14'), 'active');
    assert.equal(statusOfTrip(trip.payload, '2026-09-15'), 'finished');
  });

  test('resume paradas visitadas frente a planificadas', () => {
    const s = summarise(trip.payload, journal, '2026-09-13');
    assert.equal(s.status, 'active');
    assert.equal(s.currentDay, 1);
    assert.equal(s.planned, 13);
    // `partial` cuenta como visitada: se estuvo allí, aunque fuera poco rato.
    assert.equal(s.visited, 5);
    assert.equal(s.skipped, 1);
  });

  test('el activo va primero, que es el que se abre a diario', () => {
    const finished = summarise(trip.payload, journal, '2026-10-01');
    const active = summarise(trip.payload, journal, '2026-09-13');
    const upcoming = summarise(trip.payload, journal, '2026-01-01');

    const order = sortForLibrary([finished, upcoming, active]).map((t) => t.status);
    assert.deepEqual(order, ['active', 'upcoming', 'finished']);
  });
});
