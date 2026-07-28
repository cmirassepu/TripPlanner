/**
 * Vista de día estática — §14, paso 3. La prueba de fuego del modelo.
 *
 * Si el HTML de hoy sale de un archivo de datos, el esquema es correcto. Si hay
 * que forzarlo, el esquema necesita otra vuelta antes de seguir.
 *
 * Dos cosas se pintan aquí y no en el validador porque son de §2.4 y §2.3:
 * lo `unverified` se distingue a simple vista, y los conflictos de horario
 * salen pegados a la parada que los sufre, no en una lista aparte.
 */

import type { TripPayload, Day, Localized, Place, Waypoint } from '../model/types.ts';
import { computeSchedule } from '../core/schedule.ts';
import { isOpenAt, whyClosed, windowsFor } from '../core/hours.ts';
import { formatClock } from '../core/time.ts';
import { STATIC_STYLE } from './style.ts';

export interface RenderOptions {
  /** Idioma principal. El secundario se pinta debajo, en gris. */
  lang?: string;
  secondary?: string | null;
}

export function renderDay(plan: TripPayload, day: Day, opts: RenderOptions = {}): string {
  const lang = opts.lang ?? plan.primaryLanguage ?? 'es';
  const secondary =
    opts.secondary === undefined ? plan.languages.find((l) => l !== lang) ?? null : opts.secondary;

  const schedule = computeSchedule(day);
  const title = pick(day.title, lang) ?? day.id;

  const stops = schedule.stops
    .map((stop) => renderStop(plan, day, stop.waypoint, stop.arrive, stop.leave, lang, secondary))
    .join('\n');

  return `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${STATIC_STYLE}</style>
</head>
<body>
<header class="day">
  <p class="date">${esc(longDate(day.date, lang))} · ${esc(day.type)}</p>
  <h1>${esc(title)}</h1>
  ${bilingual(day.title, lang, secondary, 'h2')}
  <p class="start">Salida ${esc(day.startTime)} · ${schedule.stops.length} paradas · hasta ${esc(formatClock(schedule.end))}</p>
  ${para(day.intro, lang, secondary)}
</header>

<ol class="timeline">
${stops}
</ol>
</body>
</html>`;
}

/** Estado y botones los inyecta la app; el HTML exportado no los usa. */
export interface StopExtras {
  /** Clase de estado del registro: `done`, `skipped`, `current`. */
  status?: string;
  /** HTML de acciones, ya escapado por quien lo genera. */
  actions?: string;
}

export function renderStop(
  plan: TripPayload,
  day: Day,
  w: Waypoint,
  arrive: number,
  leave: number,
  lang: string,
  secondary: string | null,
  extras: StopExtras = {},
): string {
  const place: Place | undefined = plan.places[w.place];
  if (!place) {
    return `<li class="stop broken"><div class="when">${esc(formatClock(arrive))}</div>
      <div class="what"><h3>Sitio desconocido: ${esc(w.place)}</h3></div></li>`;
  }

  const verdict = isOpenAt(place.hours, day.date, arrive);
  let conflict = '';
  if (verdict.state === 'closed') {
    const reason = whyClosed(verdict.windows, arrive);
    const windows = verdict.windows.map((r) => `${r[0]}–${r[1]}`).join(', ') || 'cerrado todo el día';
    conflict = `<p class="conflict">${
      reason === 'too-early'
        ? `Llegas a las ${esc(formatClock(arrive))} y no abre hasta ${esc(windows)}`
        : `Llegas a las ${esc(formatClock(arrive))} y cierra ${esc(windows)}`
    }</p>`;
  } else if (verdict.state === 'unknown' && verdict.reason === 'no-hours') {
    conflict = `<p class="unknown-hours">Horario desconocido: no se ha podido comprobar la llegada</p>`;
  }

  const anchor = w.anchor
    ? `<p class="anchor ${w.anchor.hard ? 'hard' : 'soft'}">${esc(
        pick(w.anchor.label, lang) ?? w.anchor.type,
      )} · ${esc(w.anchor.time)}${w.anchor.hard ? '' : ' (flexible)'}</p>`
    : '';

  const notes = (w.notes ?? [])
    .map(
      (n) =>
        `<li class="note ${esc(n.type)}">${esc(pick(n.text, lang) ?? '')}${
          secondary && pick(n.text, secondary)
            ? `<span class="alt">${esc(pick(n.text, secondary)!)}</span>`
            : ''
        }</li>`,
    )
    .join('');

  const facts = (place.facts ?? [])
    .map(
      (f) =>
        `<li class="fact ${f.confidence}">${esc(pick(f.text, lang) ?? '')}${
          f.confidence === 'unverified'
            ? '<span class="badge">sin verificar</span>'
            : f.source
              ? `<span class="src">${esc(f.source)}</span>`
              : ''
        }</li>`,
    )
    .join('');

  const dog =
    place.dog && plan.travellers?.dogs
      ? `<p class="dog ${place.dog.confidence}">Perro: ${
          place.dog.allowed === true ? 'sí' : place.dog.allowed === false ? 'no' : 'con condiciones'
        }${place.dog.note ? ` · ${esc(pick(place.dog.note, lang) ?? '')}` : ''}${
          place.dog.confidence === 'unverified' ? '<span class="badge">sin verificar</span>' : ''
        }</p>`
      : '';

  const hoursToday = windowsFor(place.hours, day.date);
  const hours = hoursToday
    ? `<span class="hours">${hoursToday.map((r) => `${r[0]}–${r[1]}`).join(', ') || 'cerrado'}</span>`
    : `<span class="hours unknown">horario desconocido</span>`;

  const travel =
    w.travelFrom > 0
      ? `<p class="travel">${w.travelFrom} min ${esc(w.travelMode ?? 'walking')}</p>`
      : '';

  const classes = ['stop', w.priority === 'optional' ? 'optional' : '', extras.status ?? '']
    .filter(Boolean)
    .join(' ');

  return `<li class="${classes}" data-wp="${esc(w.id)}">
  ${travel}
  <div class="when"><strong>${esc(formatClock(arrive))}</strong><span>${w.duration} min</span></div>
  <div class="what">
    <h3>${esc(place.name)}${place.nameLocal && place.nameLocal !== place.name ? ` <span class="local">${esc(place.nameLocal)}</span>` : ''}</h3>
    <p class="meta">${esc(place.category ?? '')} · sale ${esc(formatClock(leave))} ${hours}</p>
    ${anchor}
    ${conflict}
    ${dog}
    ${notes ? `<ul class="notes">${notes}</ul>` : ''}
    ${facts ? `<ul class="facts">${facts}</ul>` : ''}
    ${para(place.deep, lang, secondary, 'deep')}
  </div>
  ${extras.actions ?? ''}
</li>`;
}

/* ── helpers ─────────────────────────────────────────────────────────── */

export function pick(v: Localized | null | undefined, lang: string): string | null {
  if (!v) return null;
  const val = v[lang];
  return typeof val === 'string' && val.trim() ? val : null;
}

function bilingual(
  v: Localized | null | undefined,
  lang: string,
  secondary: string | null,
  tag = 'p',
): string {
  if (!secondary) return '';
  const alt = pick(v, secondary);
  if (!alt || alt === pick(v, lang)) return '';
  return `<${tag} class="alt">${esc(alt)}</${tag}>`;
}

function para(
  v: Localized | null | undefined,
  lang: string,
  secondary: string | null,
  cls = 'intro',
): string {
  const main = pick(v, lang);
  if (!main) return '';
  const alt = secondary ? pick(v, secondary) : null;
  return `<div class="${cls}"><p>${esc(main)}</p>${alt ? `<p class="alt">${esc(alt)}</p>` : ''}</div>`;
}

export function longDate(iso: string, lang: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  try {
    return new Intl.DateTimeFormat(lang, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(y, m - 1, d)));
  } catch {
    return iso;
  }
}

export function esc(s: string): string {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
