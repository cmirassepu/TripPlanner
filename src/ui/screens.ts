/**
 * Las pantallas. Cada una devuelve HTML; la app lo pone y engancha los eventos
 * por delegación. Sin framework: son cinco pantallas sobre un estado pequeño, y
 * el bundle se cachea entero, así que cada kilobyte se paga en el aeropuerto.
 */

import type { TripPayload, Day, Place, Stay, Booking, Note } from '../model/types.ts';
import type { AppState } from './state.ts';
import { routeHash, today, nowMinutes, neighbours, type Route, type DayTab, type NearbyFilter } from './state.ts';
import { computeSchedule, type Schedule } from '../core/schedule.ts';
import { formatClock, formatDuration } from '../core/time.ts';
import { isOpenAt, whyClosed, windowsFor } from '../core/hours.ts';
import { haversine, formatDistance } from '../core/geo.ts';
import { esc, pick, longDate } from '../render/day.ts';
import { storyHtml, readingMinutes } from '../render/story.ts';
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
      return `<li><button class="trip" data-go="${esc(
        routeHash({ name: 'trip', tripId: stored.tripId }),
      )}">
        <span class="tag ${s.status === 'active' ? 'active' : ''}">${label}</span>
        <h3>${esc(s.title)}</h3>
        <p class="meta">${esc(s.startDate)} → ${esc(s.endDate)} · ${s.days} days</p>
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
        routeHash({ name: 'day', tripId, dayId: d.id, tab: 'plan' }),
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
    <ul class="days"><li><button class="dayrow" data-go="${esc(
      routeHash({ name: 'bookings', tripId }),
    )}"><b>All</b><span class="grow">Bookings</span><span class="go">›</span></button></li></ul>
    <ul class="days">${rows}</ul>`;
}

/* ── Día ─────────────────────────────────────────────────────────────── */

/**
 * El día tiene tres vistas: el plan, lo que hay por la zona y las reservas.
 *
 * En el plan sólo va lo que hace falta para actuar en la próxima hora: cuándo,
 * dónde y el plazo que manda. El resto vive en la página de cada parada, a un
 * toque. No se marca nada: la línea de «ahora» la mueve el reloj.
 */
export function dayScreen(state: AppState): string {
  const plan = state.plan;
  const route = state.route;
  if (!plan || route.name !== 'day') return NOT_FOUND;
  const day = plan.days.find((d) => d.id === route.dayId);
  if (!day) return NOT_FOUND;

  const lang = plan.primaryLanguage;
  const tabs = DAY_TABS.map(
    ([tab, label]) =>
      `<button data-swap="${esc(routeHash({ ...route, tab }))}" aria-pressed="${route.tab === tab}">${label}</button>`,
  ).join('');

  const body =
    route.tab === 'nearby'
      ? nearbyBody(state, plan, route.tripId, day)
      : route.tab === 'bookings'
        ? bookingsBody(plan, day)
        : planBody(state, plan, route.tripId, day);

  return `${installBanner(state)}
    <div class="bar"><a class="back grow" href="${esc(routeHash({ name: 'trip', tripId: route.tripId }))}">‹ ${esc(
      pick(plan.title, lang) ?? 'Trip',
    )}</a>${pager(plan, route)}</div>
    <p class="date">${esc(longDate(day.date, lang))}</p>
    <h1>${esc(pick(day.title, lang) ?? day.id)}</h1>
    <div class="tabs">${tabs}</div>
    ${body}`;
}

const DAY_TABS: ReadonlyArray<readonly [DayTab, string]> = [
  ['plan', 'Plan'],
  ['nearby', 'Nearby'],
  ['bookings', 'Bookings'],
];

function planBody(state: AppState, plan: TripPayload, tripId: string, day: Day): string {
  // El reloj sólo dice algo el día en cuestión: mirar el 23 de diciembre desde
  // octubre no es ir seis horas tarde.
  const now = day.date === today(state.clock) ? nowMinutes(state.clock) : null;
  const intro = pick(day.intro, plan.primaryLanguage);
  const schedule = computeSchedule(day);

  const rows: string[] = [];
  let nowShown = now === null;
  for (const stop of schedule.stops) {
    if (!nowShown && stop.arrive > now!) {
      rows.push(nowLine(now!));
      nowShown = true;
    }
    rows.push(stopRow(plan, tripId, day, stop, now));
  }
  if (!nowShown && schedule.stops.length) rows.push(nowLine(now!));

  return `${intro ? `<p class="lead">${esc(intro)}</p>` : ''}
    ${deadlinePanel(plan, day, schedule, now)}
    ${rows.length ? `<ul class="days">${rows.join('')}</ul>` : '<p class="empty">Nothing planned yet.</p>'}`;
}

/* ── Por la zona ─────────────────────────────────────────────────────── */

const NEARBY_FILTERS: ReadonlyArray<readonly [NearbyFilter, string]> = [
  ['all', 'All'],
  ['see', 'See and do'],
  ['eat', 'Eat'],
];

/** Categorías que no son «sitios que ver»: ya salen en el plan o en las reservas. */
const NOT_SIGHTS = new Set(['lodging', 'transport']);

/**
 * Todo lo apuntado en la zona donde se duerme ese día, esté o no en el plan.
 * Es el plan B: si algo está cerrado, llueve o no apetece, aquí hay de dónde tirar.
 */
function nearbyBody(state: AppState, plan: TripPayload, tripId: string, day: Day): string {
  const filter: NearbyFilter = state.nearby;
  const here = state.nearbySort === 'near' ? state.position : null;
  const metres = (pl: Place) => (here && pl.coords ? haversine(here, pl.coords) : null);

  const area = plan.stays.find((st) => st.id === day.stay)?.area;
  const places = Object.values(plan.places)
    .filter((pl) => area && pl.area === area && !NOT_SIGHTS.has(pl.category ?? ''))
    // Por cercanía si hay posición; los sitios sin coordenadas, al final. Si no, alfabético.
    .sort((a, b) => {
      const da = metres(a);
      const db = metres(b);
      if (da !== null && db !== null) return da - db;
      if (da !== null || db !== null) return da !== null ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  if (!places.length) return '<p class="empty">No places listed for this area yet.</p>';

  const row = (pl: Place) => {
    const planned = plan.days.find((d) => d.waypoints.some((w) => w.place === pl.id));
    const away = metres(pl);
    const sub = [
      away !== null ? formatDistance(away) : here ? 'distance unknown' : '',
      pl.category,
      planned ? `planned ${shortDate(planned.date)}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    return `<li><button class="dayrow" data-go="${esc(
      routeHash({ name: 'place', tripId, dayId: day.id, placeId: pl.id }),
    )}"><span class="grow">${esc(pl.name)}${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</span><span class="go">›</span></button></li>`;
  };
  const group = (title: string, list: Place[]) =>
    list.length ? `<h3 class="group">${title}</h3><ul class="days">${list.map(row).join('')}</ul>` : '';

  const eat = places.filter((pl) => pl.category === 'food');
  const see = places.filter((pl) => pl.category !== 'food');

  const chips = NEARBY_FILTERS.map(
    ([key, label]) =>
      `<button class="chip" data-act="nearby" data-filter="${key}" aria-pressed="${filter === key}">${label}</button>`,
  ).join('');

  // Con «All» se ven los dos grupos con su título; con un filtro, sólo la lista.
  const lists =
    filter === 'see'
      ? `<ul class="days">${see.map(row).join('')}</ul>`
      : filter === 'eat'
        ? `<ul class="days">${eat.map(row).join('')}</ul>`
        : group('See and do', see) + group('Eat', eat);

  const sort = (key: 'az' | 'near', label: string) =>
    `<button class="chip" data-act="nearby-sort" data-sort="${key}" aria-pressed="${
      state.nearbySort === key
    }">${label}</button>`;

  return `<div class="filters"><span class="meta grow">${esc(area!)}</span>${chips}</div>
    <div class="filters"><span class="meta grow">Sort</span>${sort('az', 'A–Z')}${sort('near', 'Nearest')}</div>
    ${lists}`;
}

/* ── Reservas ────────────────────────────────────────────────────────── */

/** Lo que una tarjeta de reserva necesita, venga de `stays` o de `bookings`. */
interface BookingCard {
  date: string;
  kind: string;
  when: string;
  title: string;
  status?: Booking['status'];
  ref?: string | null;
  provider?: string | null;
  place?: Place;
  lines: string[];
}

function cardOfStay(plan: TripPayload, stay: Stay): BookingCard {
  const lang = plan.primaryLanguage;
  const place = stay.place ? plan.places[stay.place] : undefined;
  return {
    date: stay.from,
    kind: 'Hotel',
    when: `${shortDate(stay.from)} → ${shortDate(stay.to)}`,
    title: stay.name,
    ref: stay.confirmation,
    place,
    lines: [pick(stay.notes, lang), ...(place?.facts ?? []).map((f) => pick(f.text, lang))].filter(
      (l): l is string => !!l,
    ),
  };
}

function cardOfBooking(plan: TripPayload, b: Booking): BookingCard {
  const lang = plan.primaryLanguage;
  return {
    date: b.date,
    kind: { flight: 'Flight', activity: 'Activity', transfer: 'Transfer' }[b.kind],
    when: shortDate(b.date),
    title: pick(b.title, lang) ?? b.id,
    status: b.status,
    ref: b.ref,
    provider: b.provider,
    place: b.place ? plan.places[b.place] : undefined,
    lines: (b.lines ?? []).map((l) => pick(l, lang)).filter((l): l is string => !!l),
  };
}

function bookingCard(c: BookingCard): string {
  const phone = c.place?.contact?.phone;
  const status =
    c.status === 'todo'
      ? '<p class="verdict bad">Not booked yet</p>'
      : c.status === 'pending'
        ? '<p class="verdict">Requested, not confirmed yet</p>'
        : '';
  return `<div class="panel">
    <p class="meta">${esc(c.kind)} · ${esc(c.when)}</p>
    <h3>${esc(c.title)}</h3>
    ${c.ref ? `<p class="ref">${esc(c.ref)}</p>` : ''}
    ${status}
    <dl>
      ${c.provider ? `<dt>With</dt><dd>${esc(c.provider)}</dd>` : ''}
      ${c.place?.address ? `<dt>Address</dt><dd>${esc(c.place.address)}</dd>` : ''}
      ${c.place?.addressLocal ? `<dt></dt><dd>${esc(c.place.addressLocal)}</dd>` : ''}
      ${phone ? `<dt>Phone</dt><dd><a href="tel:${esc(phone)}">${esc(phone)}</a></dd>` : ''}
    </dl>
    ${c.lines.length ? `<ul>${c.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
  </div>`;
}

/** Las reservas que hacen falta ese día: el vuelo, lo reservado y dónde se duerme. */
function bookingsBody(plan: TripPayload, day: Day): string {
  const cards = [
    ...(plan.bookings ?? []).filter((b) => b.date === day.date).map((b) => cardOfBooking(plan, b)),
    // El día de salida de un hotel también cuenta: hay que dejar la habitación.
    ...plan.stays.filter((st) => st.from <= day.date && day.date <= st.to).map((st) => cardOfStay(plan, st)),
  ];
  return cards.length ? cards.map(bookingCard).join('') : '<p class="empty">No bookings for this day.</p>';
}

/** Todas las reservas del viaje, por fecha. */
export function bookingsScreen(state: AppState): string {
  const plan = state.plan;
  const route = state.route;
  if (!plan || route.name !== 'bookings') return NOT_FOUND;

  const cards = [
    ...(plan.bookings ?? []).map((b) => cardOfBooking(plan, b)),
    ...plan.stays.map((st) => cardOfStay(plan, st)),
  ].sort((x, y) => x.date.localeCompare(y.date));

  return `<div class="bar"><a class="back" href="${esc(routeHash({ name: 'trip', tripId: route.tripId }))}">‹ ${esc(
    pick(plan.title, plan.primaryLanguage) ?? 'Trip',
  )}</a></div>
    <h1>Bookings</h1>
    ${cards.length ? cards.map(bookingCard).join('') : '<p class="empty">No bookings yet.</p>'}`;
}

const NOT_FOUND = `<p class="empty">Day not found.</p>`;

/** Las flechas de anterior y siguiente. Hacen lo mismo que deslizar el dedo. */
function pager(plan: TripPayload, route: Route): string {
  const { prev, next } = neighbours(plan, route);
  const arrow = (to: Route | null, glyph: string, label: string) =>
    to
      ? `<button class="chip" data-swap="${esc(routeHash(to))}" aria-label="${label}">${glyph}</button>`
      : `<span class="chip off" aria-hidden="true">${glyph}</span>`;
  return arrow(prev, '‹', 'Previous') + arrow(next, '›', 'Next');
}

type Stop = Schedule['stops'][number];

const nowLine = (now: number) => `<li class="nowline">Now · ${esc(formatClock(now))}</li>`;

function stopRow(plan: TripPayload, tripId: string, day: Day, stop: Stop, now: number | null): string {
  const w = stop.waypoint;
  const place = plan.places[w.place];
  const lang = plan.primaryLanguage;

  const past = now !== null && stop.leave <= now;
  const current = now !== null && stop.arrive <= now && now < stop.leave;
  const flagged = (w.notes ?? []).some((n) => n.type === 'warn') || closedOnArrival(place, day, stop);

  const sub = w.anchor
    ? withTime(pick(w.anchor.label, lang) ?? w.anchor.type, w.anchor.time)
    : w.duration >= 15
      ? `until ${formatClock(stop.leave)}`
      : '';

  return `<li><button class="dayrow ${past ? 'past' : ''} ${current ? 'today' : ''}" data-go="${esc(
    routeHash({ name: 'stop', tripId, dayId: day.id, waypointId: w.id }),
  )}">
    <b>${esc(formatClock(stop.arrive))}</b>
    <span class="grow">${esc(place?.name ?? w.place)}${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</span>
    ${flagged ? '<span class="flag" aria-label="Has a warning">!</span>' : ''}
    <span class="go">›</span>
  </button></li>`;
}

const closedOnArrival = (place: Place | undefined, day: Day, stop: Stop): boolean =>
  !!place && isOpenAt(place.hours, day.date, stop.arrive).state === 'closed';

/** Muchas etiquetas ya dicen la hora; repetirla detrás sólo mete ruido. */
const withTime = (label: string, time: string) => (label.includes(time) ? label : `${label} · ${time}`);

/**
 * El plazo que manda. Sólo cuentan los que se pueden perder: la hora de
 * entrada a un hotel no es uno de ellos.
 *
 * Un día `transit` es un reloj (§4.5), así que el plazo va en grande y con
 * cuenta atrás. En los demás días es una franja discreta.
 */
function deadlinePanel(plan: TripPayload, day: Day, schedule: Schedule, now: number | null): string {
  const lang = plan.primaryLanguage;
  const deadlines = schedule.stops.filter(
    (s) => s.waypoint.anchor && s.waypoint.anchor.type !== 'opening',
  );
  if (!deadlines.length) return '';

  const label = (s: Stop) =>
    pick(s.waypoint.anchor!.label, lang) ?? plan.places[s.waypoint.place]?.name ?? s.waypoint.place;
  const next = now === null ? deadlines[0] : deadlines.find((s) => parseAnchor(s) > now);

  if (day.type !== 'transit') {
    if (!next) return '';
    const at = parseAnchor(next);
    const left = now === null ? '' : ` · ${formatDuration(at - now)} left`;
    return `<div class="alert amber"><p>${esc(withTime(label(next), next.waypoint.anchor!.time))}${esc(left)}</p></div>`;
  }

  const big = (text: string) =>
    `<h1 style="font-size:3rem;font-variant-numeric:tabular-nums;margin:.2rem 0">${esc(text)}</h1>`;

  if (!next) {
    return `<div class="panel">
      <p class="meta">${esc(label(deadlines[deadlines.length - 1]))}</p>
      <p class="verdict ok">No deadlines left today.</p>
    </div>`;
  }

  // En grande va siempre la hora del plazo: la de salida del vuelo, no la del
  // cierre de facturación. Debajo, a qué hora hay que estar allí y, el día en
  // cuestión, cuánto falta.
  const at = parseAnchor(next);
  const place = plan.places[next.waypoint.place]?.name ?? next.waypoint.place;
  const beThere =
    next.waypoint.anchor!.type === 'departure' && next.arrive < at
      ? `Be at ${place} by ${formatClock(next.arrive)}`
      : '';

  if (now === null) {
    return `<div class="panel">
      <p class="meta">${esc(label(next))}</p>
      ${big(next.waypoint.anchor!.time)}
      <p class="verdict ok">${esc(beThere || `The plan starts at ${day.startTime}`)}</p>
    </div>`;
  }

  const left = at - now;
  const urgent = left <= 30;
  return `<div class="panel">
    <p class="meta">${esc(label(next))}</p>
    ${big(next.waypoint.anchor!.time)}
    <p class="verdict ${urgent ? 'bad' : 'ok'}">${esc(
      [`${formatDuration(left)} to go`, beThere].filter(Boolean).join(' · '),
    )}</p>
  </div>`;
}

const parseAnchor = (s: { waypoint: { anchor?: { time: string } | null } }): number => {
  const t = s.waypoint.anchor?.time ?? '00:00';
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
};

/* ── Parada y sitio ──────────────────────────────────────────────────── */

/** Una parada del plan: el sitio, más su hora, su plazo y sus notas de ese día. */
export function stopScreen(state: AppState): string {
  const plan = state.plan;
  const route = state.route;
  if (!plan || route.name !== 'stop') return NOT_FOUND;
  const day = plan.days.find((d) => d.id === route.dayId);
  const stop = day && computeSchedule(day).stops.find((s) => s.waypoint.id === route.waypointId);
  if (!day || !stop) return NOT_FOUND;

  const lang = plan.primaryLanguage;
  const w = stop.waypoint;
  const place = plan.places[w.place];
  const back = `<div class="bar"><a class="back grow" href="${esc(
    routeHash({ name: 'day', tripId: route.tripId, dayId: day.id, tab: 'plan' }),
  )}">‹ ${esc(pick(day.title, lang) ?? day.id)}</a>${pager(plan, route)}</div>`;
  if (!place) return `${back}<p class="empty">Unknown place: ${esc(w.place)}</p>`;

  const when =
    stop.leave > stop.arrive
      ? `${formatClock(stop.arrive)}–${formatClock(stop.leave)}`
      : formatClock(stop.arrive);
  const travel = w.travelFrom > 0 ? ` · ${w.travelFrom} min ${w.travelMode ?? 'walking'} to get here` : '';

  const anchor = w.anchor
    ? `<p class="anchor ${w.anchor.hard ? 'hard' : 'soft'}">${esc(
        withTime(pick(w.anchor.label, lang) ?? w.anchor.type, w.anchor.time),
      )}</p>`
    : '';

  const verdict = isOpenAt(place.hours, day.date, stop.arrive);
  let conflict = '';
  if (verdict.state === 'closed') {
    const windows = verdict.windows.map((r) => `${r[0]}–${r[1]}`).join(', ') || 'closed all day';
    conflict = `<p class="conflict">${
      whyClosed(verdict.windows, stop.arrive) === 'too-early'
        ? `You arrive at ${esc(formatClock(stop.arrive))} and it does not open until ${esc(windows)}`
        : `You arrive at ${esc(formatClock(stop.arrive))} and it closes ${esc(windows)}`
    }</p>`;
  }

  const choices = (w.choices ?? [])
    .map((id) => plan.places[id])
    .filter((pl): pl is Place => !!pl)
    .map(
      (pl) => `<li><button class="dayrow" data-go="${esc(
        routeHash({ name: 'place', tripId: route.tripId, dayId: day.id, placeId: pl.id }),
      )}"><span class="grow">${esc(pl.name)}${
        pl.address ? `<span class="sub">${esc(pl.address)}</span>` : ''
      }</span><span class="go">›</span></button></li>`,
    )
    .join('');

  return `${back}
    ${placeDetail(place, day, lang, {
      under: `<p class="meta">${esc(when)}${esc(travel)}</p>${anchor}${conflict}`,
      notes: w.notes ?? [],
      after: choices ? `<h3 class="group">Options</h3><ul class="days">${choices}</ul>` : '',
    })}`;
}

/** Un sitio de la zona que no está (o no sólo) en el plan de ese día. */
export function placeScreen(state: AppState): string {
  const plan = state.plan;
  const route = state.route;
  if (!plan || route.name !== 'place') return NOT_FOUND;
  const day = plan.days.find((d) => d.id === route.dayId);
  const place = plan.places[route.placeId];
  if (!day || !place) return NOT_FOUND;

  // Se vuelve con el «atrás» del navegador: a un sitio se llega desde la
  // pestaña de la zona o desde las opciones de una parada.
  return `<div class="bar"><button class="back" data-act="back">‹ Back</button></div>
    ${placeDetail(place, day, plan.primaryLanguage, { under: '', notes: [], after: '' })}`;
}

/** Lo común a parada y sitio: foto, avisos, descripción, datos y letra pequeña plegada. */
function placeDetail(
  place: Place,
  day: Day,
  lang: string,
  extra: { under: string; notes: Note[]; after: string },
): string {
  // Sólo `data:` de imagen: el archivo de viaje no debe poder cargar nada de la red.
  const photo = place.photo?.src.startsWith('data:image/')
    ? `<figure class="photo"><img src="${esc(place.photo.src)}" alt="">${
        place.photo.credit ? `<figcaption>${esc(place.photo.credit)}</figcaption>` : ''
      }</figure>`
    : '';

  const warnings = extra.notes
    .filter((n) => n.type === 'warn')
    .map((n) => `<p class="verdict">${esc(pick(n.text, lang) ?? '')}</p>`)
    .join('');

  const about = pick(place.deep, lang);
  const story = pick(place.story, lang);

  const fineprint = [
    ...extra.notes.filter((n) => n.type !== 'warn').map((n) => `<li>${esc(pick(n.text, lang) ?? '')}</li>`),
    ...(place.facts ?? []).map(
      (f) =>
        `<li>${esc(pick(f.text, lang) ?? '')}${
          f.confidence === 'unverified'
            ? '<span class="badge">unverified</span>'
            : f.source
              ? `<span class="src">${esc(f.source)}</span>`
              : ''
        }</li>`,
    ),
  ];

  return `${photo}
    <h1>${esc(place.name)}</h1>
    ${place.nameLocal && place.nameLocal !== place.name ? `<p class="lead">${esc(place.nameLocal)}</p>` : ''}
    ${extra.under}
    ${warnings}
    ${about ? `<p class="lead">${esc(about)}</p>` : ''}
    ${extra.after}
    ${placeFacts(place, day, lang)}
    ${placeLinks(place, lang)}
    ${
      story
        ? `<article class="story"><p class="meta">${readingMinutes(story)} min read</p>${storyHtml(story)}</article>`
        : ''
    }
    ${
      fineprint.length
        ? `<details class="panel"><summary>Good to know · ${fineprint.length}</summary><ul>${fineprint.join('')}</ul></details>`
        : ''
    }`;
}

/**
 * Enlace a Google Maps para leer reseñas y ver fotos. Necesita red, y se busca
 * por nombre y zona, no por coordenadas: unas coordenadas abren un punto en el
 * mapa, no la ficha del sitio.
 */
function mapsUrl(place: Place): string | null {
  // Un hueco genérico («comer por aquí») no es un sitio que buscar.
  if (!place.links?.maps && !place.coords && !place.address && !place.area) return null;
  const name = place.name.replace(/\s*\(.*?\)\s*/g, ' ').trim();
  return (
    place.links?.maps ??
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      [name, place.area].filter(Boolean).join(', '),
    )}`
  );
}

/**
 * Los enlaces de fuera: mapa, Wikipedia y web oficial. Todos necesitan red; el
 * artículo de Wikipedia se puede guardar en su app para leerlo sin conexión.
 * La referencia a la guía en papel no es un enlace, sólo dónde buscar.
 */
function placeLinks(place: Place, lang: string): string {
  const https = (u: string | null | undefined): u is string => !!u && /^https:\/\//.test(u);
  const btn = (url: string, label: string) =>
    `<a class="btn ghost" href="${esc(url)}" target="_blank" rel="noopener">${label}</a>`;
  const maps = mapsUrl(place);
  const wiki = pick(place.links?.wikipedia, lang);
  const site = place.links?.official ?? place.contact?.url;
  const buttons = [
    https(maps) ? btn(maps, 'Open in Google Maps') : '',
    https(wiki) ? btn(wiki, 'Read on Wikipedia') : '',
    https(site) ? btn(site, 'Website') : '',
  ].join('');
  const guide = place.links?.guide ? `<p class="meta">Rough Guide: ${esc(place.links.guide)}</p>` : '';
  return `${buttons ? `<p>${buttons}</p>` : ''}${guide}`;
}

/** Los datos de consulta rápida. Una fila sólo sale si hay algo que decir. */
function placeFacts(place: Place, day: Day, lang: string): string {
  const rows: string[] = [];

  const windows = windowsFor(place.hours, day.date);
  const allDay = windows?.length === 1 && windows[0][0] === '00:00' && windows[0][1] >= '23:59';
  if (!windows) rows.push(`<dt>Open today</dt><dd>unknown</dd>`);
  else if (!allDay) {
    rows.push(`<dt>Open today</dt><dd>${esc(windows.map((r) => `${r[0]}–${r[1]}`).join(', ') || 'closed')}</dd>`);
  }

  const cost = place.cost;
  if (cost && (cost.adult !== null || cost.child !== null)) {
    const money = (n: number) => `${cost.currency} ${n.toLocaleString('en')}`;
    const parts = [
      cost.adult !== null ? `${cost.adult === 0 ? 'free' : money(cost.adult)} adult` : '',
      cost.child !== null ? `${cost.child === 0 ? 'free' : money(cost.child)} child` : '',
    ].filter(Boolean);
    rows.push(`<dt>Price</dt><dd>${esc(parts.join(' · '))}</dd>`);
  }
  const costNote = pick(cost?.note, lang);

  if (place.address) rows.push(`<dt>Address</dt><dd>${esc(place.address)}</dd>`);
  if (place.addressLocal) rows.push(`<dt></dt><dd>${esc(place.addressLocal)}</dd>`);
  const phone = place.contact?.phone;
  if (phone) rows.push(`<dt>Phone</dt><dd><a href="tel:${esc(phone)}">${esc(phone)}</a></dd>`);

  if (!rows.length && !costNote) return '';
  return `<div class="panel"><dl>${rows.join('')}</dl>${costNote ? `<p class="meta">${esc(costNote)}</p>` : ''}</div>`;
}

/* ── Ajustes y spike (§8.4, §12.3) ───────────────────────────────────── */

export const TEXT_SIZES: ReadonlyArray<readonly [number, string]> = [
  [90, 'Small'],
  [100, 'Normal'],
  [115, 'Large'],
  [130, 'Extra large'],
];

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
    <h3>Text size</h3>
    <div class="acts">${TEXT_SIZES.map(
      ([size, label]) =>
        `<button data-act="text-size" data-size="${size}" aria-pressed="${state.textSize === size}">${label}</button>`,
    ).join('')}</div>
  </div>

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
    <button class="btn ghost" data-act="seed">Reload the sample trip</button>
  </div>`;
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}
