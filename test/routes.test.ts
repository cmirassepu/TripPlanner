/**
 * Rutas y vecinas: lo que hay a cada lado de la pantalla que se está viendo.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { TripFile } from '../src/model/types.ts';
import { neighbours, parseRoute, routeHash, type Route } from '../src/ui/state.ts';

const root = new URL('../', import.meta.url);
const trip: TripFile = JSON.parse(
  readFileSync(fileURLToPath(new URL('Prep Docs/sevilla-test.trip.json', root)), 'utf8'),
);
const plan = trip.payload;
const tripId = trip.tripId;
const [first, second] = plan.days;

describe('rutas', () => {
  test('cada ruta sobrevive al viaje de ida y vuelta por el hash', () => {
    const routes: Route[] = [
      { name: 'library' },
      { name: 'settings' },
      { name: 'trip', tripId },
      { name: 'day', tripId, dayId: first.id },
      { name: 'stop', tripId, dayId: first.id, waypointId: first.waypoints[0].id },
      { name: 'stay', tripId, dayId: first.id },
    ];
    for (const route of routes) assert.deepEqual(parseRoute(routeHash(route)), route);
  });
});

describe('vecinas', () => {
  test('un día tiene a los lados el día anterior y el siguiente', () => {
    const { prev, next } = neighbours(plan, { name: 'day', tripId, dayId: first.id });
    assert.equal(prev, null, 'el primer día no tiene anterior');
    assert.deepEqual(next, { name: 'day', tripId, dayId: second.id });
  });

  test('una parada tiene a los lados las del mismo día, y no salta de día', () => {
    const stops = first.waypoints;
    const at = (i: number): Route => ({ name: 'stop', tripId, dayId: first.id, waypointId: stops[i].id });

    assert.deepEqual(neighbours(plan, at(1)), { prev: at(0), next: at(2) });
    assert.equal(neighbours(plan, at(0)).prev, null);
    assert.equal(neighbours(plan, at(stops.length - 1)).next, null);
  });

  test('las pantallas sin vecinas no ofrecen ninguna', () => {
    assert.deepEqual(neighbours(plan, { name: 'trip', tripId }), { prev: null, next: null });
    assert.deepEqual(neighbours(plan, { name: 'stay', tripId, dayId: first.id }), { prev: null, next: null });
  });
});
