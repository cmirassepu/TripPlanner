/**
 * El paquete `.trip` — §11.2.
 *
 * Para qué sirve: devolvérselo a la IA al planificar el siguiente viaje, con
 * datos reales en vez de estimaciones optimistas. Por eso lleva el registro y
 * el historial, no sólo el plan: sin el registro no hay multiplicador de ritmo
 * (§5.2), y sin el historial no se puede reconstruir cómo se llegó hasta aquí.
 *
 *   viaje.trip
 *   ├── manifest.json      formato, tripId, versión, fecha de exportación
 *   ├── plan.json          plan consolidado tras aplicar todos los archivos
 *   ├── journal.json       el registro del usuario
 *   ├── history/           archivos originales aplicados, en orden
 *   └── media/             fotos de waypoints improvisados
 */

import type { TripPayload, Envelope } from '../model/types.ts';
import type { Journal } from '../journal/types.ts';
import { createZip, type ZipEntry } from './zip.ts';
import { orphans, pace } from '../journal/journal.ts';
import { plannedDurations, planWaypointIds } from '../journal/infer.ts';

export interface Manifest {
  format: 'trip-bundle';
  formatVersion: 1;
  tripId: string;
  /** Última `version` aplicada. */
  version: number;
  exported: string;
  title: string;
  startDate: string;
  endDate: string;
  stats: {
    days: number;
    waypoints: number;
    visited: number;
    skipped: number;
    partial: number;
    improvised: number;
    /** Marcas cuya parada ya no está en el plan. Se conservan (§2.5). */
    orphanedRecords: string[];
    /** Real ÷ estimado, o `null` si no hay muestra suficiente (§5.2). */
    paceFactor: number | null;
  };
}

export interface BundleInput {
  plan: TripPayload;
  journal: Journal;
  /** Archivos aplicados, en orden. Permite reconstruir y revertir (§9.4). */
  history?: Envelope<unknown>[];
  /** Fotos de waypoints improvisados, indexadas por su ruta en `media/`. */
  media?: Record<string, Uint8Array>;
  version: number;
  exported: string;
}

export function buildManifest(input: BundleInput): Manifest {
  const { plan, journal } = input;
  const ids = planWaypointIds(plan);
  const records = Object.values(journal.waypoints);

  return {
    format: 'trip-bundle',
    formatVersion: 1,
    tripId: journal.tripId,
    version: input.version,
    exported: input.exported,
    title: plan.title[plan.primaryLanguage] ?? plan.title.es ?? journal.tripId,
    startDate: plan.startDate,
    endDate: plan.endDate,
    stats: {
      days: plan.days.length,
      waypoints: ids.size,
      visited: records.filter((r) => r.status === 'visited').length,
      skipped: records.filter((r) => r.status === 'skipped').length,
      partial: records.filter((r) => r.status === 'partial').length,
      improvised: journal.improvised.length,
      orphanedRecords: orphans(journal, ids),
      paceFactor: pace(journal, plannedDurations(plan))?.factor ?? null,
    },
  };
}

/** Los archivos del paquete, sin empaquetar. Útil para inspeccionar y probar. */
export function bundleEntries(input: BundleInput): ZipEntry[] {
  const encoder = new TextEncoder();
  const json = (value: unknown) => encoder.encode(JSON.stringify(value, null, 2));

  const entries: ZipEntry[] = [
    { path: 'manifest.json', data: json(buildManifest(input)) },
    { path: 'plan.json', data: json(input.plan) },
    { path: 'journal.json', data: json(input.journal) },
  ];

  // El orden importa: el historial se reproduce aplicándolo de arriba abajo.
  (input.history ?? []).forEach((file, i) => {
    const seq = String(i + 1).padStart(3, '0');
    entries.push({
      path: `history/${seq}-v${file.version}-${file.kind}.json`,
      data: json(file),
    });
  });

  for (const [name, data] of Object.entries(input.media ?? {})) {
    entries.push({ path: `media/${name}`, data });
  }

  return entries;
}

export function exportTrip(input: BundleInput): Uint8Array {
  return createZip(bundleEntries(input), new Date(input.exported));
}
