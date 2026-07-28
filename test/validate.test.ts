/**
 * El contrato de §10, escrito como test: `sevilla-roto.json` anota dieciséis
 * errores esperados y los dieciséis tienen que salir en UNA sola pasada.
 *
 * Que sea una pasada es el requisito duro. Sin conexión no hay rondas de ida y
 * vuelta con la IA, así que un validador que se pare en el primer error obliga
 * a dieciséis viajes al aeropuerto.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { TripFile, PatchFile, TripPayload } from '../src/model/types.ts';
import { applyPatch } from '../src/patch/apply.ts';
import { validateFile } from '../src/validate/validate.ts';
import { CODES, type Code } from '../src/validate/issues.ts';

const root = new URL('../', import.meta.url);
const load = <T>(name: string): T =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`Prep Docs/${name}`, root)), 'utf8'));

const trip = load<TripFile>('sevilla-test.trip.json');
const patchV2 = load<PatchFile>('sevilla-parche-v2.json');
const roto = load<PatchFile>('sevilla-roto.json');
const journal = load<{ waypoints: Record<string, unknown> }>('sevilla-journal.json');

const journalled = new Set(Object.keys(journal.waypoints));

/** Los códigos que el fixture roto anota como `_espera_*`, leídos del propio archivo. */
function expectedCodes(file: PatchFile): Code[] {
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        const m = /^_espera_([EW]\d{3})$/.exec(k);
        if (m) found.add(m[1]);
        walk(v);
      }
    }
  };
  walk(file);
  return [...found].sort() as Code[];
}

let base: TripPayload;

before(() => {
  // El fixture roto está escrito contra el estado POSTERIOR al parche v2:
  // sus rutas apuntan a waypoints que v2 deja donde están.
  base = applyPatch(trip.payload, patchV2.payload.ops).plan;
});

describe('§10 — el validador, en una sola pasada', () => {
  test('los dieciséis códigos anotados en sevilla-roto.json se disparan a la vez', () => {
    const expected = expectedCodes(roto);
    assert.equal(expected.length, 16, 'el fixture debería anotar 16 códigos');

    const result = validateFile(roto, {
      base,
      appliedVersion: 2,
      journalledWaypoints: journalled,
    });

    const got = new Set(result.issues.map((i) => i.code));
    const missing = expected.filter((c) => !got.has(c));

    assert.deepEqual(missing, [], `no se dispararon: ${missing.map((c) => `${c} (${CODES[c]})`).join(', ')}`);
  });

  test('un error de version no impide revisar el resto del archivo', () => {
    const result = validateFile(roto, { base, appliedVersion: 2, journalledWaypoints: journalled });

    assert.ok(
      result.issues.some((i) => i.code === 'E001'),
      'debería avisar de la versión',
    );
    assert.equal(result.applicable, false, 'y no debe aplicarse');
    assert.ok(
      result.issues.length > 16,
      'pero el resto del archivo se revisa igual: es la única forma de repararlo sin conexión',
    );
  });

  test('el informe se pega tal cual y cada línea se sostiene sola', () => {
    const result = validateFile(roto, { base, appliedVersion: 2, journalledWaypoints: journalled });
    for (const line of result.report.split('\n')) {
      assert.match(line, /^\[[EW]\d{3}\] \S+ → .+/, `línea mal formada: ${line}`);
    }
  });
});

describe('el plan bueno no debe producir ruido', () => {
  test('sevilla-test.trip.json no tiene ni un solo error estructural', () => {
    const result = validateFile(trip, {});
    const errors = result.issues.filter((i) => i.severity === 'error');
    assert.deepEqual(errors, [], `errores inesperados:\n${errors.map((e) => e.code + ' ' + e.path).join('\n')}`);
  });

  test('los conflictos reales del fixture sí salen, y con la ruta exacta', () => {
    const result = validateFile(trip, {});
    const codes = result.issues.map((i) => `${i.code} ${i.path}`);

    assert.ok(codes.includes('W211 days.d01.waypoints.wp-10'), 'Triana cerrada');
    assert.ok(codes.includes('W211 days.d01.waypoints.wp-04'), 'Catedral aún sin abrir');
    assert.ok(codes.includes('W212 days.d01.waypoints.wp-10.anchor'), 'ancla de Triana inalcanzable');
    assert.ok(codes.includes('W213 days.d01'), 'día sobrecargado');
    assert.ok(codes.includes('W214 days.d01.waypoints.wp-06'), 'Venerables sin horario');
  });
});
