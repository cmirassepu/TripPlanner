/**
 * §14 paso 3 — la prueba de fuego: el HTML del día sale de un archivo de datos.
 *
 * Si esto pasa, el modelo aguanta. Si hubiera que forzar el esquema para que
 * saliera la guía, el esquema necesitaría otra vuelta antes de seguir.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { TripFile, Day } from '../src/model/types.ts';
import { renderDay } from '../src/render/day.ts';

const root = new URL('../', import.meta.url);
const trip: TripFile = JSON.parse(
  readFileSync(fileURLToPath(new URL('Prep Docs/sevilla-test.trip.json', root)), 'utf8'),
);
const d01: Day = trip.payload.days.find((d) => d.id === 'd01')!;
const html = renderDay(trip.payload, d01);

describe('vista de día', () => {
  test('sale una página completa y autónoma', () => {
    assert.match(html, /^<!doctype html>/);
    assert.doesNotMatch(html, /<script|https?:\/\/[^"']*\.(js|css)/, 'sin dependencias externas');
  });

  test('las once paradas salen con su hora calculada', () => {
    for (const [time, name] of [
      ['09:45', 'Parking Paseo de Colón'],
      ['10:12', 'Real Alcázar de Sevilla'],
      ['12:07', 'Catedral de Sevilla y La Giralda'],
      ['18:27', 'Mercado de Triana'],
    ] as const) {
      assert.ok(html.includes(time), `falta la hora ${time}`);
      assert.ok(html.includes(name), `falta ${name}`);
    }
    assert.equal((html.match(/class="stop/g) ?? []).length, 11);
  });

  test('los conflictos salen pegados a su parada, no en una lista aparte', () => {
    assert.match(html, /You arrive at 18:27 and it closes 09:00–17:00/);
    assert.match(html, /You arrive at 12:07 and it does not open until 14:30–18:00/);
    assert.match(html, /Opening hours unknown/);
  });

  test('§2.4 — lo no verificado se distingue a simple vista', () => {
    assert.match(html, /class="badge">unverified</);
    assert.match(html, /class="fact unverified"/);
  });

  test('es bilingüe: el segundo idioma acompaña al primero', () => {
    assert.match(html, /Seville in one go/);
    assert.match(html, /class="alt"/);
  });

  test('las anclas duras se marcan como tales', () => {
    assert.match(html, /class="anchor hard">Entrada con hora asignada · 10:15/);
    assert.match(html, /class="anchor soft">Salida hacia casa · 19:30 \(flexible\)/);
  });

  test('el HTML escapa lo que viene de los datos', () => {
    const evil = structuredClone(trip.payload);
    evil.places['setas'].name = '<img src=x onerror=alert(1)>';
    const out = renderDay(evil, evil.days.find((d) => d.id === 'd01')!);
    assert.doesNotMatch(out, /<img src=x/);
    assert.match(out, /&lt;img src=x/);
  });
});
