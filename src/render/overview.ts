/**
 * Vista general del viaje: todos los días, los sitios por zona, las reservas y
 * lo que falta, en una sola página para mirar desde el ordenador.
 *
 * Sale del archivo de viaje igual que la app, así que nunca se desfasa: se
 * vuelve a generar después de cada sesión de planificación. Es la versión
 * imprimible del plan entero.
 *
 * Devuelve el contenido de la página sin `<!doctype>` ni `<html>`, que es lo
 * que espera la publicación como Artifact; `wrapPage` lo completa para abrirlo
 * como archivo suelto.
 */

import type { TripPayload, Day, Place, Stay, Booking } from '../model/types.ts';
import { computeSchedule } from '../core/schedule.ts';
import { formatClock, formatDuration } from '../core/time.ts';
import { pick, esc } from './day.ts';

export interface OverviewOptions {
  /** Cuándo se generó, para saber si la página está al día. ISO. */
  generatedAt?: string;
  /** Versión del archivo de viaje de la que sale. */
  version?: number;
  /** Cambios opcionales que se están pensando; viven fuera del archivo de viaje. */
  ideas?: Idea[];
  /** Tareas propias que no salen del archivo de viaje (p. ej. «hacer el GPT de Agatka»). */
  tasks?: Task[];
}

export interface Task {
  text: string;
  /** Cuándo hacerla, en texto libre: «Sunday 18 Oct», «later». */
  when?: string | null;
}

/**
 * Un cambio que se baraja pero no está decidido. No forma parte del formato del
 * viaje: es una lista de trabajo que se guarda al lado del archivo.
 */
export interface Idea {
  id: string;
  title: string;
  /** Día al que afectaría, ISO. `null` si no tiene día. */
  date: string | null;
  replaces?: string | null;
  why?: string | null;
  cost?: string | null;
  status?: 'idea' | 'accepted' | 'dropped';
  source?: string | null;
}

/** `outline` = día sin paradas pero con la idea escrita en `intro`. */
type Status = 'planned' | 'travel' | 'outline' | 'open';

/** Un tramo: noches seguidas en la misma zona. Bangkok sale dos veces. */
interface Leg {
  key: string;
  area: string;
  stay: Stay | null;
  days: Day[];
}

const CATEGORY_LABEL: Record<string, string> = {
  food: 'Eat',
  temple: 'Temple',
  market: 'Market',
  activity: 'Activity',
  lodging: 'Hotel',
  transport: 'Transport',
};

export function renderOverview(plan: TripPayload, opts: OverviewOptions = {}): string {
  const lang = plan.primaryLanguage ?? 'en';
  const title = pick(plan.title, lang) ?? 'Trip';
  const legs = buildLegs(plan);
  const usage = placeUsage(plan);

  const counts = { planned: 0, travel: 0, outline: 0, open: 0 };
  for (const d of plan.days) counts[dayStatus(d)]++;

  return `<title>${esc(title)}</title>
<style>${STYLE}</style>
<div class="page">
<header class="top">
  <p class="eyebrow">Trip overview${opts.version ? ` · file version ${opts.version}` : ''}${
    opts.generatedAt ? ` · updated ${esc(shortStamp(opts.generatedAt))}` : ''
  }</p>
  <h1>${esc(title)}</h1>
  <p class="dates">${esc(dayMonth(plan.startDate))} – ${esc(dayMonth(plan.endDate, true))} · ${plan.days.length} days${
    plan.travellers ? ` · ${esc(travellers(plan.travellers))}` : ''
  }</p>
  <div class="progress" aria-label="Days by status">
    ${progressBar(plan.days)}
    <p class="legend">
      <span><i class="dot planned"></i>${counts.planned} planned</span>
      <span><i class="dot travel"></i>${counts.travel} travel</span>
      <span><i class="dot outline"></i>${counts.outline} outline only</span>
      <span><i class="dot open"></i>${counts.open} still open</span>
    </p>
  </div>
  <nav class="jump">
    <a href="#days">Days</a><a href="#ideas">Optional changes</a><a href="#places">Places</a><a href="#bookings">Bookings</a><a href="#todo">To do</a>
  </nav>
</header>

${routeStrip(legs)}

<section id="days">
  <h2>Days <span class="tools"><button type="button" data-all="open" data-in="days">Open all</button><button type="button" data-all="close" data-in="days">Close all</button></span></h2>
  ${legs.map((leg) => legBlock(plan, leg, lang, opts.ideas ?? [])).join('\n')}
</section>

${ideasBlock(plan, opts.ideas ?? [])}

<section id="places">
  <h2>Places <span class="tools"><button type="button" data-all="open" data-in="places">Open all</button><button type="button" data-all="close" data-in="places">Close all</button></span></h2>
  <p class="lede">Everything recorded for each area, planned or not. The day tag shows where a place is used.</p>
  ${placesByArea(plan, legs, usage)}
</section>

<section id="bookings">
  <h2>Bookings</h2>
  ${bookingsBlock(plan, lang)}
</section>

<section id="todo">
  <h2>To do</h2>
  ${todoBlock(plan, lang, opts.tasks ?? [])}
</section>
</div>
<button type="button" class="back" hidden>← Back</button>
<script>${SCRIPT}</script>`;
}

/**
 * Un enlace interno abre los desplegables que esconden su destino, y el botón
 * «Back» devuelve a donde se estaba. Sin el script la página se lee igual,
 * solo que hay que abrir a mano.
 */
const SCRIPT = `
const back = document.querySelector('.back');
const trail = [];
function reveal(el) {
  for (let d = el.closest('details'); d; d = d.parentElement.closest('details')) d.open = true;
  if (el.tagName === 'LI' && el.firstElementChild?.tagName === 'DETAILS') el.firstElementChild.open = true;
}
document.addEventListener('click', (e) => {
  const tools = e.target.closest('[data-all]');
  if (tools) {
    const open = tools.dataset.all === 'open';
    document.getElementById(tools.dataset.in).querySelectorAll(':scope details:not(.stop):not(.choice):not(.idea):not(.place)')
      .forEach((d) => { d.open = open; });
    return;
  }
  const a = e.target.closest('a[href^="#"]');
  if (!a) return;
  const target = document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)));
  if (!target) return;
  e.preventDefault();
  trail.push(window.scrollY);
  reveal(target);
  target.scrollIntoView({ block: 'start' });
  target.classList.remove('flash'); void target.offsetWidth; target.classList.add('flash');
  back.hidden = false;
});
back.addEventListener('click', () => {
  window.scrollTo(0, trail.pop() ?? 0);
  back.hidden = trail.length === 0;
});
`;

/** Para abrir el HTML como archivo, fuera de un Artifact. */
export function wrapPage(body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
${body}
</body>
</html>`;
}

/* ── días ────────────────────────────────────────────────────────────── */

export function dayStatus(d: Day): Status {
  if (d.waypoints.length) return d.type === 'transit' ? 'travel' : 'planned';
  return Object.values(d.intro ?? {}).some((v) => typeof v === 'string' && v.trim()) ? 'outline' : 'open';
}

const STATUS_LABEL: Record<Status, string> = { planned: 'Planned', travel: 'Travel', outline: 'Outline', open: 'Open' };

function buildLegs(plan: TripPayload): Leg[] {
  const legs: Leg[] = [];
  for (const day of plan.days) {
    const stay = plan.stays.find((s) => s.id === day.stay) ?? null;
    const key = stay?.id ?? 'travel';
    const last = legs[legs.length - 1];
    if (last && last.key === key) last.days.push(day);
    else legs.push({ key, area: stay?.area ?? stay?.name ?? 'On the move', stay, days: [day] });
  }
  return legs;
}

function routeStrip(legs: Leg[]): string {
  const items = legs
    .filter((l) => l.stay)
    .map((l) => {
      const nights = nightsBetween(l.stay!.from, l.stay!.to);
      return `<li><b>${esc(l.area)}</b><span>${nights} night${nights === 1 ? '' : 's'}</span></li>`;
    })
    .join('');
  return `<ol class="route" aria-label="Route">${items}</ol>`;
}

function legBlock(plan: TripPayload, leg: Leg, lang: string, ideas: Idea[]): string {
  const s = leg.stay;
  const head = s
    ? `<h3>${esc(leg.area)}</h3><p class="leg-meta">${esc(dayMonth(s.from))} – ${esc(dayMonth(s.to))} · ${esc(s.name)}</p>`
    : `<h3>${esc(leg.area)}</h3>`;
  return `<div class="leg">${head}<ol class="days">${leg.days.map((d) => dayRow(plan, d, lang, ideas)).join('')}</ol></div>`;
}

function dayRow(plan: TripPayload, day: Day, lang: string, ideas: Idea[]): string {
  const status = dayStatus(day);
  const mine = ideas.filter((i) => i.date === day.date && (i.status ?? 'idea') === 'idea');
  const ideaTag = mine.length
    ? ` <span class="tag idea">${mine.length} optional change${mine.length === 1 ? '' : 's'}</span>`
    : '';
  const summary = `<span class="when"><b>${esc(weekday(day.date))}</b> ${esc(dayMonth(day.date))}</span>
      <span class="what">${esc(pick(day.title, lang) ?? day.id)}${ideaTag}</span>
      <span class="pill ${status}">${STATUS_LABEL[status]}</span>`;

  if (status === 'open') {
    return `<li id="${esc(day.id)}" class="day open"><div class="sum">${summary}</div></li>`;
  }

  const intro = pick(day.intro, lang);
  // Los cambios que se barajan para este día, plegados dentro del propio día.
  const dayIdeas = mine.length
    ? `<div class="day-ideas"><p class="lbl">Optional changes for this day</p>${mine.map((i) => ideaCard(plan, i, false)).join('')}</div>`
    : '';
  if (status === 'outline') {
    return `<li id="${esc(day.id)}" class="day outline"><details><summary class="sum">${summary}</summary>
    <div class="detail"><p class="intro">${esc(intro ?? '')}</p>${dayIdeas}</div></details></li>`;
  }

  const schedule = computeSchedule(day);
  const stops = schedule.stops
    .map(({ waypoint: w, arrive, leave }, i) => {
      const place = plan.places[w.place];
      const anchor = w.anchor
        ? `<span class="anchor ${w.anchor.hard ? 'hard' : ''}">${esc(pick(w.anchor.label, lang) ?? w.anchor.type)} · ${esc(w.anchor.time)}</span>`
        : '';
      const choices = (w.choices ?? []).map((id) => plan.places[id]).filter((p): p is Place => !!p);
      const key = w.priority === 'key' ? '<span class="key">Key</span>' : w.priority === 'optional' ? '<span class="opt">Optional</span>' : '';
      const head = `<span class="t">${esc(formatClock(arrive))}</span><span class="s">${esc(
        place?.name ?? w.place,
      )}${key}${anchor}${choices.length ? `<span class="choices">Pick from: ${choices.map((p) => esc(p.name)).join(', ')}</span>` : ''}</span>`;

      // Lo que hace falta para decidir si la parada está bien, sin salir del día.
      const timing: string[] = [];
      if (i > 0 && w.travelFrom) timing.push(`${formatDuration(w.travelFrom)} ${MODE_LABEL[w.travelMode ?? ''] ?? 'travel'} from the previous stop`);
      if (w.duration) timing.push(`${formatDuration(w.duration)} here, until ${formatClock(leave)}`);
      const notes = (w.notes ?? [])
        .map((n) => `<li class="${n.type === 'warn' ? 'warn' : ''}">${esc(pick(n.text, lang) ?? '')}</li>`)
        .join('');
      const options = choices
        .map((p) => `<details class="choice"><summary>${esc(p.name)}</summary>${placeBody(plan, p, lang)}</details>`)
        .join('');
      return `<li><details class="stop"><summary>${head}</summary><div class="stop-body">
        ${timing.length ? `<p class="timing">${esc(timing.join(' · '))}</p>` : ''}
        ${notes ? `<ul class="notes">${notes}</ul>` : ''}
        ${place ? placeBody(plan, place, lang) : ''}
        ${options ? `<div class="options"><p class="lbl">Options</p>${options}</div>` : ''}
      </div></details></li>`;
    })
    .join('');

  return `<li id="${esc(day.id)}" class="day ${status}"><details><summary class="sum">${summary}</summary>
    <div class="detail">${intro ? `<p class="intro">${esc(intro)}</p>` : ''}${dayIdeas}<ol class="stops">${stops}</ol></div>
  </details></li>`;
}

const MODE_LABEL: Record<string, string> = {
  walking: 'walk',
  driving: 'by car',
  transit: 'by transit',
  cycling: 'by bike',
  flight: 'flight',
};

/* ── cambios opcionales ──────────────────────────────────────────────── */

const IDEA_STATUS: Record<string, string> = { idea: 'To decide', accepted: 'Accepted', dropped: 'Dropped' };

function ideasBlock(plan: TripPayload, ideas: Idea[]): string {
  const order = (i: Idea) => (i.status === 'dropped' ? 2 : i.status === 'accepted' ? 1 : 0);
  const sorted = [...ideas].sort((a, b) => order(a) - order(b) || (a.date ?? '9').localeCompare(b.date ?? '9'));
  const rows = sorted.map((i) => `<li id="idea-${esc(i.id)}">${ideaCard(plan, i, true)}</li>`).join('');
  return `<section id="ideas">
  <h2>Optional changes</h2>
  <p class="lede">Ideas on the table, not in the plan yet. Each one says which day it would change and what it would replace.</p>
  ${rows ? `<ul class="ideas">${rows}</ul>` : '<p class="lede">None yet.</p>'}
</section>`;
}

/** Plegada: el título y el día a la vista, el porqué y el coste al abrirla. */
function ideaCard(plan: TripPayload, i: Idea, withDay: boolean): string {
  const day = i.date ? plan.days.find((d) => d.date === i.date) : null;
  const when = !withDay
    ? ''
    : day
      ? `<a class="when" href="#${esc(day.id)}">${esc(weekday(day.date))} ${esc(dayMonth(day.date))}</a>`
      : '<span class="when">Any day</span>';
  const st = i.status ?? 'idea';
  const line = (label: string, v?: string | null) => (v ? `<p><span class="lbl">${label}</span> ${esc(v)}</p>` : '');
  return `<details class="idea ${st}"><summary class="ih">${when}<b>${esc(i.title)}</b><span class="pill ${
    st === 'idea' ? 'outline' : st === 'accepted' ? 'planned' : 'open'
  }">${IDEA_STATUS[st] ?? st}</span></summary>
      <div class="idea-body">${line('Instead of', i.replaces)}${line('Why', i.why)}${line('Cost', i.cost)}${line('From', i.source)}</div>
    </details>`;
}

/* ── sitios ──────────────────────────────────────────────────────────── */

/** En qué días sale cada sitio, como parada o como opción para elegir. */
function placeUsage(plan: TripPayload): Map<string, Day[]> {
  const used = new Map<string, Day[]>();
  const add = (id: string, d: Day) => {
    const list = used.get(id) ?? [];
    if (!list.includes(d)) list.push(d);
    used.set(id, list);
  };
  for (const d of plan.days) {
    for (const w of d.waypoints) {
      add(w.place, d);
      for (const c of w.choices ?? []) add(c, d);
    }
  }
  return used;
}

/**
 * Los hoteles y aeropuertos no llevan `area`. Los hoteles se cuelgan de la zona
 * de su estancia; el transporte va aparte para no ensuciar las zonas.
 */
function areaOf(plan: TripPayload, p: Place): string | null {
  if (p.area) return p.area;
  const stay = plan.stays.find((s) => s.place === p.id);
  if (stay?.area) return stay.area;
  return null;
}

function placesByArea(plan: TripPayload, legs: Leg[], usage: Map<string, Day[]>): string {
  const areas: string[] = [];
  for (const l of legs) if (l.stay?.area && !areas.includes(l.stay.area)) areas.push(l.stay.area);

  const all = Object.values(plan.places);
  // Zonas sin alojamiento (excursiones de un día, como Ayutthaya) van detrás.
  for (const p of all) if (p.area && !areas.includes(p.area)) areas.push(p.area);
  const groups = areas.map((area) => ({
    area,
    places: all.filter((p) => areaOf(plan, p) === area),
  }));
  const transport = all.filter((p) => !areaOf(plan, p) && p.category === 'transport');
  const loose = all.filter((p) => !areaOf(plan, p) && p.category !== 'transport');

  const block = (name: string, places: Place[], note = '') => {
    // Primero lo que se va a ver o comer; el hotel y el transporte, al final.
    const order = (p: Place) => (p.category === 'lodging' ? 1 : p.category === 'transport' ? 2 : 0);
    const sorted = [...places].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
    const sights = places.filter((p) => p.category !== 'lodging' && p.category !== 'transport').length;
    const count = sights ? `${sights} place${sights === 1 ? '' : 's'} to see or eat` : 'nothing recorded yet';
    return `<details class="area"><summary><h3>${esc(name)} <span class="count">${count}</span></h3></summary>${note}
      ${sorted.length ? `<ul class="places">${sorted.map((p) => placeRow(plan, p, usage)).join('')}</ul>` : ''}</details>`;
  };

  return [
    ...groups.map((g) => block(g.area, g.places)),
    loose.length
      ? block('Not assigned to an area', loose, '<p class="lede">These need an area so they show up in the app’s Nearby tab.</p>')
      : '',
    transport.length ? block('Airports and transport', transport) : '',
  ].join('\n');
}

function placeRow(plan: TripPayload, p: Place, usage: Map<string, Day[]>): string {
  const lang = plan.primaryLanguage ?? 'en';
  const days = (usage.get(p.id) ?? [])
    .map((d) => `<a class="tag day" href="#${esc(d.id)}">${esc(dayMonth(d.date))}</a>`)
    .join('');
  return `<li id="p-${esc(p.id)}"><details class="place">
    <summary class="ph"><span class="cat">${esc(CATEGORY_LABEL[p.category ?? ''] ?? p.category ?? '')}</span><b>${esc(p.name)}</b>${days}</summary>
    ${placeBody(plan, p, lang)}
  </details></li>`;
}

/** Lo que se sabe de un sitio: descripción, enlaces, guía y lo que falta. Sale igual en el día y en la zona. */
function placeBody(plan: TripPayload, p: Place, lang: string): string {
  const unverified = (p.facts ?? []).filter((f) => f.confidence === 'unverified').length;

  const links: string[] = [];
  const maps = mapsUrl(p);
  if (maps) links.push(`<a href="${esc(maps)}" target="_blank" rel="noopener">Google Maps</a>`);
  const site = p.links?.official ?? p.contact?.url;
  if (site && /^https:\/\//.test(site)) links.push(`<a href="${esc(site)}" target="_blank" rel="noopener">Website</a>`);
  const wiki = pick(p.links?.wikipedia, lang);
  if (wiki && /^https:\/\//.test(wiki)) links.push(`<a href="${esc(wiki)}" target="_blank" rel="noopener">Wikipedia</a>`);

  const flags: string[] = [];
  if (!p.coords && !mealSlots(plan).has(p.id)) flags.push('<span class="flag">No location yet</span>');
  if (unverified) flags.push(`<span class="flag soft">${unverified} to check</span>`);

  const deep = pick(p.deep, lang);
  const facts = (p.facts ?? [])
    .map((f) => `<li class="${f.confidence === 'unverified' ? 'unv' : ''}">${esc(pick(f.text, lang) ?? '')}</li>`)
    .join('');
  return `<div class="pbody">
    ${deep ? `<p class="deep">${esc(deep)}</p>` : ''}
    ${facts ? `<ul class="facts">${facts}</ul>` : ''}
    <p class="links">${links.join('')}${
      p.links?.guide ? `<span class="guide">Rough Guide: ${esc(p.links.guide)}</span>` : ''
    }${flags.join('')}</p>
  </div>`;
}

/** Igual que el botón de la app: por nombre y zona, para abrir la ficha y no un punto. */
function mapsUrl(p: Place): string | null {
  if (p.links?.maps) return /^https:\/\//.test(p.links.maps) ? p.links.maps : null;
  if (!p.coords && !p.address && !p.area) return null;
  const name = p.name.replace(/\s*\(.*?\)\s*/g, ' ').trim();
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    [name, p.area].filter(Boolean).join(', '),
  )}`;
}

/** Enlace a la ficha del sitio; el script la abre y deja volver con «Back». */
function placeName(p: Place): string {
  return `<a href="#p-${esc(p.id)}">${esc(p.name)}</a>`;
}

/* ── reservas ────────────────────────────────────────────────────────── */

function bookingsBlock(plan: TripPayload, lang: string): string {
  const stays = plan.stays
    .map((s) => {
      const place = s.place ? plan.places[s.place] : null;
      const note = pick(s.notes, lang);
      return `<tr><td class="num">${esc(dayMonth(s.from))} – ${esc(dayMonth(s.to))}</td><td>${
        place ? placeName(place) : esc(s.name)
      }${note ? `<span class="sub">${esc(note)}</span>` : ''}</td><td class="ref">${esc(s.confirmation ?? '—')}</td></tr>`;
    })
    .join('');

  const others = [...(plan.bookings ?? [])]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((b) => bookingRow(plan, b, lang))
    .join('');

  return `<h3>Hotels</h3>
  <div class="scroll"><table><thead><tr><th>Nights</th><th>Hotel</th><th>Reference</th></tr></thead><tbody>${stays}</tbody></table></div>
  <h3>Flights, transfers and activities</h3>
  <div class="scroll"><table><thead><tr><th>Date</th><th>What</th><th>Reference</th></tr></thead><tbody>${
    others || '<tr><td colspan="3">None recorded</td></tr>'
  }</tbody></table></div>`;
}

function bookingRow(plan: TripPayload, b: Booking, lang: string): string {
  const day = plan.days.find((d) => d.date === b.date);
  const status = b.status ?? 'confirmed';
  const pill = status === 'confirmed' ? '' : `<span class="pill ${status === 'todo' ? 'open' : 'travel'}">${status === 'todo' ? 'To book' : 'Pending'}</span>`;
  const lines = (b.lines ?? []).map((l) => pick(l, lang)).filter(Boolean);
  return `<tr><td class="num">${day ? `<a href="#${esc(day.id)}">${esc(dayMonth(b.date))}</a>` : esc(dayMonth(b.date))}</td>
    <td><span class="kind">${esc(b.kind)}</span> ${esc(pick(b.title, lang) ?? b.id)} ${pill}${
      b.provider ? `<span class="sub">${esc(b.provider)}</span>` : ''
    }${lines.map((l) => `<span class="sub">${esc(l!)}</span>`).join('')}</td>
    <td class="ref">${esc(b.ref ?? '—')}</td></tr>`;
}

/* ── lo que falta ────────────────────────────────────────────────────── */

function todoBlock(plan: TripPayload, lang: string, tasks: Task[]): string {
  const items: string[] = tasks.map(
    (t) => `<li><b>${esc(t.text)}</b>${t.when ? ` <span class="tag">${esc(t.when)}</span>` : ''}</li>`,
  );

  const open = plan.days.filter((d) => dayStatus(d) === 'open');
  const outline = plan.days.filter((d) => dayStatus(d) === 'outline');
  if (outline.length) {
    items.push(`<li><b>${outline.length} days with an outline, stops still to add</b><span class="chips">${outline
      .map((d) => `<a class="tag" href="#${esc(d.id)}">${esc(dayMonth(d.date))}</a>`)
      .join('')}</span></li>`);
  }
  if (open.length) {
    items.push(`<li><b>${open.length} days not started</b><span class="chips">${open
      .map((d) => `<a class="tag" href="#${esc(d.id)}">${esc(dayMonth(d.date))}</a>`)
      .join('')}</span></li>`);
  }

  const bookings = (plan.bookings ?? []).filter((b) => b.status === 'todo' || b.status === 'pending');
  for (const b of bookings) {
    items.push(`<li><b>${b.status === 'todo' ? 'Book' : 'Waiting on'}:</b> ${esc(pick(b.title, lang) ?? b.id)} (${esc(dayMonth(b.date))})</li>`);
  }

  const transfersTodo = new Set(bookings.filter((b) => b.kind === 'transfer').map((b) => b.date));
  // Lo que falta reservar y sólo está avisado en las notas de una parada.
  const pending = plan.days.flatMap((d) =>
    d.waypoints.flatMap((w) =>
      (w.notes ?? [])
        .filter((n) => n.type === 'warn' && /NOT BOOKED/.test(pick(n.text, lang) ?? ''))
        // Los traslados ya salen arriba como reservas pendientes.
        .filter((n) => !(/transfer/i.test(pick(n.text, lang) ?? '') && transfersTodo.has(d.date)))
        .map((n) => ({ d, text: pick(n.text, lang)! })),
    ),
  );
  if (pending.length) {
    items.push(`<li><b>${pending.length} other things to book</b><ul class="sublist">${pending
      .map(({ d, text }) => `<li><a href="#${esc(d.id)}">${esc(dayMonth(d.date))}</a> ${esc(text)}</li>`)
      .join('')}</ul></li>`);
  }

  const places = Object.values(plan.places);
  const slots = mealSlots(plan);
  const noCoords = places.filter((p) => !p.coords && !slots.has(p.id));
  if (noCoords.length) {
    items.push(`<li><b>${noCoords.length} places without a location</b><span class="chips">${noCoords
      .map((p) => `<a class="tag" href="#p-${esc(p.id)}">${esc(p.name)}</a>`)
      .join('')}</span></li>`);
  }

  const toCheck = places.reduce((n, p) => n + (p.facts ?? []).filter((f) => f.confidence === 'unverified').length, 0);
  if (toCheck) items.push(`<li><b>${toCheck} details to check</b> (hours, prices and similar marked “to check” on each place)</li>`);

  const areas = new Set(plan.stays.map((s) => s.area).filter(Boolean));
  const empty = [...areas].filter(
    (a) => !places.some((p) => p.area === a && p.category !== 'lodging' && p.category !== 'transport'),
  );
  if (empty.length) items.push(`<li><b>Areas with no places yet:</b> ${esc(empty.join(', '))}</li>`);

  return items.length ? `<ul class="todo">${items.join('')}</ul>` : '<p class="lede">Nothing left. Enjoy the trip.</p>';
}

/**
 * Huecos genéricos («comer por aquí»): paradas con opciones para elegir. No
 * son un sitio concreto, así que no les falta ubicación.
 */
function mealSlots(plan: TripPayload): Set<string> {
  const ids = new Set<string>();
  for (const d of plan.days) for (const w of d.waypoints) if (w.choices?.length) ids.add(w.place);
  return ids;
}

/* ── fechas ──────────────────────────────────────────────────────────── */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  return [y, m, d];
}

function dayMonth(iso: string, withYear = false): string {
  const [y, m, d] = parts(iso);
  return `${d} ${MONTHS[m - 1] ?? '?'}${withYear ? ` ${y}` : ''}`;
}

function weekday(iso: string): string {
  const [y, m, d] = parts(iso);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function nightsBetween(from: string, to: string): number {
  const a = Date.UTC(...(parts(from).map((n, i) => (i === 1 ? n - 1 : n)) as [number, number, number]));
  const b = Date.UTC(...(parts(to).map((n, i) => (i === 1 ? n - 1 : n)) as [number, number, number]));
  return Math.round((b - a) / 86_400_000);
}

function shortStamp(iso: string): string {
  const date = iso.slice(0, 10);
  const time = iso.slice(11, 16);
  return `${dayMonth(date, true)}${time ? ` ${time}` : ''}`;
}

function travellers(t: { adults: number; children: number }): string {
  const a = `${t.adults} adult${t.adults === 1 ? '' : 's'}`;
  return t.children ? `${a}, ${t.children} child${t.children === 1 ? '' : 'ren'}` : a;
}

function progressBar(days: Day[]): string {
  return `<div class="bar">${days
    .map((d) => `<a class="seg ${dayStatus(d)}" href="#${esc(d.id)}" title="${esc(dayMonth(d.date))}"></a>`)
    .join('')}</div>`;
}

/* ── estilos ─────────────────────────────────────────────────────────── */

// Los colores siguen la paleta de la app (verde agua y gris verdoso) para que
// la vista general se reconozca como parte de lo mismo.
const STYLE = `
:root{
  --bg:#e3e8e7; --card:#fbfcfc; --ink:#13211f; --muted:#5a6d6a; --line:#c9d4d2;
  --accent:#1f6070; --planned:#2c7a5a; --travel:#3d6fa3; --outline:#9fc9b6; --outline-ink:#3f7a60; --open:#c9d4d2;
  --warn:#8a5a00; --warn-bg:#fbefd2;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#0f1918; --card:#172423; --ink:#e4ecea; --muted:#98ada9; --line:#2a3c3a;
  --accent:#7fc4d3; --planned:#6fc39b; --travel:#86b3e3; --outline:#3d6b57; --outline-ink:#8fcfb0; --open:#2f4240;
  --warn:#f0c674; --warn-bg:#3a2f14; color-scheme:dark}}
:root[data-theme="dark"]{
  --bg:#0f1918; --card:#172423; --ink:#e4ecea; --muted:#98ada9; --line:#2a3c3a;
  --accent:#7fc4d3; --planned:#6fc39b; --travel:#86b3e3; --outline:#3d6b57; --outline-ink:#8fcfb0; --open:#2f4240;
  --warn:#f0c674; --warn-bg:#3a2f14; color-scheme:dark}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font:15px/1.5 var(--sans)}
.page{max-width:52rem;margin:0 auto;padding-inline:16px;padding-block:24px 64px;display:grid;gap:40px}
a{color:var(--accent)}
h1{font-size:2rem;line-height:1.15;margin:0;text-wrap:balance;letter-spacing:-.01em}
h2{font-size:1.3rem;margin:0 0 12px;padding-bottom:6px;border-bottom:2px solid var(--ink)}
h3{font-size:1.05rem;margin:0}
.eyebrow{margin:0 0 4px;font-size:.75rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.dates{margin:4px 0 16px;color:var(--muted)}
.lede{color:var(--muted);margin:0 0 12px}
.top{display:grid;gap:0}
.progress{display:grid;gap:8px}
.bar{display:flex;gap:2px;height:14px}
.seg{flex:1;border-radius:2px;background:var(--open);border:1px solid var(--line)}
.seg.planned{background:var(--planned);border-color:var(--planned)}
.seg.travel{background:var(--travel);border-color:var(--travel)}
.seg.outline{background:var(--outline);border-color:var(--outline)}
.legend{display:flex;flex-wrap:wrap;gap:16px;margin:0;font-size:.85rem;color:var(--muted)}
.dot{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px;background:var(--open);border:1px solid var(--line)}
.dot.planned{background:var(--planned);border-color:var(--planned)}
.dot.travel{background:var(--travel);border-color:var(--travel)}
.dot.outline{background:var(--outline);border-color:var(--outline)}
.jump{display:flex;flex-wrap:wrap;gap:16px;margin-top:16px;font-weight:600}
.route{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px 0;counter-reset:leg}
.route li{display:flex;flex-direction:column;padding:6px 14px 6px 0;margin-right:14px;border-right:1px solid var(--line)}
.route li:last-child{border-right:0}
.route span{font-size:.8rem;color:var(--muted)}
.leg{display:grid;gap:6px;margin-bottom:24px}
.leg-meta{margin:0;color:var(--muted);font-size:.85rem}
.days,.stops,.places,.todo{list-style:none;margin:0;padding:0}
.days{background:var(--card);border:1px solid var(--line);border-radius:6px}
.day+.day{border-top:1px solid var(--line)}
.sum{display:grid;grid-template-columns:6.5rem 1fr auto;gap:12px;align-items:baseline;padding:10px 12px;cursor:default}
details>.sum{cursor:pointer;list-style:none}
details>.sum::-webkit-details-marker{display:none}
details>.sum .what::before{content:"▸";display:inline-block;width:1em;color:var(--muted);transition:transform .15s}
details[open]>.sum .what::before{transform:rotate(90deg)}
.day.open .what{color:var(--muted)}
.day.open .what::before{content:"";display:inline-block;width:1em}
.when{font-variant-numeric:tabular-nums;white-space:nowrap}
.what{min-width:0}
.pill{font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;padding:2px 8px;border-radius:99px;white-space:nowrap;border:1px solid currentColor}
.pill.planned{color:var(--planned)}
.pill.travel{color:var(--travel)}
.pill.outline{color:var(--outline-ink)}
.pill.open{color:var(--muted)}
.detail{padding:0 12px 12px calc(6.5rem + 24px)}
.intro{margin:0 0 8px;color:var(--muted);max-width:60ch}
.t{font-family:var(--mono);font-size:.85rem;color:var(--muted);font-variant-numeric:tabular-nums}
.s{min-width:0}
.anchor{display:block;font-size:.82rem;color:var(--muted)}
.anchor.hard{color:var(--warn)}
.choices{display:block;font-size:.82rem;color:var(--muted)}
.area{margin-bottom:28px}
.area h3{margin-bottom:8px}
.count{font-weight:400;font-size:.85rem;color:var(--muted);margin-left:6px}
.places{display:grid;gap:8px}
.place{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:10px 12px}
.place:target,.day:target{outline:2px solid var(--accent);outline-offset:2px}
.ph{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline}
.cat{font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);min-width:4.5rem}
.deep{margin:0;color:var(--muted);font-size:.9rem;max-width:68ch}
.links{margin:0;display:flex;flex-wrap:wrap;gap:4px 14px;font-size:.88rem;align-items:baseline}
.guide{color:var(--ink)}
.flag{font-size:.75rem;color:var(--warn);background:var(--warn-bg);padding:1px 8px;border-radius:99px}
.flag.soft{color:var(--muted);background:transparent;border:1px solid var(--line)}
.tag{font-size:.75rem;text-decoration:none;border:1px solid var(--line);border-radius:99px;padding:1px 8px;white-space:nowrap}
.tag.day{color:var(--planned);border-color:var(--planned)}
.chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.scroll{overflow-x:auto;margin:8px 0 20px}
table{border-collapse:collapse;width:100%;background:var(--card);border:1px solid var(--line);font-size:.9rem}
th,td{text-align:left;padding:8px 10px;vertical-align:top;border-top:1px solid var(--line)}
th{font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);border-top:0}
.num{white-space:nowrap;font-variant-numeric:tabular-nums}
.ref{font-family:var(--mono);font-size:.85rem;white-space:nowrap;user-select:all}
.sub{display:block;font-size:.82rem;color:var(--muted)}
.kind{font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.todo{display:grid;gap:10px}
.ideas{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.idea{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:10px 12px}
.idea.dropped{opacity:.55}
.idea:target{outline:2px solid var(--accent);outline-offset:2px}
.ih{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline}
.ih .pill{margin-left:auto}
.idea p{margin:0;font-size:.9rem;color:var(--muted);max-width:70ch}
.lbl{display:inline-block;min-width:5.5rem;font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:var(--ink)}
.tag.idea{margin-left:8px;color:var(--outline-ink);border-color:var(--outline)}
.todo>li{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:10px 12px}
.sublist{margin:6px 0 0;padding-left:18px;display:grid;gap:2px;font-size:.9rem}
summary{cursor:pointer}
.stop>summary,.choice>summary,.area>summary,.place>summary,.idea>summary{list-style:none}
.stop>summary::-webkit-details-marker,.choice>summary::-webkit-details-marker,.area>summary::-webkit-details-marker,.place>summary::-webkit-details-marker,.idea>summary::-webkit-details-marker{display:none}
.stop>summary{display:grid;grid-template-columns:4.2rem 1fr;gap:8px;padding:3px 0;border-radius:4px}
.stop>summary:hover,.place>summary:hover,.idea>summary:hover{background:color-mix(in srgb,var(--accent) 8%,transparent)}
.stop>summary .t::before,.choice>summary::before{content:"▸ ";color:var(--muted)}
.stop[open]>summary .t::before,.choice[open]>summary::before{content:"▾ "}
.stop[open]>summary .s{font-weight:600}
.stops>li{padding:0}
.stop-body{margin:2px 0 10px 4.7rem;padding:8px 12px;border-left:3px solid var(--line);display:grid;gap:6px}
.timing{margin:0;font-size:.85rem;color:var(--muted)}
.notes,.facts{margin:0;padding-left:18px;font-size:.88rem;display:grid;gap:2px}
.notes .warn{color:var(--warn);font-weight:600}
.facts{color:var(--muted)}
.facts .unv{font-style:italic}
.pbody{display:grid;gap:6px}
.key,.opt{font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-left:8px;padding:0 6px;border-radius:99px;border:1px solid currentColor;vertical-align:1px}
.key{color:var(--planned)}
.opt{color:var(--muted)}
.options{display:grid;gap:4px}
.choice{border:1px solid var(--line);border-radius:6px;padding:4px 10px}
.choice[open]{padding-bottom:10px}
.choice>summary{font-weight:600;font-size:.9rem}
.day-ideas{display:grid;gap:6px;margin:0 0 12px}
.day-ideas .lbl{margin:0}
.area>summary{padding:4px 0;margin-bottom:8px}
.area>summary h3::before,.idea>summary b::before{content:"▸ ";color:var(--muted)}
.area[open]>summary h3::before,.idea[open]>summary b::before{content:"▾ "}
.area{margin-bottom:16px}
.place>summary{border-radius:4px}
.place[open]>summary{margin-bottom:6px}
.idea-body{display:grid;gap:2px;margin-top:6px}
.tools{float:right;display:flex;gap:6px}
.tools button,.back{font:600 .78rem var(--sans);color:var(--accent);background:var(--card);border:1px solid var(--line);border-radius:99px;padding:3px 10px;cursor:pointer}
.back{position:fixed;right:16px;bottom:16px;padding:8px 16px;font-size:.9rem;box-shadow:0 2px 8px rgb(0 0 0 / .2);border-color:var(--accent)}
.back[hidden]{display:none}
.flash{animation:flash 1.6s ease-out}
@keyframes flash{0%,40%{outline:2px solid var(--accent);outline-offset:2px}100%{outline:2px solid transparent;outline-offset:2px}}
@media (max-width:560px){
  .stop-body{margin-left:0}
  .sum{grid-template-columns:1fr auto;gap:2px 10px}
  .what{grid-column:1/-1;grid-row:2}
  .detail{padding:0 12px 12px}
}
`;
