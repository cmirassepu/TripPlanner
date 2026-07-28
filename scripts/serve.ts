/**
 * Servidor estático de desarrollo para `web/`.
 *
 * Un service worker sólo se registra en `localhost` o bajo HTTPS, así que abrir
 * `index.html` con `file://` no vale para probar nada de §12. Esto sirve para
 * probar en el Mac; para el iPhone hace falta publicarlo (§12.4).
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('../web/', import.meta.url));
const port = Number(process.env.PORT ?? 5173);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  // `normalize` + prefijo fijo: sin esto, `../../` se sale de `web/`.
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(web, rel);

  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(web, 'index.html');
  }

  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      // El SW se actualiza mal si el navegador cachea; en desarrollo, nunca.
      'cache-control': 'no-store',
      'service-worker-allowed': '/',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('404');
  }
}).listen(port, () => {
  console.log(`http://localhost:${port}`);
});
