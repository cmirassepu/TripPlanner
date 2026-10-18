/**
 * Las pantallas. Cada una devuelve HTML; la app lo pone y engancha los eventos
 * por delegación. Sin framework: son pocas pantallas sobre un estado pequeño, y
 * el bundle se cachea entero, así que cada kilobyte se paga en el aeropuerto.
 *
 * El diseño sale de la maqueta aprobada: la pantalla del viaje con la portada y
 * las estancias; el día con tres pestañas (línea de tiempo, sitios, reservas);
 * la página del sitio con la lectura larga y las fotos repartidas; y la del
 * hotel, con la dirección en el idioma local para enseñarla al taxista.
 */

import type { TripPayload, Day, Place, Stay, Booking, Note, Photo, Coords, MapBounds } from '../model/types.ts';
import type { AppState } from './state.ts';
import { routeHash, today, nowMinutes, neighbours, type Route, type DayTab, type NearbyFilter } from './state.ts';
import { computeSchedule, type Schedule } from '../core/schedule.ts';
import { formatClock, formatDuration } from '../core/time.ts';
import { isOpenAt, whyClosed, windowsFor } from '../core/hours.ts';
import { haversine, formatDistance } from '../core/geo.ts';
import { esc, pick, longDate } from '../render/day.ts';
import { storySections, readingMinutes } from '../render/story.ts';
import { summarise, sortForLibrary } from '../library/library.ts';
import { formatBytes, installHint } from '../store/install.ts';
import { verdict, type ProbeInfo, type ProbeResult } from '../spike/opfs.ts';
import { ICONS, categoryIcon, legIcon } from './icons.ts';

const MAPS_ON = false;

/** Lo pone el paso de construcción (commit y fecha); en los tests no existe. */
declare const __APP_VERSION__: string | undefined;
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

/* ── Cromo ───────────────────────────────────────────────────────────── */

export function installBanner(state: AppState): string {
  if (state.storage.installed) return '';
  return `<div class="install"><strong>Add it to your home screen</strong>${esc(
    installHint(),
  )}</div>`;
}

const NOT_FOUND = `<p class="empty">Day not found.</p>`;

/** Categorías que no son «sitios que ver»: ya salen en la línea de tiempo o en las reservas. */
const NOT_SIGHTS = new Set(['lodging', 'transport']);

const LABELS: Record<string, string> = {
  temple: 'Temple',
  market: 'Market',
  museum: 'Museum',
  park: 'Park',
  food: 'Eat',
  viewpoint: 'Viewpoint',
  activity: 'Activity',
  beach: 'Beach',
  village: 'Village',
  lodging: 'Hotel',
  transport: 'Transport',
};
const label = (category: string | null | undefined) => LABELS[category ?? ''] ?? category ?? '';

/* ── Colores de zona ─────────────────────────────────────────────────── */

/** Un color por zona, en el orden en que se duerme en ellas. `Stay.color` manda si existe. */
const PALETTE = ['#C65D21', '#5C8A3A', '#2E6F55', '#1E8DA6', '#1C9C8A', '#8A4F9E', '#B0433E'];

function areaColor(plan: TripPayload, area: string | null | undefined): string {
  const areas: string[] = [];
  for (const st of plan.stays) {
    const a = st.area ?? st.name;
    if (!areas.includes(a)) areas.push(a);
    if (a === area && st.color) return st.color;
  }
  const i = area ? areas.indexOf(area) : -1;
  return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
}

const areaStyle = (color: string) => `style="--a:${esc(color)}"`;

/* ── Fotos ───────────────────────────────────────────────────────────── */

/** Sólo `data:` de imagen: el archivo de viaje no debe poder cargar nada de la red. */
const isPhoto = (p: Photo | null | undefined): p is Photo => !!p?.src.startsWith('data:image/');

const photosOf = (place: Place | undefined): Photo[] =>
  place ? [place.photo, ...(place.gallery ?? [])].filter(isPhoto) : [];

const firstPhoto = (place: Place | undefined): Photo | undefined => photosOf(place)[0];

/** La versión pequeña para miniaturas; si el archivo no la trae, la grande. */
const small = (p: Photo): string => (p.thumb?.startsWith('data:image/') ? p.thumb : p.src);

/** La portada del viaje: la que diga el archivo, o la del primer sitio que ver con foto (ni hotel, ni transporte, ni comida). */
function coverOf(plan: TripPayload): Photo | undefined {
  if (isPhoto(plan.cover)) return plan.cover;
  for (const day of plan.days) {
    for (const w of day.waypoints) {
      const place = plan.places[w.place];
      const category = place?.category ?? '';
      if (place && !NOT_SIGHTS.has(category) && category !== 'food' && firstPhoto(place)) return firstPhoto(place);
    }
  }
  return Object.values(plan.places).map(firstPhoto).find(Boolean);
}

/** «Sunday 20 December»: el año sobra en un viaje de tres semanas. */
function longDay(iso: string): string {
  return new Date(`${iso}T12:00:00`)
    .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
    .replace(',', '');
}

/** La primera nota que dice algo de ese día; la coletilla de «horas estimadas» va en la letra pequeña. */
function firstNote(notes: Note[] | undefined): Note | undefined {
  return (notes ?? []).find((n) => !/^Estimated times/i.test(n.text?.en ?? ''));
}

/** Foto que representa una zona: la del primer sitio con foto de esa zona. */
function areaPhoto(plan: TripPayload, area: string | null | undefined): Photo | undefined {
  return Object.values(plan.places)
    .filter((p) => area && p.area === area && !NOT_SIGHTS.has(p.category ?? ''))
    .map(firstPhoto)
    .find(Boolean);
}

/* ── Mapas ───────────────────────────────────────────────────────────── */

/** La misma proyección que usan los scripts que dibujan los mapas. */
function projector(m: MapBounds): (c: Coords) => [number, number] {
  const [s, w, n, e] = m.bounds;
  return ([lat, lon]) => [((lon - w) / (e - w)) * m.width, ((n - lat) / (n - s)) * m.height];
}

const inside = (m: MapBounds, [lat, lon]: Coords): boolean =>
  lat >= m.bounds[0] && lat <= m.bounds[2] && lon >= m.bounds[1] && lon <= m.bounds[3];

/** Dónde está una estancia: su hotel o, si no tiene coordenadas, el centro de los sitios de su zona. */
function stayCoords(plan: TripPayload, stay: Stay): Coords | null {
  const own = stay.place ? plan.places[stay.place]?.coords : null;
  if (own) return own;
  const around = Object.values(plan.places)
    .filter((p) => stay.area && p.area === stay.area && p.coords)
    .map((p) => p.coords as Coords);
  if (!around.length) return null;
  return [around.reduce((a, c) => a + c[0], 0) / around.length, around.reduce((a, c) => a + c[1], 0) / around.length];
}

/**
 * Las paradas con coordenadas de un día, por orden. Es lo que se pinta encima
 * del mapa a pie y lo que se manda a Google Maps.
 */
function dayPoints(plan: TripPayload, day: Day): { n: number; name: string; c: Coords }[] {
  const out: { n: number; name: string; c: Coords }[] = [];
  for (const w of day.waypoints) {
    const p = plan.places[w.place];
    if (!p?.coords) continue;
    // El hotel al principio y al final es el mismo punto: un número basta.
    if (out.length && out[out.length - 1].c === p.coords) continue;
    out.push({ n: out.length + 1, name: p.name, c: p.coords });
  }
  return out;
}

/** Las chinchetas numeradas y, si se ha pedido, el punto de «estás aquí». */
function mapOverlay(m: MapBounds, points: { n: number; c: Coords }[], here: Coords | null): string {
  const at = projector(m);
  const pins = points
    .filter(({ c }) => inside(m, c))
    .map(({ n, c }) => {
      const [x, y] = at(c);
      return `<g class="pin"><circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="17"/><text x="${x.toFixed(0)}" y="${y.toFixed(0)}" font-size="18">${n}</text></g>`;
    })
    .join('');
  const dot =
    here && inside(m, here)
      ? (() => {
          const [x, y] = at(here);
          return `<circle class="here-halo" cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="40"/><circle class="here" cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="11"/>`;
        })()
      : '';
  return `<svg viewBox="0 0 ${m.width} ${m.height}" xmlns="http://www.w3.org/2000/svg">${pins}${dot}</svg>`;
}

/**
 * El mapa a pie del día, pequeño, con sus botones; y a pantalla completa
 * cuando se pide. Es una imagen de tamaño fijo, no un SVG: como vector, el
 * teléfono lo volvía a rasterizar con cada zoom y se quedaba sin memoria.
 */
function dayMapFigure(state: AppState, plan: TripPayload, day: Day): string {
  const m = day.map;
  // Apagado de momento: en el iPhone la app se cierra al mover el mapa, incluso
  // como imagen fija. Pendiente de encontrar la causa en el propio teléfono.
  if (!MAPS_ON || !m?.src.startsWith('data:image/')) return '';
  const points = dayPoints(plan, day);
  const here = state.position;
  const frame = `<div class="frame" style="aspect-ratio:${m.width}/${m.height}"><img src="${esc(m.src)}" alt="Map of today's walk">${mapOverlay(m, points, here)}</div>`;
  const locate = `<button class="btn ghost" data-act="locate">${ICONS.pin} Where am I</button>`;
  const full = state.mapOpen
    ? `<div class="mapfull"><div class="barf"><strong>${esc(pick(day.title, plan.primaryLanguage) ?? '')}</strong><button class="chip" data-act="map-close">Close</button></div>
        <div class="scroll">${frame}</div><div class="foot">${locate}</div></div>`
    : '';
  return `<figure class="daymap">${frame}<figcaption><button class="btn ghost" data-act="map-open">${ICONS.view} Open map</button>${locate}</figcaption></figure>${full}`;
}

/* ── Fechas ──────────────────────────────────────────────────────────── */

/** «Sat 19 Dec». Sin la coma: en una columna estrecha sobra. */
function niceDate(iso: string): string {
  return new Date(`${iso}T12:00:00`)
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace(',', '');
}

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 86_400_000);

/** «Day 3 of 23». */
function dayNumber(plan: TripPayload, day: Day): string {
  return `day ${plan.days.indexOf(day) + 1} of ${plan.days.length}`;
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
      const plan = stored.plan;
      const cover = coverOf(plan);
      const tag =
        s.status === 'active'
          ? `Day ${daysBetween(plan.startDate, todayIso) + 1} of ${plan.days.length}`
          : s.status === 'upcoming'
            ? `Starts in ${daysBetween(todayIso, plan.startDate)} days`
            : 'Finished';
      return `<li><button class="trip" data-go="${esc(routeHash({ name: 'trip', tripId: stored.tripId }))}">
        <span class="pic">${cover ? `<img src="${esc(small(cover))}" alt="">` : ''}</span>
        <span><h3>${esc(s.title)}</h3>
          <p class="meta">${esc(niceDate(plan.startDate))} → ${esc(niceDate(plan.endDate))} · ${s.days} days</p>
          <p class="tag">${esc(tag)}</p></span>
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

/* ── Pantalla del viaje ──────────────────────────────────────────────── */

/**
 * La estancia de un día: la que dice el día o, si no dice ninguna (el día de
 * salida, un día de vuelo), la que cubre esa fecha. Así la pestaña de sitios
 * sigue enseñando la zona el día que se deja el hotel.
 */
function stayOf(plan: TripPayload, day: Day): Stay | undefined {
  return plan.stays.find((st) => st.id === day.stay) ?? plan.stays.find((st) => st.from <= day.date && day.date <= st.to);
}

/** Los días que se duermen en una estancia: por `day.stay`, o por fecha si el día no lo dice. */
function daysOfStay(plan: TripPayload, stay: Stay): Day[] {
  return plan.days.filter((d) => (d.stay ? d.stay === stay.id : stay.from <= d.date && d.date < stay.to));
}

export function tripScreen(state: AppState): string {
  const plan = state.plan;
  if (!plan) return `<p class="empty">Trip not found.</p>`;
  const todayIso = today(state.clock);
  const tripId = state.route.name === 'trip' ? state.route.tripId : '';
  const lang = plan.primaryLanguage;
  const cover = coverOf(plan);

  // La tarjeta de «hoy»: el día en curso o, fuera del viaje, el primero.
  const todayDay = plan.days.find((d) => d.date === todayIso) ?? plan.days[0];
  const todayStay = todayDay && plan.stays.find((st) => st.id === todayDay.stay);
  const todayCard = todayDay
    ? `<button class="today" ${areaStyle(areaColor(plan, todayStay?.area))} data-go="${esc(
        routeHash({ name: 'day', tripId, dayId: todayDay.id, tab: 'timeline' }),
      )}">
        <span><p class="eyebrow a">${todayDay.date === todayIso ? 'Today' : 'First day'} · ${esc(dayNumber(plan, todayDay))}${
          todayStay?.area ? ` · ${esc(todayStay.area)}` : ''
        }</p>
        <h3>${esc(pick(todayDay.title, lang) ?? todayDay.id)}</h3>
        <p class="meta">${esc(longDay(todayDay.date))}${todayDay.startTime ? ` · starts at ${esc(todayDay.startTime)}` : ''}</p></span>
        <span class="go">${ICONS.chev}</span></button>`
    : '';

  const stays = plan.stays
    .map((st, i) => {
      const color = areaColor(plan, st.area);
      const photo = areaPhoto(plan, st.area) ?? firstPhoto(st.place ? plan.places[st.place] : undefined);
      const days = daysOfStay(plan, st);
      const open = days.some((d) => d.date === todayIso) || (todayIso < plan.startDate && i === 0);
      const legs = (plan.bookings ?? []).filter((b) => b.date === st.to && (b.kind === 'flight' || b.kind === 'transfer'));
      const leg = legs[0];
      const rows = days
        .map(
          (d) => `<li><a href="${esc(routeHash({ name: 'day', tripId, dayId: d.id, tab: 'timeline' }))}" class="${
            d.date === todayIso ? 'is-today' : ''
          }"><span class="d">${esc(niceDate(d.date).replace(/ \w+$/, ''))}</span><span class="t">${esc(
            pick(d.title, lang) ?? d.id,
          )}</span></a></li>`,
        )
        .join('');
      return `<details ${open ? 'open' : ''} ${areaStyle(color)}>
        <summary class="stay">
          <span class="pic">${photo ? `<img src="${esc(small(photo))}" alt="">` : ''}<span class="n">${i + 1}</span></span>
          <span><h3>${esc(st.area ?? st.name)}</h3>
            <p class="meta">${days.length} night${days.length === 1 ? '' : 's'} · ${esc(niceDate(st.from))} → ${esc(niceDate(st.to))}</p>
            <p class="meta">${esc(st.name)}</p></span>
          <span class="open">${ICONS.chev}</span>
        </summary>
        <ul class="days">${rows}</ul>
      </details>
      ${
        leg
          ? `<div class="leg"><span class="chip">${legIcon(leg.kind, pick(leg.title, lang) ?? '')} ${esc(
              (pick(leg.title, lang) ?? '').split(' · ')[0],
            )}</span></div>`
          : ''
      }`;
    })
    .join('');

  return `${installBanner(state)}
    <div class="cover">${cover ? `<img src="${esc(cover.src)}" alt="">` : ''}<div class="shade"></div>
      <a class="back" href="#/">${ICONS.back} Trips</a>
      <div class="text"><p class="eyebrow">${esc(niceDate(plan.startDate))} – ${esc(niceDate(plan.endDate))}</p>
        <h1>${esc(pick(plan.title, lang) ?? tripId)}</h1>
        <p class="meta">${plan.days.length} days · ${plan.stays.length} stays</p></div></div>
    ${todayCard}
    <div class="section"><h2>Where we stay</h2><a class="chip" href="${esc(routeHash({ name: 'bookings', tripId }))}">All bookings</a></div>
    <div class="stays">${stays}</div>`;
}

/* ── Día ─────────────────────────────────────────────────────────────── */

const DAY_TABS: ReadonlyArray<readonly [DayTab, string]> = [
  ['timeline', 'Timeline'],
  ['places', 'Places'],
  ['bookings', 'Bookings'],
];

/**
 * El día tiene tres vistas: la línea de tiempo, los sitios y las reservas.
 *
 * En la línea de tiempo sólo va lo que hace falta para actuar en la próxima
 * hora: cuándo, dónde y el plazo que manda. El resto vive en la página de cada
 * parada, a un toque. No se marca nada: la línea de «ahora» la mueve el reloj.
 */
export function dayScreen(state: AppState): string {
  const plan = state.plan;
  const route = state.route;
  if (!plan || route.name !== 'day') return NOT_FOUND;
  const day = plan.days.find((d) => d.id === route.dayId);
  if (!day) return NOT_FOUND;

  const lang = plan.primaryLanguage;
  const stay = stayOf(plan, day);
  const tabs = DAY_TABS.map(
    ([tab, text]) =>
      `<button data-swap="${esc(routeHash({ ...route, tab }))}" aria-pressed="${route.tab === tab}">${text}</button>`,
  ).join('');

  const body =
    route.tab === 'places'
      ? placesBody(state, plan, route.tripId, day)
      : route.tab === 'bookings'
        ? bookingsBody(plan, route.tripId, day)
        : timelineBody(state, plan, route.tripId, day);

  return `<div class="screen" ${areaStyle(areaColor(plan, stay?.area))}>${installBanner(state)}
    <div class="bar"><a class="back grow" href="${esc(routeHash({ name: 'trip', tripId: route.tripId }))}">${ICONS.back} ${esc(
      pick(plan.title, lang) ?? 'Trip',
    )}</a>${pager(plan, route)}</div>
    <p class="eyebrow a">${esc(longDay(day.date))}${stay?.area ? ` · ${esc(stay.area)}` : ''} · ${esc(dayNumber(plan, day))}</p>
    <h1>${esc(pick(day.title, lang) ?? day.id)}</h1>
    <div class="tabs">${tabs}</div>
    ${body}</div>`;
}

/** Las flechas de anterior y siguiente. Hacen lo mismo que deslizar el dedo. */
function pager(plan: TripPayload, route: Route): string {
  const { prev, next } = neighbours(plan, route);
  const arrow = (to: Route | null, glyph: string, text: string) =>
    to
      ? `<button class="chip" data-swap="${esc(routeHash(to))}" aria-label="${text}">${glyph}</button>`
      : `<span class="chip off" aria-hidden="true">${glyph}</span>`;
  return `<div class="arrows">${arrow(prev, ICONS.back, 'Previous')}${arrow(next, ICONS.chev, 'Next')}</div>`;
}

type Stop = Schedule['stops'][number];

/* ── Línea de tiempo ─────────────────────────────────────────────────── */

function timelineBody(state: AppState, plan: TripPayload, tripId: string, day: Day): string {
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

  return `${intro ? `<p class="intro">${esc(intro)}</p>` : ''}
    ${dayMapFigure(state, plan, day)}
    ${deadlinePanel(plan, day, schedule, now)}
    ${rows.length ? `<ul class="tl">${rows.join('')}</ul>` : '<p class="empty">Nothing planned yet.</p>'}`;
}

const nowLine = (now: number) => `<li class="nowline">Now · ${esc(formatClock(now))}</li>`;

/** La estancia a la que pertenece un sitio de categoría `lodging`, para abrir su página. */
function stayOfPlace(plan: TripPayload, day: Day, placeId: string): Stay | undefined {
  return plan.stays.find((st) => st.place === placeId) ?? stayOf(plan, day);
}

function stopRow(plan: TripPayload, tripId: string, day: Day, stop: Stop, now: number | null): string {
  const w = stop.waypoint;
  const place = plan.places[w.place];
  const lang = plan.primaryLanguage;
  const isMeal = (w.choices?.length ?? 0) > 0;
  const isSight = !!place && !NOT_SIGHTS.has(place.category ?? '') && !isMeal;

  const past = now !== null && stop.leave <= now;
  const current = now !== null && stop.arrive <= now && now < stop.leave;
  const classes = [
    w.priority === 'key' ? 'key' : '',
    w.priority === 'optional' ? 'optional' : '',
    isMeal ? 'meal' : '',
    past ? 'past' : '',
    current ? 'current' : '',
  ]
    .filter(Boolean)
    .join(' ');

  // El hotel abre su propia página; lo demás, la de la parada.
  const stay = place?.category === 'lodging' ? stayOfPlace(plan, day, w.place) : undefined;
  const href = stay
    ? routeHash({ name: 'hotel', tripId, stayId: stay.id })
    : routeHash({ name: 'stop', tripId, dayId: day.id, waypointId: w.id });

  const photo = isSight ? firstPhoto(place) : undefined;
  const icon = photo ? `<img src="${esc(small(photo))}" alt="" loading="lazy">` : categoryIcon(place?.category);

  const dead = w.anchor ? withTime(pick(w.anchor.label, lang) ?? w.anchor.type, w.anchor.time) : '';
  const closed = closedOnArrival(place, day, stop) ? 'Closed when you arrive' : '';
  const note = firstNote(w.notes);
  const choices = (w.choices ?? [])
    .map((id) => plan.places[id])
    .filter((pl): pl is Place => !!pl)
    .map((pl) => {
      const ph = firstPhoto(pl);
      return `<a class="chip ${ph ? '' : 'plain'}" href="${esc(
        routeHash({ name: 'place', tripId, dayId: day.id, placeId: pl.id }),
      )}">${ph ? `<img src="${esc(small(ph))}" alt="" loading="lazy">` : ''}${esc(pl.name)}</a>`;
    })
    .join('');

  return `<li class="${classes}">
    <div class="t">${esc(formatClock(stop.arrive))}${
      w.duration >= 15 ? `<small>until ${esc(formatClock(stop.leave))}</small>` : ''
    }</div>
    <div class="ic">${icon}</div>
    <div class="body"><a class="name" href="${esc(href)}">${esc(place?.name ?? w.place)}</a>
      ${dead ? `<p class="dead">${esc(dead)}</p>` : ''}
      ${closed ? `<p class="note warn">${closed}</p>` : ''}
      ${note ? `<p class="note ${note.type === 'warn' ? 'warn' : ''}">${esc(pick(note.text, lang) ?? '')}</p>` : ''}
      ${choices ? `<div class="chips">${choices}</div>` : ''}
    </div></li>`;
}

const closedOnArrival = (place: Place | undefined, day: Day, stop: Stop): boolean =>
  !!place && isOpenAt(place.hours, day.date, stop.arrive).state === 'closed';

/** Muchas etiquetas ya dicen la hora; repetirla detrás sólo mete ruido. */
const withTime = (text: string, time: string) => (text.includes(time) ? text : `${text} · ${time}`);

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

  const text = (s: Stop) =>
    pick(s.waypoint.anchor!.label, lang) ?? plan.places[s.waypoint.place]?.name ?? s.waypoint.place;
  const next = now === null ? deadlines[0] : deadlines.find((s) => parseAnchor(s) > now);

  if (day.type !== 'transit') {
    if (!next) return '';
    const at = parseAnchor(next);
    const left = now === null ? '' : ` · ${formatDuration(at - now)} left`;
    return `<div class="alert amber"><p>${esc(withTime(text(next), next.waypoint.anchor!.time))}${esc(left)}</p></div>`;
  }

  const big = (t: string) =>
    `<h1 style="font-size:3rem;font-variant-numeric:tabular-nums;margin:.2rem 0">${esc(t)}</h1>`;

  if (!next) {
    return `<div class="panel">
      <p class="meta">${esc(text(deadlines[deadlines.length - 1]))}</p>
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
      <p class="meta">${esc(text(next))}</p>
      ${big(next.waypoint.anchor!.time)}
      <p class="verdict ok">${esc(beThere || `The plan starts at ${day.startTime}`)}</p>
    </div>`;
  }

  const left = at - now;
  const urgent = left <= 30;
  return `<div class="panel">
    <p class="meta">${esc(text(next))}</p>
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

/* ── Sitios ──────────────────────────────────────────────────────────── */

const NEARBY_FILTERS: ReadonlyArray<readonly [NearbyFilter, string]> = [
  ['all', 'All'],
  ['see', 'See & do'],
  ['eat', 'Eat'],
];

/** Una fila de sitio: foto cuadrada, categoría, nombre y una línea. */
function spot(plan: TripPayload, tripId: string, day: Day, pl: Place, line: string): string {
  const ph = firstPhoto(pl);
  return `<li><a class="spot" href="${esc(routeHash({ name: 'place', tripId, dayId: day.id, placeId: pl.id }))}">
    <span class="pic">${ph ? `<img src="${esc(small(ph))}" alt="" loading="lazy">` : categoryIcon(pl.category)}</span>
    <span><p class="eyebrow">${esc(label(pl.category))}</p><span class="name">${esc(pl.name)}</span>${
      line ? `<p class="line">${esc(line)}</p>` : ''
    }</span></a></li>`;
}

/**
 * Lo que se visita hoy, en el orden del día pero sin horas (para eso está la
 * línea de tiempo); las comidas con sus opciones; y todo lo demás apuntado en
 * la zona, por cercanía. Es el plan B: si algo está cerrado, llueve o no
 * apetece, aquí hay de dónde tirar.
 */
function placesBody(state: AppState, plan: TripPayload, tripId: string, day: Day): string {
  const lang = plan.primaryLanguage;
  const schedule = computeSchedule(day);
  const seen = new Set<string>();
  const sights: string[] = [];
  const meals: string[] = [];

  for (const s of schedule.stops) {
    const w = s.waypoint;
    const pl = plan.places[w.place];
    if (!pl) continue;
    if (w.choices?.length) {
      const options = w.choices
        .map((id) => plan.places[id])
        .filter((p): p is Place => !!p && !seen.has(p.id))
        .map((p) => {
          seen.add(p.id);
          return spot(plan, tripId, day, p, pick(p.deep, lang) ?? '');
        })
        .join('');
      meals.push(`<li><p class="eyebrow a">${esc(pl.name)} · pick by mood</p><ul class="spots">${options}</ul></li>`);
      continue;
    }
    if (NOT_SIGHTS.has(pl.category ?? '') || seen.has(pl.id)) continue;
    seen.add(pl.id);
    const ph = firstPhoto(pl);
    sights.push(`<li><a class="card" href="${esc(routeHash({ name: 'stop', tripId, dayId: day.id, waypointId: w.id }))}">
      <span class="pic">${ph ? `<img src="${esc(small(ph))}" alt="" loading="lazy">` : categoryIcon(pl.category)}</span>
      <p class="eyebrow">${esc(label(pl.category))}</p><h3>${esc(pl.name)}</h3>
      <p class="line">${esc(pick(pl.deep, lang) ?? '')}</p></a></li>`);
  }

  // Lo demás de la zona, medido desde el hotel o, si se ha pedido, desde donde se está.
  const stay = stayOf(plan, day);
  const area = stay?.area;
  const hotel = stay?.place ? plan.places[stay.place]?.coords : null;
  const fromMe = state.nearbySort === 'me' && !!state.position;
  const origin = fromMe ? state.position : hotel;
  const metres = (pl: Place) => (origin && pl.coords ? haversine(origin, pl.coords) : null);
  const kind = (pl: Place) => (pl.category === 'food' ? 'eat' : 'see');

  const near = Object.values(plan.places)
    .filter((pl) => area && pl.area === area && !NOT_SIGHTS.has(pl.category ?? '') && !seen.has(pl.id))
    .filter((pl) => state.nearby === 'all' || kind(pl) === state.nearby)
    .sort((a, b) => {
      const da = metres(a);
      const db = metres(b);
      if (da !== null && db !== null) return da - db;
      if (da !== null || db !== null) return da !== null ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .map((pl) => {
      const away = metres(pl);
      const where = away !== null ? `${formatDistance(away)} ${fromMe ? 'from you' : 'from the hotel'}` : '';
      return spot(plan, tripId, day, pl, [where, pick(pl.deep, lang) ?? ''].filter(Boolean).join(' · '));
    })
    .join('');

  const chips = NEARBY_FILTERS.map(
    ([key, text]) =>
      `<button class="chip" data-act="nearby" data-filter="${key}" aria-pressed="${state.nearby === key}">${text}</button>`,
  ).join('');
  const fromWhere = hotel
    ? `<button class="chip" data-act="nearby-sort" data-sort="${fromMe ? 'hotel' : 'me'}">${
        fromMe ? 'From the hotel' : 'From where I am'
      }</button>`
    : '';

  return `${sights.length ? `<div class="section"><h2>Today</h2><span class="meta">${sights.length} place${sights.length === 1 ? '' : 's'}</span></div><ul class="cards">${sights.join('')}</ul>` : ''}
    ${meals.length ? `<div class="section"><h2>Food &amp; snacks</h2><span class="meta">by mood</span></div><ul class="meals">${meals.join('')}</ul>` : ''}
    <div class="section"><h2>Also around here</h2><span class="meta">${esc(area ?? '')}</span></div>
    <div class="filters">${chips}<span class="grow"></span>${fromWhere}</div>
    ${near ? `<ul class="spots">${near}</ul>` : '<p class="empty">Nothing else listed for this area yet.</p>'}`;
}

/* ── Reservas ────────────────────────────────────────────────────────── */

/** Lo que una tarjeta de reserva necesita, venga de `stays` o de `bookings`. */
interface BookingCard {
  date: string;
  kind: string;
  icon: string;
  when: string;
  title: string;
  href?: string;
  status?: Booking['status'];
  ref?: string | null;
  provider?: string | null;
  place?: Place;
  lines: string[];
}

function cardOfStay(plan: TripPayload, tripId: string, stay: Stay): BookingCard {
  const lang = plan.primaryLanguage;
  const place = stay.place ? plan.places[stay.place] : undefined;
  return {
    date: stay.from,
    kind: 'Hotel',
    icon: ICONS.bed,
    when: `${niceDate(stay.from)} → ${niceDate(stay.to)}`,
    title: stay.name,
    href: routeHash({ name: 'hotel', tripId, stayId: stay.id }),
    ref: stay.confirmation,
    place,
    lines: [pick(stay.notes, lang)].filter((l): l is string => !!l),
  };
}

function cardOfBooking(plan: TripPayload, b: Booking): BookingCard {
  const lang = plan.primaryLanguage;
  return {
    date: b.date,
    kind: { flight: 'Flight', activity: 'Activity', transfer: 'Transfer' }[b.kind],
    icon: b.kind === 'flight' ? ICONS.plane : b.kind === 'transfer' ? ICONS.car : ICONS.walk,
    when: niceDate(b.date),
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
  const body = `<div class="ic">${c.icon}</div><div>
    <p class="eyebrow">${esc(c.kind)} · ${esc(c.when)}</p>
    <h3>${esc(c.title)}</h3>
    ${c.ref ? `<p class="ref">${esc(c.ref)}</p>` : ''}
    ${status}
    <dl>
      ${c.provider ? `<dt>With</dt><dd>${esc(c.provider)}</dd>` : ''}
      ${c.place?.address ? `<dt>Address</dt><dd>${esc(c.place.address)}</dd>` : ''}
      ${phone ? `<dt>Phone</dt><dd>${esc(phone)}</dd>` : ''}
    </dl>
    ${c.lines.length ? `<ul>${c.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
  </div>`;
  return c.href
    ? `<a class="panel bk" href="${esc(c.href)}">${body}</a>`
    : `<div class="panel bk">${body}</div>`;
}

/** Las reservas que hacen falta ese día: el vuelo, lo reservado y dónde se duerme. */
function bookingsBody(plan: TripPayload, tripId: string, day: Day): string {
  const cards = [
    ...(plan.bookings ?? []).filter((b) => b.date === day.date).map((b) => cardOfBooking(plan, b)),
    // El día de salida de un hotel también cuenta: hay que dejar la habitación.
    ...plan.stays
      .filter((st) => st.from <= day.date && day.date <= st.to)
      .map((st) => cardOfStay(plan, tripId, st)),
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
    ...plan.stays.map((st) => cardOfStay(plan, route.tripId, st)),
  ].sort((x, y) => x.date.localeCompare(y.date));

  return `<div class="bar"><a class="back" href="${esc(routeHash({ name: 'trip', tripId: route.tripId }))}">${ICONS.back} ${esc(
    pick(plan.title, plan.primaryLanguage) ?? 'Trip',
  )}</a></div>
    <h1>Bookings</h1>
    ${cards.length ? cards.map(bookingCard).join('') : '<p class="empty">No bookings yet.</p>'}`;
}

/* ── Hotel ───────────────────────────────────────────────────────────── */

/**
 * La página del hotel: la foto, la dirección en el idioma local en grande
 * (es lo que se enseña al taxista), el mapa y el teléfono, y los datos de la
 * estancia.
 */
export function hotelScreen(state: AppState): string {
  const plan = state.plan;
  const route = state.route;
  if (!plan || route.name !== 'hotel') return NOT_FOUND;
  const stay = plan.stays.find((st) => st.id === route.stayId);
  if (!stay) return `<p class="empty">Stay not found.</p>`;
  const lang = plan.primaryLanguage;
  const place = stay.place ? plan.places[stay.place] : undefined;
  const todayIso = today(state.clock);
  const nights = daysBetween(stay.from, stay.to);
  const tonight = stay.from <= todayIso && todayIso < stay.to ? daysBetween(stay.from, todayIso) + 1 : 0;

  const photo = firstPhoto(place);
  const hero = photo ? heroFigure(photo, lang) : '';
  const local = [place?.nameLocal, place?.addressLocal].filter((s): s is string => !!s);
  const taxi = local.length
    ? `<div class="taxi"><p class="eyebrow">Show this to the taxi driver</p>${local
        .map((l) => `<p class="thai">${esc(l)}</p>`)
        .join('')}</div>`
    : '';
  const phone = place?.contact?.phone;
  const maps = place ? mapsUrl(place) : null;
  const buttons = [
    maps ? `<a class="btn ghost" href="${esc(maps)}" target="_blank" rel="noopener">${ICONS.pin} Google Maps</a>` : '',
    phone ? `<a class="btn ghost" href="tel:${esc(phone)}">${ICONS.phone} ${esc(phone)}</a>` : '',
  ].join('');
  const notes = [pick(stay.notes, lang), pick(place?.deep, lang)].filter((s): s is string => !!s);
  const facts = (place?.facts ?? []).map((f) => `<li>${esc(pick(f.text, lang) ?? '')}</li>`).join('');

  return `<div class="screen place" ${areaStyle(areaColor(plan, stay.area))}>
    <div class="bar"><button class="back" data-act="back">${ICONS.back} Back</button><span class="eyebrow a">Hotel${
      stay.area ? ` · ${esc(stay.area)}` : ''
    }</span></div>
    ${hero}
    <h1>${esc(stay.name)}</h1>
    ${place?.address ? `<p class="meta">${esc(place.address)}</p>` : ''}
    ${taxi}
    ${buttons ? `<div class="btns">${buttons}</div>` : ''}
    <dl class="facts">
      <dt>Stay</dt><dd>${esc(niceDate(stay.from))} → ${esc(niceDate(stay.to))} · ${nights} night${nights === 1 ? '' : 's'}</dd>
      ${tonight ? `<dt>Tonight</dt><dd>Night ${tonight} of ${nights}</dd>` : ''}
      ${stay.confirmation ? `<dt>Confirmation</dt><dd>${esc(stay.confirmation)}</dd>` : ''}
    </dl>
    ${notes.map((n) => `<p class="lead">${esc(n)}</p>`).join('')}
    ${facts ? `<details class="panel"><summary>Good to know</summary><ul>${facts}</ul></details>` : ''}
  </div>`;
}

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
  const stay = stayOf(plan, day);
  const back = `<div class="bar"><a class="back grow" href="${esc(
    routeHash({ name: 'day', tripId: route.tripId, dayId: day.id, tab: 'timeline' }),
  )}">${ICONS.back} ${esc(pick(day.title, lang) ?? day.id)}</a>${pager(plan, route)}</div>`;
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

  const open = isOpenAt(place.hours, day.date, stop.arrive);
  let conflict = '';
  if (open.state === 'closed') {
    const windows = open.windows.map((r) => `${r[0]}–${r[1]}`).join(', ') || 'closed all day';
    conflict = `<p class="conflict">${
      whyClosed(open.windows, stop.arrive) === 'too-early'
        ? `You arrive at ${esc(formatClock(stop.arrive))} and it does not open until ${esc(windows)}`
        : `You arrive at ${esc(formatClock(stop.arrive))} and it closes ${esc(windows)}`
    }</p>`;
  }

  const choices = (w.choices ?? [])
    .map((id) => plan.places[id])
    .filter((pl): pl is Place => !!pl)
    .map((pl) => spot(plan, route.tripId, day, pl, pick(pl.deep, lang) ?? ''))
    .join('');

  return `<div class="screen place" ${areaStyle(areaColor(plan, stay?.area))}>${back}
    ${placeDetail(place, day, lang, stay?.area, {
      under: `<p class="meta">${esc(when)}${esc(travel)}</p>${anchor}${conflict}`,
      notes: w.notes ?? [],
      after: choices ? `<div class="section options"><h2>Pick by mood</h2></div><ul class="spots">${choices}</ul>` : '',
    })}</div>`;
}

/** Un sitio de la zona que no está (o no sólo) en el plan de ese día. */
export function placeScreen(state: AppState): string {
  const plan = state.plan;
  const route = state.route;
  if (!plan || route.name !== 'place') return NOT_FOUND;
  const day = plan.days.find((d) => d.id === route.dayId);
  const place = plan.places[route.placeId];
  if (!day || !place) return NOT_FOUND;
  const stay = stayOf(plan, day);

  // Se vuelve con el «atrás» del navegador: a un sitio se llega desde la
  // pestaña de sitios o desde las opciones de una parada.
  return `<div class="screen place" ${areaStyle(areaColor(plan, stay?.area))}>
    <div class="bar"><button class="back" data-act="back">${ICONS.back} Back</button><span class="eyebrow a">${esc(
      [label(place.category), place.area].filter(Boolean).join(' · '),
    )}</span></div>
    ${placeDetail(place, day, plan.primaryLanguage, stay?.area, { under: '', notes: [], after: '' })}</div>`;
}

function heroFigure(photo: Photo, lang: string): string {
  const caption = pick(photo.caption, lang);
  return `<figure class="hero"><img src="${esc(photo.src)}" alt="">${
    caption || photo.credit
      ? `<figcaption>${esc(caption ?? '')}${photo.credit ? `<span class="credit">${esc(photo.credit)}</span>` : ''}</figcaption>`
      : ''
  }</figure>`;
}

/**
 * Lo común a parada y sitio: la foto de portada, la descripción, los datos, la
 * lectura larga con las demás fotos repartidas entre sus secciones, y la letra
 * pequeña plegada.
 */
function placeDetail(
  place: Place,
  day: Day,
  lang: string,
  area: string | null | undefined,
  extra: { under: string; notes: Note[]; after: string },
): string {
  const photos = photosOf(place);
  const hero = photos[0] ? heroFigure(photos[0], lang) : '';

  const warnings = extra.notes
    .filter((n) => n.type === 'warn')
    .map((n) => `<p class="verdict">${esc(pick(n.text, lang) ?? '')}</p>`)
    .join('');

  const about = pick(place.deep, lang);
  const story = pick(place.story, lang);

  // Las fotos que sobran se reparten entre las secciones del texto, con su pie.
  const figure = (p: Photo) => {
    const caption = pick(p.caption, lang);
    return `<figure><img src="${esc(p.src)}" alt="" loading="lazy"><figcaption>${esc(caption ?? '')}${
      p.credit ? `<span class="credit">${esc(p.credit)}</span>` : ''
    }</figcaption></figure>`;
  };
  let article = '';
  if (story) {
    const rest = photos.slice(1);
    const sections = storySections(story).map((s, i) => s + (rest[i] ? figure(rest[i]) : ''));
    // Si hay más fotos que secciones, las que quedan van al final.
    const tail = rest.slice(sections.length).map(figure).join('');
    // Los minutos de lectura sólo tienen sentido en una lectura larga.
    const minutes = story.split(/\s+/).length >= 150 ? `<p class="meta">${readingMinutes(story)} min read</p>` : '';
    article = `<article class="story">${minutes}${sections.join('')}${tail}</article>`;
  } else if (photos.length > 1) {
    article = `<article class="story">${photos.slice(1).map(figure).join('')}</article>`;
  }

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

  return `${hero}
    <h1>${esc(place.name)}</h1>
    ${place.nameLocal && place.nameLocal !== place.name ? `<p class="meta">${esc(place.nameLocal)}</p>` : ''}
    ${extra.under}
    ${warnings}
    ${about ? `<p class="lead">${esc(about)}</p>` : ''}
    ${extra.after}
    ${placeFacts(place, day, lang)}
    ${placeLinks(place, lang)}
    ${article}
    ${
      fineprint.length
        ? `<details class="panel"><summary>Good to know · ${fineprint.length}</summary><ul>${fineprint.join('')}</ul></details>`
        : ''
    }
    ${place.links?.guide ? `<p class="meta">Rough Guide: ${esc(place.links.guide)}</p>` : ''}`;
}

/**
 * Enlace a Google Maps para leer reseñas y ver fotos. Necesita red, y se busca
 * por nombre y zona, no por coordenadas: unas coordenadas abren un punto en el
 * mapa, no la ficha del sitio.
 */
function mapsUrl(place: Place): string | null {
  // Un hueco genérico («comer por aquí») no es un sitio que buscar.
  if (!place.links?.maps && !place.coords && !place.address) return null;
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
 */
function placeLinks(place: Place, lang: string): string {
  const https = (u: string | null | undefined): u is string => !!u && /^https:\/\//.test(u);
  const btn = (url: string, icon: string, text: string) =>
    `<a class="btn ghost" href="${esc(url)}" target="_blank" rel="noopener">${icon} ${text}</a>`;
  const maps = mapsUrl(place);
  const wiki = pick(place.links?.wikipedia, lang);
  const site = place.links?.official ?? place.contact?.url;
  const buttons = [
    https(maps) ? btn(maps, ICONS.pin, 'Google Maps') : '',
    https(wiki) ? btn(wiki, ICONS.ext, 'Wikipedia') : '',
    https(site) ? btn(site, ICONS.ext, 'Website') : '',
  ].join('');
  return buttons ? `<div class="btns">${buttons}</div>` : '';
}

/** Los datos de consulta rápida. Una fila sólo sale si hay algo que decir. */
function placeFacts(place: Place, day: Day, lang: string): string {
  const rows: string[] = [];

  const windows = windowsFor(place.hours, day.date);
  const allDay = windows?.length === 1 && windows[0][0] === '00:00' && windows[0][1] >= '23:59';
  // Una playa, una excursión reservada o un pueblo no «abren»: sin horario no se dice nada.
  const hasHours = ['temple', 'museum', 'market', 'park', 'food', 'viewpoint'].includes(place.category ?? '');
  if (!windows) {
    if (hasHours) rows.push(`<dt>Open today</dt><dd>unknown</dd>`);
  } else if (!allDay) {
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
  return `<dl class="facts">${rows.join('')}${costNote ? `<dt></dt><dd class="meta">${esc(costNote)}</dd>` : ''}</dl>`;
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

  return `<div class="bar"><a class="back" href="#/">${ICONS.back} Trips</a><h1>Settings</h1></div>

  <div class="panel">
    <h3>Text size</h3>
    <div class="acts">${TEXT_SIZES.map(
      ([size, text]) =>
        `<button data-act="text-size" data-size="${size}" aria-pressed="${state.textSize === size}">${text}</button>`,
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
        : `<div class="btns"><button class="btn" data-act="spike-write">Write 150 MB</button>
           <button class="btn ghost" data-act="spike-verify">Check reading</button>
           ${spike.info.exists ? '<button class="btn ghost" data-act="spike-delete">Delete</button>' : ''}</div>`
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
  </div>

  <p class="meta">App version ${esc(APP_VERSION)}</p>`;
}
