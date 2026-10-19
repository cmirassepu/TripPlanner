/**
 * Punto de entrada de la app.
 *
 * Un render completo por cambio de estado. Con once paradas en pantalla es
 * instantáneo y ahorra todo un framework, que en una app que se cachea entera
 * se paga en megas justo cuando no hay red. Lo único que hay que cuidar a mano
 * es la posición del scroll, porque `innerHTML` la pierde.
 */

import { openDb, savePlan, loadPlan, allPlans, saveJournal, loadJournal, type StoredPlan } from '../store/db.ts';
import { storageStatus, requestPersistence } from '../store/install.ts';
import { emptyJournal } from '../journal/types.ts';
import {
  parseRoute,
  routeHash,
  neighbours,
  today,
  type AppState,
  type SimulatedClock,
  type NearbyFilter,
} from './state.ts';
import {
  libraryScreen,
  tripScreen,
  dayScreen,
  stopScreen,
  placeScreen,
  bookingsScreen,
  hotelScreen,
  settingsScreen,
  type SpikeView,
} from './screens.ts';
import { writeProbe, verifyRanges, probeInfo, deleteProbe } from '../spike/opfs.ts';
import type { TripFile } from '../model/types.ts';
import { validateFile } from '../validate/validate.ts';

const CLOCK_KEY = 'guia-viaje:clock';
const SPIKE_KEY = 'guia-viaje:spike-started';
const TEXT_SIZE_KEY = 'guia-viaje:text-size';

let db: IDBDatabase;
let state: AppState;
let spike: SpikeView = { info: { exists: false, bytes: 0, modified: null }, ranges: null, startedAt: null, busy: null };

/* ── Arranque ────────────────────────────────────────────────────────── */

async function boot(): Promise<void> {
  db = await openDb();

  state = {
    route: parseRoute(location.hash),
    plans: [],
    plan: null,
    journal: null,
    storage: await storageStatus(),
    alert: { level: 'green' },
    clock: loadClock(),
    textSize: Number(localStorage.getItem(TEXT_SIZE_KEY)) || 100,
    nearby: 'all',
    nearbySort: 'hotel',
    position: null,
    mapOpen: false,
    flash: null,
    updateReady: false,
  };

  applyTextSize();

  // Sin datos no hay nada que enseñar, y la primera vez que se abre esto es en
  // el sofá, no en el aeropuerto: se siembra el viaje de prueba.
  const plans = await allPlans(db);
  if (plans.length === 0) await seed();

  spike.startedAt = localStorage.getItem(SPIKE_KEY);
  spike.info = await probeInfo().catch(() => spike.info);

  // El scroll al volver atrás lo repone la app, no el navegador: así no se pisan.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  addEventListener('hashchange', () => void navigate());
  addEventListener('scroll', onScroll, { passive: true });
  // `toggle` no burbujea: se escucha en captura.
  document.addEventListener('toggle', onToggle, true);
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('touchstart', onTouchStart, { passive: true });
  document.addEventListener('touchend', onTouchEnd, { passive: true });

  await navigate();

  // Después de `navigate`, que es quien llena `state.plans`: la decisión de
  // §12.2 depende de si hoy cae dentro de un viaje.
  void registerWorker();
}

/**
 * §12.2 — «nunca actualizar sin avisar durante un viaje activo».
 *
 * El worker nuevo se queda esperando por defecto. Se le deja pasar sólo si hoy
 * no cae dentro de ningún viaje: recargar la app a media jornada, sin red para
 * arreglar nada si la versión nueva falla, es el peor momento imaginable. Si
 * hay viaje en curso, espera a que termine o a que se pulse en Ajustes.
 */
async function registerWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;

  // En desarrollo el service worker estorba: hace bien su trabajo —servir lo
  // cacheado y no actualizar durante un viaje— y eso significa que ningún
  // cambio se ve hasta aceptarlo a mano. En localhost sólo se registra si se
  // pide con `?sw=1`, que es como se prueba el propio §12.2.
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (local && !new URLSearchParams(location.search).has('sw')) return;

  try {
    const registration = await navigator.serviceWorker.register('./sw.js');

    const consider = (worker: ServiceWorker | null) => {
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          void maybeActivate(registration);
        }
      });
    };

    consider(registration.installing);
    if (registration.waiting) void maybeActivate(registration);
    registration.addEventListener('updatefound', () => consider(registration.installing));
  } catch {
    /* sin service worker la app sigue funcionando, sólo que sin caché */
  }
}

let waiting: ServiceWorkerRegistration | null = null;

async function maybeActivate(registration: ServiceWorkerRegistration): Promise<void> {
  const todayIso = today(state.clock);
  const travelling = state.plans.some((p) => todayIso >= p.plan.startDate && todayIso <= p.plan.endDate);

  if (travelling) {
    // Se avisa y se espera. La decisión es del usuario, no del reloj: en
    // Ajustes hay un botón para aceptarla si hace falta ya.
    waiting = registration;
    state.updateReady = true;
    state.flash = 'A new version is available. It does not install itself during the trip: go to Settings.';
    render();
    return;
  }

  activateWaiting(registration);
}

function activateWaiting(registration: ServiceWorkerRegistration): void {
  registration.waiting?.postMessage('SKIP_WAITING');
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
}

async function seed(): Promise<void> {
  const response = await fetch('./data/sevilla-test.trip.json');
  const file: TripFile = await response.json();
  await savePlan(db, file.tripId, file.payload, file.version);
  if (!(await loadJournal(db, file.tripId))) {
    await saveJournal(db, emptyJournal(file.tripId));
  }
}

/* ── Navegación y render ─────────────────────────────────────────────── */

let shownHash: string | null = null;

/**
 * El scroll de cada pantalla, por su hash, guardado al salir de ella. Al
 * volver atrás se recupera, para que «atrás» deje la pantalla exactamente
 * como estaba. Un enlace hacia delante borra el valor guardado de su destino:
 * una pantalla nueva empieza arriba.
 */
const scrollByHash = new Map<string, number>();

/**
 * Las pantallas vistas, en orden, tal como las tiene el historial. Sirve para
 * que el botón de volver use «atrás» de verdad cuando hay pantalla anterior (y
 * se recupere su posición sin apilar historial) y siga su enlace cuando no la
 * hay, por ejemplo con la app abierta directamente en una parada.
 */
const trail: string[] = [];
/** La próxima navegación sustituye la pantalla actual en vez de apilarla. */
let replacing = false;

async function navigate(): Promise<void> {
  const changed = location.hash !== shownHash;
  if (changed) {
    if (shownHash !== null) {
      scrollByHash.set(shownHash, window.scrollY);
      // El aviso («Loaded…») es de la pantalla en la que salió: no viaja a la siguiente.
      state.flash = null;
    }
    if (trail.length >= 2 && trail[trail.length - 2] === location.hash) trail.pop();
    else if (replacing && trail.length) trail[trail.length - 1] = location.hash;
    else trail.push(location.hash);
  }
  replacing = false;
  shownHash = location.hash;
  state.route = parseRoute(location.hash);
  if (changed) state.mapOpen = false;
  state.plans = await allPlans(db);
  state.storage = await storageStatus();

  const tripId = 'tripId' in state.route ? state.route.tripId : null;

  if (tripId) {
    const stored: StoredPlan | undefined = await loadPlan(db, tripId);
    state.plan = stored?.plan ?? null;
    state.journal = (await loadJournal(db, tripId)) ?? emptyJournal(tripId);
  } else {
    state.plan = null;
    state.journal = null;
  }

  render();
  // `render` conserva el scroll para los repintados. Al cambiar de pantalla
  // se vuelve a donde se estaba si es una vuelta atrás, y si no, arriba.
  if (changed) {
    const top = scrollByHash.get(location.hash) ?? 0;
    window.scrollTo({ top });
    const got = window.scrollY;
    if (got !== top) {
      // La página aún no tenía toda su altura (fotos sin decodificar): se
      // vuelve a intentar en el siguiente pintado, si nadie ha movido el scroll.
      requestAnimationFrame(() => {
        if (window.scrollY === got) window.scrollTo({ top });
      });
    }
    onScroll();
  }
}

/** Marca el documento cuando se ha bajado: los controles de arriba flotan y el título se aparta. */
function onScroll(): void {
  document.documentElement.classList.toggle('scrolled', window.scrollY > 28);
}

/** Un enlace hacia delante: su destino empieza arriba aunque se haya visitado antes. */
function forward(hash: string): void {
  scrollByHash.delete(hash);
}

function render(): void {
  const root = document.getElementById('app')!;
  const scroll = window.scrollY;

  const screen =
    state.route.name === 'settings'
      ? settingsScreen(state, spike)
      : state.route.name === 'day'
        ? dayScreen(state)
        : state.route.name === 'stop'
          ? stopScreen(state)
          : state.route.name === 'place'
            ? placeScreen(state)
            : state.route.name === 'bookings'
              ? bookingsScreen(state)
              : state.route.name === 'hotel'
                ? hotelScreen(state)
                : state.route.name === 'trip'
                  ? tripScreen(state)
                  : libraryScreen(state);

  root.innerHTML = (state.flash ? `<div class="install">${escapeText(state.flash)}</div>` : '') + screen;
  root.querySelectorAll('details').forEach((d, i) => {
    const open = openDetails.get(detailsKey(i));
    if (open !== undefined) d.open = open;
  });
  window.scrollTo({ top: scroll });
}

/**
 * Los desplegables (las estancias del viaje, «Good to know») que el usuario ha
 * abierto o cerrado, por pantalla y posición. Un repintado o la vuelta atrás
 * los deja como estaban; si no, la pantalla no cabría igual y el scroll no
 * volvería al mismo sitio.
 */
const openDetails = new Map<string, boolean>();

function detailsKey(i: number): string {
  return `${location.hash}#${i}`;
}

function onToggle(event: Event): void {
  const d = event.target;
  if (!(d instanceof HTMLDetailsElement)) return;
  const all = Array.from(document.querySelectorAll('#app details'));
  openDetails.set(detailsKey(all.indexOf(d)), d.open);
}

/* ── Eventos ─────────────────────────────────────────────────────────── */

function onClick(event: Event): void {
  // Los enlaces normales de la app (href="#/...") navegan solos; sólo se
  // anota que van hacia delante.
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#/"]');
  if (link && !link.dataset.go && !link.dataset.swap) {
    state.flash = null;
    if (link.classList.contains('back')) {
      // Volver: «atrás» de verdad si hay pantalla anterior, que recupera su
      // posición y no apila historial. Sin ella, el enlace a la pantalla madre.
      if (trail.length >= 2) {
        event.preventDefault();
        history.back();
      }
      return;
    }
    forward(link.getAttribute('href')!);
    return;
  }
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-act],[data-go],[data-swap]');
  if (!target) return;
  // Los campos se atienden en `change`. Cancelar su clic impediría que se
  // abriera el selector de archivos, o el de fecha.
  if (target instanceof HTMLInputElement) return;

  // Pasar al día o a la parada de al lado no apila historial: sustituye.
  if (target.dataset.swap) {
    event.preventDefault();
    swap(target.dataset.swap);
    return;
  }

  const go = target.dataset.go;
  if (go) {
    event.preventDefault();
    state.flash = null;
    forward(go);
    location.hash = go;
    return;
  }

  event.preventDefault();
  void act(target.dataset.act!, target);
}

/* ── Deslizar ────────────────────────────────────────────────────────── */

/** Ancho mínimo del gesto, y margen del borde que se deja al «atrás» de iOS. */
const SWIPE_MIN = 60;
const EDGE = 24;

let touchStart: { x: number; y: number } | null = null;

function onTouchStart(event: TouchEvent): void {
  const t = event.touches[0];
  const fromEdge = t.clientX < EDGE || t.clientX > innerWidth - EDGE;
  touchStart = event.touches.length === 1 && !fromEdge ? { x: t.clientX, y: t.clientY } : null;
}

function onTouchEnd(event: TouchEvent): void {
  const from = touchStart;
  touchStart = null;
  if (!from || !state.plan) return;

  const t = event.changedTouches[0];
  const dx = t.clientX - from.x;
  const dy = t.clientY - from.y;
  // Horizontal de verdad: largo y bastante más ancho que alto, para no
  // robarle el gesto al scroll.
  if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < 2 * Math.abs(dy)) return;

  const { prev, next } = neighbours(state.plan, state.route);
  const target = dx < 0 ? next : prev;
  if (target) swap(routeHash(target));
}

function swap(hash: string): void {
  if (hash === location.hash) return;
  state.flash = null;
  forward(hash);
  replacing = true;
  location.replace(hash);
}

function onChange(event: Event): void {
  const target = event.target as HTMLInputElement;
  const action = target.dataset.act;
  if (action === 'set-date') setClock({ ...state.clock, date: target.value || null });
  if (action === 'set-time') setClock({ ...state.clock, time: target.value || null });
  if (action === 'load-file' && target.files?.[0]) void loadFile(target.files[0]);
}

/**
 * §9.2 — carga de un archivo elegido por el usuario. Se valida entero antes de
 * tocar nada: un plan malo no debe sustituir a uno bueno. De momento sólo
 * `kind: "trip"`; los parches necesitan la pantalla de diff (§9.3).
 */
async function loadFile(picked: File): Promise<void> {
  let file: TripFile;
  try {
    file = JSON.parse(await picked.text());
  } catch {
    state.flash = `${picked.name}: not a valid trip file.`;
    render();
    return;
  }

  if (file?.kind !== 'trip') {
    state.flash = `${picked.name}: only complete trip files can be loaded for now.`;
    render();
    return;
  }

  const stored = typeof file.tripId === 'string' ? await loadPlan(db, file.tripId) : undefined;
  const result = validateFile(file, { appliedVersion: stored?.version });

  if (!result.applicable) {
    // Sólo los motivos: el informe completo de avisos no cabe en un teléfono.
    state.flash = `${picked.name}: not loaded. ${result.blockers.join(' ')}`;
    render();
    return;
  }

  await savePlan(db, file.tripId, file.payload, file.version);
  if (!(await loadJournal(db, file.tripId))) await saveJournal(db, emptyJournal(file.tripId));

  await navigate();
  state.flash = `Loaded: ${picked.name}, version ${file.version}. ${result.warnings} warnings.`;
  render();
}

async function act(action: string, el: HTMLElement): Promise<void> {
  switch (action) {
    case 'nearby':
      state.nearby = (el.dataset.filter as NearbyFilter) ?? 'all';
      render();
      break;

    case 'nearby-sort': {
      if (el.dataset.sort !== 'me') {
        state.nearbySort = 'hotel';
        render();
        break;
      }
      // Una lectura por toque, no un seguimiento continuo (§8.3): volver a
      // tocar «From where I am» la refresca.
      const position = await currentPosition();
      if (position) {
        state.position = position;
        state.nearbySort = 'me';
        state.flash = null;
      } else {
        state.flash = 'Location not available. Check that the app is allowed to use it.';
      }
      render();
      break;
    }

    case 'top':
      window.scrollTo({ top: 0, behavior: 'smooth' });
      break;

    /* Mapa del día */
    case 'map-open':
      state.mapOpen = true;
      render();
      break;

    case 'map-close':
      state.mapOpen = false;
      render();
      break;

    case 'locate': {
      // Una lectura por toque (§8.3). El punto se queda donde se leyó.
      const position = await currentPosition();
      state.position = position;
      state.flash = position ? null : 'Location not available. Check that the app is allowed to use it.';
      render();
      break;
    }

    /* Ajustes */
    case 'persist':
      await requestPersistence();
      await navigate();
      break;

    case 'text-size':
      state.textSize = Number(el.dataset.size) || 100;
      localStorage.setItem(TEXT_SIZE_KEY, String(state.textSize));
      applyTextSize();
      render();
      break;

    case 'clock-reset':
      setClock({ date: null, time: null });
      break;

    case 'update-now':
      if (waiting) activateWaiting(waiting);
      break;

    case 'seed':
      await seed();
      await navigate();
      break;

    /* Spike (§8.4) */
    case 'spike-write':
      spike.busy = 'Writing…';
      render();
      {
        const result = await writeProbe(150, (p) => {
          spike.busy = `Writing… ${Math.round((p.written / p.total) * 100)} %`;
          const node = document.querySelector('.panel .meta:last-of-type');
          if (node) node.textContent = spike.busy;
        });
        await requestPersistence();
        if (result.ok) localStorage.setItem(SPIKE_KEY, new Date().toISOString());
        spike.startedAt = localStorage.getItem(SPIKE_KEY);
        spike.info = await probeInfo();
        spike.busy = result.ok ? null : `Failed: ${result.error}`;
      }
      await navigate();
      break;

    case 'spike-verify':
      spike.busy = 'Reading…';
      render();
      spike.ranges = await verifyRanges();
      spike.info = await probeInfo();
      spike.busy = null;
      await navigate();
      break;

    case 'spike-delete':
      await deleteProbe();
      localStorage.removeItem(SPIKE_KEY);
      spike = { info: await probeInfo(), ranges: null, startedAt: null, busy: null };
      await navigate();
      break;
  }
}

const escapeText = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

/**
 * §8.3 — la posición se pide al necesitarla, no con `watchPosition` continuo:
 * ocho horas de chip despierto se comen el móvil, y en un día de ruta el móvil
 * es también el billete y el mapa.
 */
function currentPosition(): Promise<[number, number] | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve([p.coords.latitude, p.coords.longitude]),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 },
    );
  });
}

function loadClock(): SimulatedClock {
  try {
    return JSON.parse(localStorage.getItem(CLOCK_KEY) ?? '') as SimulatedClock;
  } catch {
    return { date: null, time: null };
  }
}

function applyTextSize(): void {
  document.documentElement.style.fontSize = `${state.textSize}%`;
}

function setClock(clock: SimulatedClock): void {
  state.clock = clock;
  localStorage.setItem(CLOCK_KEY, JSON.stringify(clock));
  render();
}

void boot();
