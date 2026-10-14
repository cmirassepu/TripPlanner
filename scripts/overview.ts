/**
 * Genera la vista general de un viaje a partir de su archivo.
 *
 *   npm run overview -- <viaje.trip.json> <salida.html> [--standalone]
 *
 * Sin `--standalone` sale el contenido para publicarlo como Artifact (sin
 * `<!doctype>`, que lo pone la publicación). Con él, una página completa para
 * abrirla como archivo. Antes de generar se valida: con errores no sale nada.
 *
 * Si junto al archivo hay un `<nombre>.ideas.json` (lista de cambios opcionales),
 * también sale en la página.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import type { TripFile } from '../src/model/types.ts';
import { validateFile } from '../src/validate/validate.ts';
import { renderOverview, wrapPage, type Idea } from '../src/render/overview.ts';

const [input, output] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const standalone = process.argv.includes('--standalone');
if (!input || !output) {
  console.error('Uso: npm run overview -- <viaje.trip.json> <salida.html> [--standalone]');
  process.exit(2);
}

const raw = JSON.parse(readFileSync(input, 'utf8'));
const result = validateFile(raw);
if (result.errors > 0) {
  console.error(result.report);
  process.exit(1);
}

const trip = raw as TripFile;
// Hora local del ordenador, que es la que se lee en la página.
const now = new Date();
const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString();
const ideasPath = input.replace(/\.trip\.json$/, '.ideas.json');
const ideas: Idea[] = ideasPath !== input && existsSync(ideasPath) ? JSON.parse(readFileSync(ideasPath, 'utf8')) : [];
const body = renderOverview(trip.payload, { generatedAt: local, version: trip.version, ideas });
writeFileSync(output, standalone ? wrapPage(body) : body);
console.log(`Vista general escrita en ${output}${ideas.length ? ` (${ideas.length} cambios opcionales)` : ''}`);
