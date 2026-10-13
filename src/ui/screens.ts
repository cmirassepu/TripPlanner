/**
 * Las pantallas. Cada una devuelve HTML; la app lo pone y engancha los eventos
 * por delegación. Sin framework: son cinco pantallas sobre un estado pequeño, y
 * el bundle se cachea entero, así que cada kilobyte se paga en el aeropuerto.
 */

import type { TripPayload, Day } from '../model/types.ts';
import type { Journal } from '../journal/types.ts';
import type { AppState } from './state.ts';
import { routeHash, today, nowMinutes } from './state.ts';
import { computeSchedule } from '../core/schedule.ts';
import { formatClock, formatDuration } from '../core/time.ts';
import { renderStop, esc, pick, longDate } from '../render/day.ts';
import { statusOf, isFreeMode } from '../journal/journal.ts';
import { alertFor } from '../journal/infer.ts';
import { summarise, sortForLibrary } from '../library/library.ts';
import { formatBytes, installHint } from '../store/install.ts';
import { verdict, type ProbeInfo, type ProbeResult } from '../spike/opfs.ts';

/* ── Cromo ───────────────────────────────────────────────────────────── */

export function installBanner(state: AppState): string {
  if (state.storage.installed) return '';
  return `<div class="install"><strong>Add it to your home screen</strong>${esc(
    installHint(),
  )}</div>`;
}

/* ── Librería (§11.1) ────────────────────────────────────────────────── */

export function libraryScreen(state: AppState): string {
  const todayIso = today(state.clock);

  if (state.plans.length === 0) {
    return `${installBanner(state)}
      <div class="bar"><h1>Trips</h1><a class="chip" href="${routeHash({ name: 'settings' })}">Settings</a></div>
      <p class="empty">No trip loaded yet.<br>Load a trip file to get started.</p>
      ${loadButton()}`;
  }

  const summaries = state.plans.map((p) => ({
    stored: p,
    summary: summarise(p.plan, { tripId: p.tripId, waypoints: {}, improvised: [], days: {} }, todayIso),
  }));

  const rows = sortForLibrary(summaries.map((s) => s.summary))
    .map((s) => {
      const stored = summaries.find((x) => x.summary.title === s.title)!.stored;
      const label = { active: 'under way', upcoming: 'upcoming', finished: 'finished' }[s.status];
      const pct = s.planned ? Math.round((s.visited / s.planned) * 100) : 0;
      return `<li><button class="trip" data-go="${esc(
        routeHash({ name: 'trip', tripId: stored.tripId }),
      )}">
        <span class="tag ${s.status === 'active' ? 'active' : ''}">${label}</span>
        <h3>${esc(s.title)}</h3>
        <p class="meta">${esc(s.startDate)} → ${esc(s.endDate)} · ${s.days} days · ${
          s.visited
        }/${s.planned} stops</p>
        <div class="progress"><i style="width:${pct}%"></i></div>
      </button></li>`;
    })
    .join('');

  return `${installBanner(state)}
    <div class="bar"><h1>Trips</h1><a class="chip" href="${routeHash({ name: 'settings' })}">Settings</a></div>
    <ul class="trips">${rows}</ul>
    ${loadButton()}`;
}

/** §9.1 — un selector de archivos: en iOS abre Archivos, que es donde cae iCloud. */
function loadButton(): string {
  return `<label class="btn ghost">Load trip file<input type="file" accept=".json,application/json" data-act="load-file" hidden></label>`;
}

/* ── Índice del viaje ────────────────────────────────────────────────── */

export function tripScreen(state: AppState): string {
  const plan = state.plan;
  if (!plan) return `<p class="empty">Trip not found.</p>`;
  const todayIso = today(state.clock);
  const tripId = state.route.name === 'trip' ? state.route.tripId : '';

  const rows = plan.days
    .map((d) => {
      const schedule = computeSchedule(d);
      const isToday = d.date === todayIso;
      return `<li><button class="dayrow ${isToday ? 'today' : ''}" data-go="${esc(
        routeHash({ name: 'day', tripId, dayId: d.id }),
      )}">
        <b>${esc(shortDate(d.date))}</b>
        <span>${esc(pick(d.title, plan.primaryLanguage) ?? d.id)}
          <span class="alt"> · ${
            d.waypoints.length
              ? `${d.waypoints.length} ${d.waypoints.length === 1 ? 'stop' : 'stops'} · ${esc(d.startTime)}–${esc(formatClock(schedule.end))}`
              : esc(plan.stays.find((st) => st.id === d.stay)?.name ?? 'Free day')
          }</span>
        </span>
      </button></li>`;
    })
    .join('');

  return `${installBanner(state)}
    <div class="bar"><a class="back" href="#/">‹ Trips</a></div>
    <h1>${esc(pick(plan.title, plan.primaryLanguage) ?? tripId)}</h1>
    <p class="meta">${esc(plan.startDate)} → ${esc(plan.endDate)} · ${esc(plan.defaultTimezone)}</p>
    <ul class="days">${rows}</ul>`;
}

/* ── Día ─────────────────────────────────────────────────────────────── */

export function dayScreen(state: AppState): string {
  const plan = state.plan;
  const journal = state.journal;
  const route = state.route;
  if (!plan || !journal || route.name !== 'day') {
    return `<p class="empty">Day not found.</p>`;
  }

  const day = plan.days.find((d) => d.id === route.dayId);
  if (!day) return `<p class="empty">Day not found.</p>`;

  const lang = plan.primaryLanguage;
  const secondary = plan.languages.find((l) => l !== lang) ?? null;
  const now = nowMinutes(state.clock);
  // El reloj sólo dice algo el día en cuestión: mirar el 23 de diciembre desde
  // octubre no es ir seis horas tarde.
  const isToday = day.date === today(state.clock);
  const free = isFreeMode(journal, day.id);
  const intro = pick(day.intro, lang);

  return `${installBanner(state)}
    <div class="bar">
      <a class="back" href="${esc(routeHash({ name: 'trip', tripId: route.tripId }))}">‹ ${esc(
        pick(plan.title, lang) ?? 'Trip',
      )}</a>
      <button class="chip" data-act="freemode" aria-pressed="${free}">Free mode</button>
    </div>
    <p class="date">${esc(longDate(day.date, lang))}</p>
    <h1>${esc(pick(day.title, lang) ?? day.id)}</h1>
    ${intro ? `<p class="meta">${esc(intro)}</p>` : ''}
    ${isToday ? alertBanner(state, plan, day, journal) : ''}
    ${day.type === 'transit' ? transitPanel(plan, day, isToday ? now : null) : ''}
    ${
      day.waypoints.length
        ? timelineBody(plan, day, journal, lang, secondary)
        : '<p class="empty">Nothing planned yet.</p>'
    }
    <p><button class="btn ghost" data-act="improvise">+ Unplanned stop</button></p>
    ${improvisedList(journal, day)}
    ${stayPanel(plan, day)}`;
}

function alertBanner(state: AppState, plan: TripPayload, day: Day, journal: Journal): string {
  const now = nowMinutes(state.clock);
  const started = parseStart(day.startTime);

  /**
   * Si el día ya ha empezado y no hay ni una parada marcada, la app no sabe
   * dónde estás: creería que quedan por hacer las nueve y gritaría que vas seis
   * horas tarde. Eso es la regañina que prohíbe §2.6, y encima sobre un dato
   * que no tiene. Se pide la única señal que falta en vez de inventarse una.
   */
  const anyMarked = day.waypoints.some((w) => statusOf(journal, w.id) !== 'pending');
  if (!anyMarked && now > started) {
    return `<div class="alert amber">
      <p>Mark where you are and I will tell you if you are on time.</p>
    </div>`;
  }

  const alert = alertFor(day, now, journal, plan, state.alert.level);
  if (!alert || alert.level === 'green' || !alert.message) return '';
  if (state.alert.dismissedAt && rank(alert.level) <= rank(state.alert.dismissedAt)) return '';

  const fix =
    alert.proposal && alert.proposal.drop.length && !alert.proposal.insufficient
      ? `<button class="act" data-act="drop" data-ids="${esc(
          alert.proposal.drop.map((w) => w.id).join(','),
        )}">Skip them</button>`
      : '';

  return `<div class="alert ${alert.level}">
    <p>${esc(alert.message)}</p>
    ${fix}
    <button class="act" data-act="dismiss" data-level="${alert.level}">OK</button>
  </div>`;
}

const rank = (l: string) => ({ green: 0, amber: 1, red: 2 })[l] ?? 0;
const parseStart = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

function timelineBody(
  plan: TripPayload,
  day: Day,
  journal: Journal,
  lang: string,
  secondary: string | null,
): string {
  const schedule = computeSchedule(day);

  const stops = schedule.stops
    .map((stop) => {
      const status = statusOf(journal, stop.waypoint.id);
      const cls =
        status === 'visited' || status === 'partial'
          ? 'done'
          : status === 'skipped'
            ? 'skipped'
            : status === 'current'
              ? 'current'
              : '';

      const actions = `<div class="acts">
        ${button('arrive', stop.waypoint.id, 'Arrived', status === 'current')}
        ${button('visited', stop.waypoint.id, 'Done', status === 'visited' || status === 'partial')}
        ${button('skip', stop.waypoint.id, 'Skip', status === 'skipped')}
        ${status !== 'pending' ? button('unmark', stop.waypoint.id, 'Undo', false) : ''}
      </div>`;

      return renderStop(plan, day, stop.waypoint, stop.arrive, stop.leave, lang, secondary, {
        status: cls,
        actions,
      });
    })
    .join('\n');

  return `<ol class="timeline">${stops}</ol>`;
}

function button(act: string, id: string, label: string, pressed: boolean): string {
  return `<button data-act="${act}" data-wp="${esc(id)}" aria-pressed="${pressed}">${label}</button>`;
}

/**
 * §4.5 — un día `transit` es un reloj además de una lista: arriba el próximo
 * plazo, debajo la línea de tiempo completa, porque la reserva, los asientos y
 * los avisos viven en las notas de cada parada.
 *
 * `now` es `null` si el día no es hoy: entonces no hay cuenta atrás, sólo la
 * hora que manda.
 */
function transitPanel(plan: TripPayload, day: Day, now: number | null): string {
  const lang = plan.primaryLanguage;
  const schedule = computeSchedule(day);

  // Sólo cuentan los plazos. La hora de entrada al hotel no se puede perder.
  const deadlines = schedule.stops.filter(
    (s) => s.waypoint.anchor && s.waypoint.anchor.type !== 'opening',
  );
  if (!deadlines.length) return '';

  const label = (s: (typeof deadlines)[number]) =>
    pick(s.waypoint.anchor!.label, lang) ?? plan.places[s.waypoint.place]?.name ?? s.waypoint.place;
  const big = (text: string) =>
    `<h1 style="font-size:3rem;font-variant-numeric:tabular-nums;margin:.2rem 0">${esc(text)}</h1>`;

  if (now === null) {
    const first = deadlines[0];
    return `<div class="panel">
      <p class="meta">${esc(label(first))}</p>
      ${big(first.waypoint.anchor!.time)}
      <p class="verdict ok">The plan starts at ${esc(day.startTime)}</p>
    </div>`;
  }

  const next = deadlines.find((s) => parseAnchor(s) > now);
  if (!next) {
    return `<div class="panel">
      <p class="meta">${esc(label(deadlines[deadlines.length - 1]))}</p>
      <p class="verdict ok">No deadlines left today.</p>
    </div>`;
  }

  const at = parseAnchor(next);
  const left = at - now;
  const urgent = left <= 30;
  return `<div class="panel">
    <p class="meta">${esc(label(next))}</p>
    ${big(formatDuration(left))}
    <p class="verdict ${urgent ? 'bad' : 'ok'}">${urgent ? 'Go now.' : `Until ${esc(formatClock(at))}`}</p>
  </div>`;
}

/** Dónde se duerme esa noche. En un día libre es lo único seguro que hay. */
function stayPanel(plan: TripPayload, day: Day): string {
  const stay = plan.stays.find((s) => s.id === day.stay);
  if (!stay) return '';

  const lang = plan.primaryLanguage;
  const place = stay.place ? plan.places[stay.place] : undefined;
  const phone = place?.contact?.phone;
  const notes = pick(stay.notes, lang);
  const facts = (place?.facts ?? []).map((f) => `<p>${esc(pick(f.text, lang) ?? '')}</p>`).join('');

  return `<div class="panel">
    <p class="meta">Tonight</p>
    <h3>${esc(stay.name)}</h3>
    <dl>
      ${place?.address ? `<dt>Address</dt><dd>${esc(place.address)}</dd>` : ''}
      ${phone ? `<dt>Phone</dt><dd><a href="tel:${esc(phone)}">${esc(phone)}</a></dd>` : ''}
      ${stay.confirmation ? `<dt>Booking</dt><dd>${esc(stay.confirmation)}</dd>` : ''}
      <dt>Dates</dt><dd>${esc(shortDate(stay.from))} → ${esc(shortDate(stay.to))}</dd>
    </dl>
    ${notes ? `<p>${esc(notes)}</p>` : ''}
    ${facts}
  </div>`;
}

const parseAnchor = (s: { waypoint: { anchor?: { time: string } | null } }): number => {
  const t = s.waypoint.anchor?.time ?? '00:00';
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
};

function improvisedList(journal: Journal, day: Day): string {
  const items = journal.improvised.filter((i) => i.dayId === day.id);
  if (!items.length) return '';
  return `<ul class="days">${items
    .map(
      (i) =>
        `<li class="dayrow"><b>${esc(i.at.slice(11, 16))}</b><span>${esc(i.name)}${
          i.note ? `<span class="alt"> · ${esc(i.note)}</span>` : ''
        }</span></li>`,
    )
    .join('')}</ul>`;
}

/* ── Ajustes y spike (§8.4, §12.3) ───────────────────────────────────── */

export interface SpikeView {
  info: ProbeInfo;
  ranges: ProbeResult | null;
  startedAt: string | null;
  busy: string | null;
}

export function settingsScreen(state: AppState, spike: SpikeView): string {
  const s = state.storage;
  const v = verdict(spike.info, s.persisted, spike.ranges, spike.startedAt);
  const tone = v.startsWith('PASSED') ? 'ok' : v.includes('refused') || v.includes('fails') ? 'bad' : '';

  return `<div class="bar"><a class="back" href="#/">‹ Trips</a><h1>Settings</h1></div>

  <div class="panel">
    <h3>Storage</h3>
    <dl>
      <dt>Installed</dt><dd>${s.installed ? 'yes' : 'no'}</dd>
      <dt>Persistent</dt><dd>${s.persisted ? 'yes' : 'no'}</dd>
      <dt>Used</dt><dd>${formatBytes(s.usage)}</dd>
      <dt>Quota</dt><dd>${formatBytes(s.quota)}</dd>
    </dl>
    ${s.persisted ? '' : '<button class="btn" data-act="persist">Ask for persistent storage</button>'}
  </div>

  <div class="panel">
    <h3>Map storage test</h3>
    <p class="meta">Writes 150 MB, then checks it is still there and can be read in pieces. This decides whether offline maps are possible.</p>
    <dl>
      <dt>File</dt><dd>${spike.info.exists ? formatBytes(spike.info.bytes) : 'none'}</dd>
      <dt>Written</dt><dd>${spike.startedAt ? esc(spike.startedAt.slice(0, 16).replace('T', ' ')) : '—'}</dd>
    </dl>
    <p class="verdict ${tone}">${esc(v)}</p>
    ${
      spike.busy
        ? `<p class="meta">${esc(spike.busy)}</p>`
        : `<button class="btn" data-act="spike-write">Write 150 MB</button>
           <button class="btn ghost" data-act="spike-verify">Check reading</button>
           ${spike.info.exists ? '<button class="btn ghost" data-act="spike-delete">Delete</button>' : ''}`
    }
  </div>

  <div class="panel">
    <h3>Simulated clock</h3>
    <p class="meta">Pretend it is another date and time, to try out the countdowns and warnings before the trip.</p>
    <dl>
      <dt>Date</dt><dd><input type="date" data-act="set-date" value="${esc(state.clock.date ?? '')}"></dd>
      <dt>Time</dt><dd><input type="time" data-act="set-time" value="${esc(state.clock.time ?? '')}"></dd>
    </dl>
    ${state.clock.date || state.clock.time ? '<button class="btn ghost" data-act="clock-reset">Back to the real clock</button>' : ''}
  </div>

  ${
    state.updateReady
      ? `<div class="panel">
    <h3>Update</h3>
    <p class="meta">A new version is waiting. It does not install itself during a trip, because reloading mid-day with no connection is the worst moment. You decide when.</p>
    <button class="btn" data-act="update-now">Install it now</button>
  </div>`
      : ''
  }

  <div class="panel">
    <h3>Data</h3>
    <p class="meta">Deleting your record leaves the plan untouched: they are stored separately.</p>
    <button class="btn ghost" data-act="seed">Reload the sample trip</button>
    <button class="btn ghost" data-act="wipe-journal">Delete my record</button>
  </div>`;
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}
