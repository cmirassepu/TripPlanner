/**
 * El texto largo de un sitio (`Place.story`) a HTML. El formato es mínimo a
 * propósito: párrafos, títulos con `## ` y listas con `- `. Todo se escapa;
 * el archivo de viaje no puede meter etiquetas.
 */

import { esc } from './day.ts';

export function storyHtml(text: string): string {
  return storySections(text).join('');
}

/**
 * El texto por secciones: cada `## título` abre una. Lo que va antes del
 * primer título es una sección sin él. Así la página del sitio puede meter una
 * foto entre sección y sección.
 */
export function storySections(text: string): string[] {
  const sections: string[] = [];
  let current = '';
  for (const block of text.trim().split(/\n\s*\n/)) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    let html = '';
    if (lines[0].startsWith('## ')) {
      if (current) sections.push(current);
      current = '';
      html += `<h3>${esc(lines.shift()!.slice(3))}</h3>`;
    }
    if (lines.length && lines.every((l) => l.startsWith('- '))) {
      html += `<ul>${lines.map((l) => `<li>${esc(l.slice(2))}</li>`).join('')}</ul>`;
    } else if (lines.length) {
      html += `<p>${esc(lines.join(' '))}</p>`;
    }
    current += html;
  }
  if (current) sections.push(current);
  return sections;
}

/** Minutos de lectura, a unas 200 palabras por minuto. Nunca menos de uno. */
export function readingMinutes(text: string): number {
  return Math.max(1, Math.round(text.split(/\s+/).filter(Boolean).length / 200));
}
