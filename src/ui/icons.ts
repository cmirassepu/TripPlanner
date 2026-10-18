/**
 * Iconos en línea, SVG de trazo. Van en el bundle porque la app no puede
 * cargar nada de la red; son pocos y pesan menos que una fuente de iconos.
 */

const wrap = (body: string, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${body}</svg>`;

export const ICONS = {
  plane: wrap('<path d="M2 16l20-6-4 10-4-5-6 2z"/><path d="M10 15l-2 6"/>'),
  bed: wrap('<path d="M3 18V8"/><path d="M3 14h18v4"/><path d="M7 14V9h12a2 2 0 0 1 2 2v3"/>'),
  food: wrap('<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10"/><path d="M17 3c-2 2-2 6-2 8h4V3M17 11v10"/>'),
  temple: wrap('<path d="M12 2l1 4H11z"/><path d="M4 9h16l-2-3H6z"/><path d="M5 9v10M9 9v10M15 9v10M19 9v10"/><path d="M3 19h18"/>'),
  market: wrap('<path d="M4 8h16l-1 12H5z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>'),
  museum: wrap('<path d="M3 9l9-5 9 5"/><path d="M5 9v9M10 9v9M14 9v9M19 9v9"/><path d="M3 20h18"/>'),
  park: wrap('<path d="M12 3l5 7h-3l4 5H6l4-5H7z"/><path d="M12 15v6"/>'),
  view: wrap('<circle cx="12" cy="12" r="3"/><path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/>'),
  walk: wrap('<circle cx="13" cy="4" r="1.5"/><path d="M10 21l2-6 3 2v4M8 12l3-3 3 1 2 3"/><path d="M11 9l-1 5-3 2"/>'),
  boat: wrap('<path d="M3 17c2 2 4 2 6 0s4-2 6 0 4 2 6 0"/><path d="M4 14l1-4h14l1 4"/><path d="M12 10V4l5 6"/>'),
  car: wrap('<path d="M5 16l1-5h12l1 5"/><rect x="3" y="16" width="18" height="4" rx="1"/><circle cx="7" cy="20" r="1"/><circle cx="17" cy="20" r="1"/>'),
  pin: wrap('<path d="M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>'),
  chev: wrap('<path d="M9 6l6 6-6 6"/>', ' stroke-width="2.4"'),
  back: wrap('<path d="M15 6l-6 6 6 6"/>', ' stroke-width="2.4"'),
  ext: wrap('<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>'),
  phone: wrap('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>'),
} as const;

export type IconName = keyof typeof ICONS;

/** El icono de una categoría de sitio (§4.4). Lo que no se reconoce lleva una chincheta. */
export function categoryIcon(category: string | null | undefined): string {
  const name: IconName =
    (
      {
        lodging: 'bed',
        transport: 'plane',
        food: 'food',
        temple: 'temple',
        market: 'market',
        museum: 'museum',
        park: 'park',
        viewpoint: 'view',
        activity: 'walk',
        beach: 'boat',
      } as Record<string, IconName>
    )[category ?? ''] ?? 'pin';
  return ICONS[name];
}

/** El icono de un trayecto entre estancias, según la reserva que lo cubre. */
export function legIcon(kind: string, title: string): string {
  if (kind === 'flight') return ICONS.plane;
  if (/boat|ferry|speedboat/i.test(title)) return ICONS.boat;
  return ICONS.car;
}
