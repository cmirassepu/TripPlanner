/**
 * Construcción — `npm run build`.
 *
 * esbuild es la única dependencia de construcción y no aporta nada al bundle.
 * El resultado es UN archivo, que es lo que quiere el service worker: precachear
 * un grafo de módulos es frágil, y si falta una pieza la app no arranca en el
 * único momento en que no se puede arreglar.
 */

import { build } from 'esbuild';
import { writeFileSync, readFileSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { FULL_STYLE } from '../src/render/style.ts';
import { writeIcons } from './icons.ts';

const root = new URL('../', import.meta.url);
const web = fileURLToPath(new URL('web/', root));
const data = `${web}data/`;

mkdirSync(data, { recursive: true });

// La hoja de estilos vive en TypeScript y se escribe aquí: una sola fuente
// para el render estático y para la app.
writeFileSync(`${web}app.css`, FULL_STYLE, 'utf8');

// Fixtures que la app necesita para sembrarse la primera vez.
for (const name of [
  'sevilla-test.trip.json',
  'sevilla-parche-v2.json',
  'sevilla-roto.json',
  'sevilla-journal.json',
]) {
  copyFileSync(fileURLToPath(new URL(`Prep Docs/${name}`, root)), `${data}${name}`);
}

const icons = writeIcons(web);

// La versión que enseña Ajustes: el commit y la fecha, para saber en el
// teléfono qué versión tiene instalada.
let commit = 'dev';
try {
  commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
} catch {
  /* sin git (p. ej. una copia suelta) se queda en «dev» */
}
const built = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16).replace('T', ' ');

const result = await build({
  entryPoints: [fileURLToPath(new URL('src/ui/app.ts', root))],
  define: { __APP_VERSION__: JSON.stringify(`${commit} · ${built}`) },
  outfile: `${web}app.js`,
  bundle: true,
  format: 'esm',
  target: ['safari17', 'chrome120'],
  minify: true,
  sourcemap: false,
  metafile: true,
  logLevel: 'warning',
});

// El service worker se sella con el hash del contenido: si el armazón no ha
// cambiado, el nombre de la caché tampoco y no se vuelve a descargar nada; si ha
// cambiado, la caché es otra y la versión nueva puede llegar al teléfono.
const stamp = createHash('sha256')
  .update(readFileSync(`${web}app.js`))
  .update(readFileSync(`${web}app.css`))
  .digest('hex')
  .slice(0, 12);

writeFileSync(
  `${web}sw.js`,
  readFileSync(fileURLToPath(new URL('src/sw/sw.js', root)), 'utf8').replace('__BUILD__', stamp),
  'utf8',
);

const bundle = statSync(`${web}app.js`).size;
const css = statSync(`${web}app.css`).size;

console.log(`app.js   ${(bundle / 1024).toFixed(1)} kB`);
console.log(`app.css  ${(css / 1024).toFixed(1)} kB`);
console.log(`iconos   ${icons.join(' · ')}`);
console.log(`sw       caché guia-viaje-${stamp}`);

// El armazón se cachea entero al instalar. Si esto crece, crece la primera
// descarga, que es la única que se hace con red.
const total = bundle + css;
if (total > 120 * 1024) {
  console.warn(`\n⚠  El armazón pasa de 120 kB (${(total / 1024).toFixed(0)} kB). §3 pide que sea pequeño.`);
}

if (process.argv.includes('--meta')) {
  writeFileSync(`${web}meta.json`, JSON.stringify(result.metafile, null, 2));
}
