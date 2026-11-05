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
import { bookByDate, renderOverview, dayStatus } from '../src/render/overview.ts';

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

  test('sin recursos externos; el único script va dentro de la página', () => {
    assert.doesNotMatch(html, /<link|@import|<script[^>]+src=/);
  });

  test('cada parada se despliega con la ficha de su sitio dentro del día', () => {
    const d = trip.payload.days.find((x) => x.waypoints.length)!;
    const p = trip.payload.places[d.waypoints[0].place];
    const day = html.slice(html.indexOf(`id="${d.id}"`));
    assert.match(day.slice(0, day.indexOf('</ol>')), new RegExp(`<details class="stop"><summary>[^]*${p.name.replace(/[()]/g, '.')}`));
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

  test('lo que queda por reservar sale arriba, con las opciones plegadas', () => {
    const d = trip.payload.days[1];
    const out = renderOverview(trip.payload, {
      toBook: [
        { id: 'late', date: null, title: 'Later thing' },
        {
          id: 'hotel', date: d.date, title: 'Hotel <near> the airport', why: 'Early flight', bookBy: 'now',
          options: [{ name: 'Good', url: 'https://example.com', note: 'EUR 90' }, { name: 'Bad', url: 'javascript:alert(1)' }],
        },
        { id: 'done', date: d.date, title: 'Already booked', status: 'booked' },
      ],
    });
    const top = out.slice(out.indexOf('id="tobook"'), out.indexOf('class="route"'));
    assert.ok(top.length > 0, 'la sección va antes de la ruta');
    assert.ok(top.indexOf('book-hotel') < top.indexOf('book-late'), 'por fecha; sin fecha, al final');
    assert.match(top, /<div class="sortby">Sort by <button type="button" data-sort="by" aria-pressed="true">Book by<\/button>/);
    assert.match(top, /class="bk due" data-by="0000-00-00" data-date="[0-9-]+"/);
    assert.match(top, new RegExp(`href="#${d.id}"`));
    assert.match(top, /Hotel &lt;near&gt; the airport/);
    assert.match(top, /<a class="go" href="https:\/\/example.com" target="_blank" rel="noopener">Book: Good ↗<\/a> <span class="sub">EUR 90<\/span>/);
    assert.match(top, /<details class="opts"><summary>Other options and links \(1\)<\/summary>\s*<ul><li><b>Bad<\/b><\/li>/);
    assert.doesNotMatch(top, /javascript:/);
    assert.doesNotMatch(out, /Already booked/);
    assert.match(out.slice(out.indexOf('id="todo"')), /2 things still to book/);
  });

  test('«book» manda sobre las opciones y no se repite entre ellas', () => {
    const d = trip.payload.days[0];
    const out = renderOverview(trip.payload, {
      toBook: [
        {
          id: 'park', date: d.date, title: 'Park', book: { name: 'Official site', url: 'https://park.example/a' },
          options: [{ name: 'Same page', url: 'https://park.example/a' }, { name: 'Other', url: 'https://park.example/b' }],
        },
        { id: 'ask', date: d.date, title: 'Ask', options: [{ name: 'The hotel desk', note: 'at check-in' }], tips: 'Cash only' },
      ],
    });
    const park = out.slice(out.indexOf('book-park'), out.indexOf('book-ask'));
    assert.match(park, /<a class="go" href="https:\/\/park.example\/a"[^>]*>Book: Official site ↗<\/a>/);
    assert.match(park, /Other options and links \(1\)/);
    assert.doesNotMatch(park, /Same page/);
    const ask = out.slice(out.indexOf('book-ask'), out.indexOf('</section>', out.indexOf('book-ask')));
    assert.match(ask, /<span class="go plain">Book: The hotel desk<\/span> <span class="sub">at check-in<\/span>/);
    assert.match(ask, /<summary>Tips<\/summary>/);
  });

  test('lo que hay que reservar ya va primero, aunque sea para el último día', () => {
    const [d0, d1] = trip.payload.days;
    const out = renderOverview(trip.payload, {
      toBook: [
        { id: 'spot', date: d0.date, title: 'On the spot', bookBy: 'on the spot' },
        { id: 'soon', date: d1.date, title: 'Soon', bookBy: 'now' },
        { id: 'mid', date: d0.date, title: 'Mid', bookByDate: '2000-01-01' },
      ],
    });
    const top = out.slice(out.indexOf('id="tobook"'), out.indexOf('class="route"'));
    const at = (id: string) => top.indexOf(`book-${id}`);
    assert.ok(at('soon') < at('mid') && at('mid') < at('spot'), 'now, luego la fecha dada, luego el día del viaje');
  });

  test('bookByDate entiende el texto libre de «book by»', () => {
    const on = (bookBy: string, date: string | null = '2026-12-25') => bookByDate({ id: 'x', title: 'x', date, bookBy }, '2026-12-19');
    assert.equal(on('now'), '0000-00-00');
    assert.equal(on('ask now'), '0000-00-00');
    assert.equal(on('mid-Nov'), '2026-11-15');
    assert.equal(on('early Dec'), '2026-12-01');
    assert.equal(on('late Nov'), '2026-11-25');
    assert.equal(on('by 1 Dec'), '2026-12-01');
    assert.equal(on('early Jan', '2027-01-07'), '2027-01-01');
    assert.equal(on('mid-Dec', '2027-01-03'), '2026-12-15');
    assert.equal(on('day before'), '2026-12-24');
    assert.equal(on('a few days before'), '2026-12-22');
    assert.equal(on('on arrival'), '2026-12-25');
    assert.equal(on('on the spot'), '2026-12-25');
    assert.equal(on('before the trip', null), '2026-12-18');
    assert.equal(on('', null), null);
    assert.equal(on('whenever', null), null);
    assert.equal(bookByDate({ id: 'x', title: 'x', date: null, bookBy: 'now', bookByDate: '2026-11-20' }), '2026-11-20');
  });
});
