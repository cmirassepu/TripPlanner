/**
 * La vista general sale del mismo archivo que la app: si el archivo cambia, la
 * página cambia. Aquí se comprueba con Sevilla que salen los días, los sitios
 * y las reservas, y que nada del archivo se cuela sin escapar.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { TripFile, TripPayload } from '../src/model/types.ts';
import { renderOverview, dayStatus } from '../src/render/overview.ts';

const root = new URL('../', import.meta.url);
const trip: TripFile = JSON.parse(
  readFileSync(fileURLToPath(new URL('Prep Docs/sevilla-test.trip.json', root)), 'utf8'),
);

describe('vista general', () => {
  const html = renderOverview(trip.payload);

  test('cada día tiene su ancla para enlazarlo', () => {
    for (const d of trip.payload.days) assert.match(html, new RegExp(`id="${d.id}"`));
  });

  test('cada sitio sale con su ficha', () => {
    for (const id of Object.keys(trip.payload.places)) assert.match(html, new RegExp(`id="p-${id}"`));
  });

  test('sin scripts ni recursos externos', () => {
    assert.doesNotMatch(html, /<script|<link|@import/);
  });

  test('un día sin paradas está abierto, o en esbozo si tiene la idea escrita', () => {
    const d = { ...trip.payload.days[0], type: 'open' as const, waypoints: [], intro: null };
    assert.equal(dayStatus(d), 'open');
    assert.equal(dayStatus({ ...d, intro: { en: 'Temples in the morning' } }), 'outline');
  });

  test('el texto del archivo se escapa', () => {
    const plan: TripPayload = structuredClone(trip.payload);
    const first = Object.values(plan.places)[0];
    first.name = '<img src=x onerror=alert(1)>';
    first.links = { guide: '"><b>x</b>' };
    const out = renderOverview(plan);
    assert.doesNotMatch(out, /<img src=x/);
    assert.doesNotMatch(out, /<b>x<\/b>/);
    assert.match(out, /Rough Guide: &quot;&gt;&lt;b&gt;x/);
  });

  test('los cambios opcionales salen con su día y marcados en ese día', () => {
    const d = trip.payload.days[0];
    const out = renderOverview(trip.payload, {
      ideas: [{ id: 'x', title: 'Boat <trip>', date: d.date, replaces: 'Lunch', status: 'idea' }],
    });
    assert.match(out, /id="idea-x"/);
    assert.match(out, /Boat &lt;trip&gt;/);
    assert.match(out, /1 optional change</);
  });

  test('las tareas propias encabezan la lista de pendientes', () => {
    const out = renderOverview(trip.payload, { tasks: [{ text: 'Make <the> GPT', when: 'later' }] });
    const todo = out.slice(out.indexOf('id="todo"'));
    assert.match(todo, /<ul class="todo"><li><b>Make &lt;the&gt; GPT<\/b>/);
  });
});
