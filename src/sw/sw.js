/**
 * Service worker — §12.2.
 *
 *   · App shell: precache al instalar, estrategia cache-first.
 *   · Datos: en IndexedDB, NO aquí. La caché se puede volver a descargar; el
 *     registro del usuario, no.
 *   · Actualización: se comprueba al arrancar con red, pero **nunca se activa
 *     sola durante un viaje activo**. Que la app se recargue con una versión
 *     nueva a mitad de una jornada, sin red para arreglar nada si algo va mal,
 *     es el peor momento posible. La app manda `SKIP_WAITING` cuando le parece
 *     seguro.
 */

/**
 * `__BUILD__` lo sustituye `scripts/build.ts` por el hash del contenido de
 * `app.js` + `app.css`. Sin eso el nombre de la caché nunca cambia, el
 * `install` reutiliza lo ya cacheado y **una versión nueva jamás llega a un
 * teléfono que ya la tenga instalada**: exactamente el fallo que deja la app
 * congelada en la versión con la que saliste de viaje.
 */
const VERSION = '__BUILD__';
const CACHE = `guia-viaje-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './app.js',
  './app.css',
  './manifest.json',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './data/sevilla-test.trip.json',
];

self.addEventListener('install', (event) => {
  // Sin skipWaiting: la versión nueva espera a que la app diga que se puede.
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (cached) {
        // Cache-first, y de fondo se refresca por si hay red. Si no la hay,
        // el fallo se ignora: eso es exactamente lo que pasa en el viaje.
        event.waitUntil(refresh(request));
        return cached;
      }

      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE);
          cache.put(request, response.clone());
        }
        return response;
      } catch {
        // Navegación sin red y sin caché: se sirve el armazón y la app se
        // encarga desde IndexedDB.
        if (request.mode === 'navigate') {
          const shell = await caches.match('./index.html');
          if (shell) return shell;
        }
        return new Response('Sin conexión', { status: 503, statusText: 'Sin conexión' });
      }
    })(),
  );
});

async function refresh(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(request, response);
    }
  } catch {
    /* sin red: normal durante el viaje */
  }
}
