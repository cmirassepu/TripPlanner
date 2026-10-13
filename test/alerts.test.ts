/**
 * §6.3 — niveles, histéresis y propuesta de recorte.
 *
 * El caso que más importa es el hueco de la tabla: entre 15 y 25 minutos la
 * especificación no dice nada, y ahí es justo donde una implementación ingenua
 * parpadea.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { TripFile, Day } from '../src/model/types.ts';
import { nextLevel, proposeDrops, evaluate, shouldShow } from '../src/core/alerts.ts';
import { computeSlack } from '../src/core/schedule.ts';
import { parseClock } from '../src/core/time.ts';

const root = new URL('../', import.meta.url);
const trip: TripFile = JSON.parse(
  readFileSync(fileURLToPath(new URL('Prep Docs/sevilla-test.trip.json', root)), 'utf8'),
);
const d01: Day = trip.payload.days.find((d) => d.id === 'd01')!;

describe('§6.3 — histéresis', () => {
  test('la banda 15–25 depende de dónde vengas: eso ES la histéresis', () => {
    // Bajando desde verde, 20 min sigue siendo verde.
    assert.equal(nextLevel('green', 20), 'green');
    // Subiendo desde ámbar, 20 min sigue siendo ámbar hasta cruzar 25.
    assert.equal(nextLevel('amber', 20), 'amber');
    assert.equal(nextLevel('amber', 25), 'green');
  });

  test('el rojo no se limpia hasta pasar de 10, para que no parpadee en el cruce', () => {
    assert.equal(nextLevel('red', -1), 'red');
    assert.equal(nextLevel('red', 5), 'red');
    assert.equal(nextLevel('red', 10), 'red');
    assert.equal(nextLevel('red', 11), 'amber');
  });

  test('el ámbar entra por debajo de 15 vengas de donde vengas', () => {
    assert.equal(nextLevel('green', 14), 'amber');
    assert.equal(nextLevel('green', 15), 'green');
  });

  test('descartar silencia hasta que empeore un escalón, no treinta segundos', () => {
    assert.equal(shouldShow({ level: 'amber', dismissedAt: 'amber' }, 'amber'), false);
    assert.equal(shouldShow({ level: 'amber', dismissedAt: 'amber' }, 'red'), true);
    assert.equal(shouldShow({ level: 'green' }, 'green'), false);
  });
});

describe('§6.3 — el rojo nunca aparece sin proponer la salida', () => {
  const at = (t: string, done: string[] = []) =>
    computeSlack(d01, parseClock(t)!, (id) => (done.includes(id) ? 'visited' : 'pending'));

  test('se sueltan las paradas de menor dropRank hasta que la holgura vuelve a positivo', () => {
    const slack = at('13:00', ['wp-01', 'wp-02', 'wp-03', 'wp-04']);
    assert.ok(slack.slack < 0, 'el escenario debe estar en rojo');

    const proposal = proposeDrops(slack);
    assert.deepEqual(
      proposal.drop.map((w) => w.id),
      ['wp-06', 'wp-08'],
      'venerables (dropRank 1) y Casa de Pilatos (3) son las dos más baratas',
    );
    assert.ok(proposal.slackAfter >= 0);
    assert.equal(proposal.insufficient, false);
  });

  test('nunca propone soltar una parada `key`, aunque tenga dropRank', () => {
    // El fixture da dropRank 8, 9 y 10 a paradas `key`. Manda el `key`.
    const slack = at('16:00', ['wp-01', 'wp-02', 'wp-03', 'wp-04']);
    const proposal = proposeDrops(slack);
    const keys = proposal.drop.filter((w) => w.priority === 'key');
    assert.deepEqual(keys, [], 'no debería tocar ninguna parada clave');
  });

  test('cuando ni soltándolo todo se llega, lo dice en vez de prometer un arreglo', () => {
    const slack = at('16:30', ['wp-01', 'wp-02', 'wp-03', 'wp-04']);
    const proposal = proposeDrops(slack);
    assert.equal(proposal.insufficient, true);

    const alert = evaluate(d01, parseClock('16:30')!, {
      statusOf: (id) => (['wp-01', 'wp-02', 'wp-03', 'wp-04'].includes(id) ? 'visited' : 'pending'),
    });
    assert.equal(alert.level, 'red');
    assert.match(alert.message, /even after dropping everything optional/);
  });

  test('el ámbar de las 09:15 es el margen real de 3 min sobre el Alcázar', () => {
    const alert = evaluate(d01, parseClock('09:15')!, {
      statusOf: (id) => (id === 'wp-01' ? 'visited' : 'pending'),
      nameOf: (id) => trip.payload.places[id]?.name ?? id,
    });
    assert.equal(alert.level, 'amber');
    assert.equal(alert.slack, 3);
    assert.match(alert.message, /3 min/);
  });
});
