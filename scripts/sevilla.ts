/**
 * Pasada completa sobre los fixtures de Sevilla. Es la comprobación del
 * objetivo: los hallazgos los canta el código, no la conversación.
 *
 *   npm run sevilla
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { TripFile, PatchFile, TripPayload } from '../src/model/types.ts';
import { applyPatch } from '../src/patch/apply.ts';
import { formatDiff } from '../src/patch/diff.ts';
import { validateFile } from '../src/validate/validate.ts';
import { computeSchedule } from '../src/core/schedule.ts';
import { isOpenAt, whyClosed } from '../src/core/hours.ts';
import { evaluate } from '../src/core/alerts.ts';
import { formatClock, parseClock } from '../src/core/time.ts';
import { renderDay } from '../src/render/day.ts';

const root = new URL('../', import.meta.url);
const load = <T>(name: string): T =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`Prep Docs/${name}`, root)), 'utf8'));

const trip = load<TripFile>('sevilla-test.trip.json');
const patchV2 = load<PatchFile>('sevilla-parche-v2.json');
const roto = load<PatchFile>('sevilla-roto.json');
const journal = load<{ waypoints: Record<string, unknown> }>('sevilla-journal.json');
const journalled = new Set(Object.keys(journal.waypoints));

const rule = (t: string) => `\n\x1b[1m${t}\x1b[0m\n${'─'.repeat(t.length)}`;

/* ── 1. El plan tal cual llega ───────────────────────────────────────── */

console.log(rule('1 · Plan original — línea de tiempo de d01'));

const d01 = trip.payload.days.find((d) => d.id === 'd01')!;
const schedule = computeSchedule(d01);

for (const stop of schedule.stops) {
  const place = trip.payload.places[stop.waypoint.place];
  const v = isOpenAt(place.hours, d01.date, stop.arrive);
  let flag = '';
  if (v.state === 'closed') {
    const why = whyClosed(v.windows, stop.arrive) === 'too-early' ? 'AÚN CERRADO' : 'YA CERRADO';
    flag = `  ← ${why} (${v.windows.map((r) => `${r[0]}–${r[1]}`).join(', ') || 'todo el día'})`;
  } else if (v.state === 'unknown') {
    flag = '  ← horario desconocido';
  }
  const anchor = stop.waypoint.anchor
    ? `  ◆ ${stop.waypoint.anchor.type} ${stop.waypoint.anchor.time}`
    : '';
  console.log(
    `  ${formatClock(stop.arrive)}  ${place.name.padEnd(34)}${anchor}${flag}`,
  );
}
console.log(`  ${formatClock(schedule.end)}  (fin)`);

/* ── 2. Validación del plan ──────────────────────────────────────────── */

console.log(rule('2 · Validador sobre el plan original'));
const planReport = validateFile(trip, {});
console.log(planReport.report);
console.log(`\n  ${planReport.errors} errores · ${planReport.warnings} avisos`);

/* ── 3. Aviso en vivo ────────────────────────────────────────────────── */

console.log(rule('3 · Avisos §6.3, simulando el reloj'));

// La holgura sale del registro, y el registro se va llenando durante el día.
// Se reconstruye el estado a cada hora simulada: una parada sólo cuenta como
// hecha si su marca de tiempo ya ha pasado.
const nameOf = (placeId: string) => trip.payload.places[placeId]?.name ?? placeId;

const statusAt =
  (now: number) =>
  (id: string): 'pending' | 'visited' | 'skipped' | 'partial' | 'current' => {
    const entry = journal.waypoints[id] as { status?: string; leftAt?: string; at?: string };
    if (!entry?.status) return 'pending';
    const stamp = entry.leftAt ?? entry.at;
    if (!stamp) return 'pending';
    const clock = parseClock(stamp.slice(11, 16));
    return clock !== null && clock <= now ? (entry.status as never) : 'pending';
  };

for (const t of ['09:15', '13:00', '14:30', '16:30']) {
  const now = parseClock(t)!;
  const alert = evaluate(d01, now, { statusOf: statusAt(now), nameOf });
  const tag = { green: 'VERDE', amber: 'ÁMBAR', red: 'ROJO' }[alert.level];
  console.log(`  ${t}  ${tag.padEnd(6)} ${alert.message || '(nada visible)'}`);
  if (alert.proposal?.drop.length) {
    console.log(
      `         ↳ holgura ${alert.slack} → ${alert.proposal.slackAfter} min ` +
        `soltando ${alert.proposal.drop.map((w) => w.id).join(', ')}`,
    );
  }
}

/* ── 4. El parche v2 ─────────────────────────────────────────────────── */

console.log(rule('4 · Parche v2 — diff antes de aplicar (§9.3)'));
const applied = applyPatch(trip.payload, patchV2.payload.ops, {
  journalledWaypoints: journalled,
});
console.log(
  formatDiff(applied.changes, trip.payload, patchV2.label, patchV2.version, {
    journalledWaypoints: journalled,
  }),
);

const afterPatch = validateFile(patchV2, {
  base: trip.payload,
  appliedVersion: 1,
  journalledWaypoints: journalled,
});
console.log(`\n  Aplicable: ${afterPatch.applicable ? 'sí' : 'no'}`);
console.log(`  Tras aplicar quedan ${afterPatch.warnings} avisos:`);
console.log(
  afterPatch.issues
    .filter((i) => i.severity === 'warning')
    .map((i) => `    [${i.code}] ${i.path}`)
    .join('\n'),
);

/* ── 5. El archivo roto ──────────────────────────────────────────────── */

console.log(rule('5 · sevilla-roto.json — una sola pasada'));
const base: TripPayload = applied.plan;
const broken = validateFile(roto, { base, appliedVersion: 2, journalledWaypoints: journalled });
console.log(broken.report);
console.log(
  `\n  ${broken.errors} errores · ${broken.warnings} avisos · ` +
    `${new Set(broken.issues.map((i) => i.code)).size} códigos distintos`,
);
console.log(`  Aplicable: ${broken.applicable ? 'sí' : 'no'} — ${broken.blockers.join(' ')}`);

/* ── 6. Render ───────────────────────────────────────────────────────── */

const outDir = fileURLToPath(new URL('out/', root));
mkdirSync(outDir, { recursive: true });
const html = renderDay(trip.payload, d01);
writeFileSync(`${outDir}sevilla-d01.html`, html, 'utf8');

console.log(rule('6 · Render'));
console.log(`  out/sevilla-d01.html — ${(html.length / 1024).toFixed(1)} kB, bilingüe, sin dependencias`);
