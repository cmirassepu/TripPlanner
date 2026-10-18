/**
 * El texto largo de un sitio (`Place.story`) a HTML. El formato es mínimo a
 * propósito: párrafos, títulos con `## ` y listas con `- `. Todo se escapa;
 * el archivo de viaje no puede meter etiquetas.
 */

import { esc } from './day.ts';

export function storyHtml(text: string): string {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length === 1 && lines[0].startsWith('## ')) return `<h3>${esc(lines[0].slice(3))}</h3>`;
      if (lines.every((l) => l.startsWith('- '))) {
        return `<ul>${lines.map((l) => `<li>${esc(l.slice(2))}</li>`).join('')}</ul>`;
      }
      // Un título pegado a su párrafo, sin línea en blanco entre medias.
      const head = lines[0].startsWith('## ') ? `<h3>${esc(lines.shift()!.slice(3))}</h3>` : '';
      return `${head}<p>${esc(lines.join(' '))}</p>`;
    })
    .join('');
}

/** Minutos de lectura, a unas 200 palabras por minuto. Nunca menos de uno. */
export function readingMinutes(text: string): number {
  return Math.max(1, Math.round(text.split(/\s+/).filter(Boolean).length / 200));
}
