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
  return `<div class="install"><strong>Instálala en la pantalla de inicio</strong>${esc(
    installHint(),
  )}</div>`;
}

/* ── Librería (§11.1) ────────────────────────────────────────────────── */

export function libraryScreen(state: AppState): string {
  const todayIso = today(state.clock);

  if (state.plans.length === 0) {
    return `${installBanner(state)}
      <div class="bar"><h1>Viajes</h1><a class="chip" href="${routeHash({ name: 'settings' })}">Ajustes</a></div>
      <p class="empty">No hay ningún viaje cargado todavía.<br>Carga un archivo de viaje para empezar.</p>`;
  }

  const summaries = state.plans.map((p) => ({
    stored: p,
    summary: summarise(p.plan, { tripId: p.tripId, waypoints: {}, improvised: [], days: {} }, todayIso),
  }));

  const rows = sortForLibrary(summaries.map((s) => s.summary))
    .map((s) => {
      const stored = summaries.find((x) => x.summary.title === s.title)!.stored;
      const label = { active: 'en curso', upcoming: 'próximo', finished: 'terminado' }[s.status];
      const pct = s.planned ? Math.round((s.visited / s.planned) * 100) : 0;
      return `<li><button class="trip" data-go="${esc(
        routeHash({ name: 'trip', tripId: stored.tripId }),
      )}">
        <span class="tag ${s.status === 'active' ? 'active' : ''}">${label}</span>
        <h3>${esc(s.title)}</h3>
        <p class="meta">${esc(s.startDate)} → ${esc(s.endDate)} · ${s.days} días · ${
          s.visited
        }/${s.planned} paradas</p>
        <div class="progress"><i style="width:${pct}%"></i></div>
      </button></li>`;
    })
    .join('');

  return `${installBanner(state)}
    <div class="bar"><h1>Viajes</h1><a class="chip" href="${routeHash({ name: 'settings' })}">Ajustes</a></div>
    <ul class="trips">${rows}</ul>`;
}

/* ── Índice del viaje ────────────────────────────────────────────────── */

export function tripScreen(state: AppState): string {
  const plan = state.plan;
  if (!plan) return `<p class="empty">Viaje no encontrado.</p>`;
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
          <span class="alt"> · ${d.waypoints.length} paradas · ${esc(d.startTime)}–${esc(
            formatClock(schedule.end),
          )}</span>
        </span>
      </button></li>`;
    })
    .join('');

  return `${installBanner(state)}
    <div class="bar"><a class="back" href="#/">‹ Viajes</a></div>
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
    return `<p class="empty">Día no encontrado.</p>`;
  }

  const day = plan.days.find((d) => d.id === route.dayId);
  if (!day) return `<p class="empty">Día no encontrado.</p>`;

  const lang = plan.primaryLanguage;
  const secondary = plan.languages.find((l) => l !== lang) ?? null;
  const now = nowMinutes(state.clock);
  const free = isFreeMode(journal, day.id);

  return `${installBanner(state)}
    <div class="bar">
      <a class="back" href="${esc(routeHash({ name: 'trip', tripId: route.tripId }))}">‹ ${esc(
        pick(plan.title, lang) ?? 'Viaje',
      )}</a>
      <button class="chip" data-act="freemode" aria-pressed="${free}">Modo libre</button>
    </div>
    <p class="date">${esc(longDate(day.date, lang))}</p>
    <h1>${esc(pick(day.title, lang) ?? day.id)}</h1>
    ${alertBanner(state, plan, day, journal)}
    ${day.type === 'transit' ? transitBody(plan, day, now) : timelineBody(plan, day, journal, lang, secondary)}
    <div class="acts" style="margin-top:1rem">
      <button class="btn" data-act="improvise">+ Parada improvisada</button>
    </div>
    ${improvisedList(journal, day)}`;
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
      <p>Marca por dónde vas y te aviso de si llegas.</p>
    </div>`;
  }

  const alert = alertFor(day, now, journal, plan, state.alert.level);
  if (!alert || alert.level === 'green' || !alert.message) return '';
  if (state.alert.dismissedAt && rank(alert.level) <= rank(state.alert.dismissedAt)) return '';

  const fix =
    alert.proposal && alert.proposal.drop.length && !alert.proposal.insufficient
      ? `<button class="act" data-act="drop" data-ids="${esc(
          alert.proposal.drop.map((w) => w.id).join(','),
        )}">Saltarlas</button>`
      : '';

  return `<div class="alert ${alert.level}">
    <p>${esc(alert.message)}</p>
    ${fix}
    <button class="act" data-act="dismiss" data-level="${alert.level}">Vale</button>
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
        ${button('arrive', stop.waypoint.id, 'Llegué', status === 'current')}
        ${button('visited', stop.waypoint.id, 'Hecho', status === 'visited' || status === 'partial')}
        ${button('skip', stop.waypoint.id, 'Saltar', status === 'skipped')}
        ${status !== 'pending' ? button('unmark', stop.waypoint.id, 'Deshacer', false) : ''}
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
 * §4.5 — un día `transit` no es una lista de paradas: es un reloj. El aviso deja
 * de ser «vas justo» para ser «sal ya».
 */
function transitBody(plan: TripPayload, day: Day, now: number): string {
  const schedule = computeSchedule(day);
  const next = schedule.stops.find((s) => s.waypoint.anchor && parseAnchor(s) > now);
  const target = next ?? schedule.stops[schedule.stops.length - 1];
  const at = target?.waypoint.anchor ? parseAnchor(target) : schedule.end;
  const left = at - now;

  const rows = schedule.stops
    .map((s) => {
      const place = plan.places[s.waypoint.place];
      const a = s.waypoint.anchor;
      return `<li class="dayrow"><b>${esc(a ? a.time : formatClock(s.arrive))}</b>
        <span>${esc(place?.name ?? s.waypoint.place)}${
          a ? `<span class="alt"> · ${esc(pick(a.label, plan.primaryLanguage) ?? a.type)}</span>` : ''
        }</span></li>`;
    })
    .join('');

  const urgent = left <= 30;
  return `<div class="panel">
    <p class="meta">${esc(
      target?.waypoint.anchor
        ? pick(target.waypoint.anchor.label, plan.primaryLanguage) ?? 'Siguiente hito'
        : 'Fin',
    )}</p>
    <h1 style="font-size:3rem;font-variant-numeric:tabular-nums;margin:.2rem 0">${esc(
      formatDuration(left),
    )}</h1>
    <p class="verdict ${urgent ? 'bad' : 'ok'}">${
      left < 0 ? 'Ya ha pasado la hora.' : urgent ? 'Sal ya.' : `Hasta las ${esc(formatClock(at))}`
    }</p>
  </div>
  <ul class="days">${rows}</ul>`;
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
  const tone = v.startsWith('APROBADO') ? 'ok' : v.includes('no') || v.includes('falla') ? 'bad' : '';

  return `<div class="bar"><a class="back" href="#/">‹ Viajes</a><h1>Ajustes</h1></div>

  <div class="panel">
    <h3>Almacenamiento</h3>
    <dl>
      <dt>Instalada</dt><dd>${s.installed ? 'sí' : 'no'}</dd>
      <dt>Persistente</dt><dd>${s.persisted ? 'sí' : 'no'}</dd>
      <dt>Usado</dt><dd>${formatBytes(s.usage)}</dd>
      <dt>Cuota</dt><dd>${formatBytes(s.quota)}</dd>
    </dl>
    ${s.persisted ? '' : '<button class="btn" data-act="persist">Pedir almacenamiento persistente</button>'}
  </div>

  <div class="panel">
    <h3>Spike de OPFS (§8.4)</h3>
    <p class="meta">Escribe 150 MB, comprueba que persisten y que se leen por rangos. Es el go/no-go de los mapas.</p>
    <dl>
      <dt>Archivo</dt><dd>${spike.info.exists ? formatBytes(spike.info.bytes) : 'no existe'}</dd>
      <dt>Escrito</dt><dd>${spike.startedAt ? esc(spike.startedAt.slice(0, 16).replace('T', ' ')) : '—'}</dd>
    </dl>
    <p class="verdict ${tone}">${esc(v)}</p>
    ${
      spike.busy
        ? `<p class="meta">${esc(spike.busy)}</p>`
        : `<button class="btn" data-act="spike-write">Escribir 150 MB</button>
           <button class="btn ghost" data-act="spike-verify">Comprobar rangos</button>
           ${spike.info.exists ? '<button class="btn ghost" data-act="spike-delete">Borrar</button>' : ''}`
    }
  </div>

  <div class="panel">
    <h3>Reloj simulado</h3>
    <p class="meta">§14 paso 4: los avisos tienen que poder probarse cambiando el reloj. Sin esto la app no hace nada fuera de las fechas del viaje.</p>
    <dl>
      <dt>Fecha</dt><dd><input type="date" data-act="set-date" value="${esc(state.clock.date ?? '')}"></dd>
      <dt>Hora</dt><dd><input type="time" data-act="set-time" value="${esc(state.clock.time ?? '')}"></dd>
    </dl>
    ${state.clock.date || state.clock.time ? '<button class="btn ghost" data-act="clock-reset">Volver al reloj real</button>' : ''}
  </div>

  ${
    state.updateReady
      ? `<div class="panel">
    <h3>Actualización</h3>
    <p class="meta">Hay una versión nueva esperando. §12.2 no la instala sola durante un viaje activo: recargar la app a media jornada, sin red para arreglar nada, es el peor momento. Tú decides cuándo.</p>
    <button class="btn" data-act="update-now">Instalarla ahora</button>
  </div>`
      : ''
  }

  <div class="panel">
    <h3>Datos</h3>
    <p class="meta">Borrar el registro deja el plan intacto: son cosas distintas y se guardan aparte (§2.5).</p>
    <button class="btn ghost" data-act="seed">Recargar el viaje de prueba</button>
    <button class="btn ghost" data-act="wipe-journal">Borrar mi registro</button>
  </div>`;
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}
