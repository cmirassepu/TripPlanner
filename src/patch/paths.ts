/**
 * Resolución de rutas de parche — §4.9: por id, nunca por índice.
 *
 * `days` y `waypoints` son arrays en el archivo pero se direccionan por el
 * campo `id` de sus elementos. Un segmento puramente numérico donde se espera
 * un id es E120 y no se resuelve nunca, ni aunque el índice existiese: si se
 * dejara pasar, el primer `insertAfter` corrompería todas las rutas siguientes
 * del mismo parche.
 */

import type { Code } from '../validate/issues.ts';

/** Arrays cuyos elementos se localizan por `id`. */
const BY_ID = new Set(['days', 'waypoints', 'stays', 'ops', 'facts', 'documents']);

export type Resolution =
  | {
      ok: true;
      /** Contenedor del valor: array u objeto. */
      parent: unknown[] | Record<string, unknown>;
      /** Índice si `parent` es array, clave si es objeto. */
      key: number | string;
      value: unknown;
    }
  | { ok: false; code: Code; message: string };

export function splitPath(path: string): string[] {
  return path.split('.').filter((s) => s.length > 0);
}

const isIndexLike = (s: string) => /^\d+$/.test(s);

/**
 * Camina la ruta y devuelve el contenedor y la clave finales, para que quien
 * llame pueda leer, escribir, insertar o borrar sin volver a recorrerla.
 */
export function resolvePath(root: unknown, path: string): Resolution {
  const segments = splitPath(path);
  if (segments.length === 0) {
    return { ok: false, code: 'E131', message: 'ruta vacía' };
  }

  let parent: unknown = root;
  let key: number | string = segments[0];
  let current: unknown = root;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const walked = segments.slice(0, i).join('.') || '(raíz)';

    if (Array.isArray(current)) {
      const collection = segments[i - 1] ?? '';
      if (isIndexLike(seg)) {
        return {
          ok: false,
          code: 'E120',
          message:
            `segmento "${seg}" es un índice, no un id. Las rutas van por id ` +
            `(§4.9): los índices se corrompen en cuanto se inserta o se borra algo`,
        };
      }
      if (!BY_ID.has(collection)) {
        return { ok: false, code: 'E131', message: `"${collection}" no se indexa por id` };
      }
      const idx = current.findIndex(
        (el) => typeof el === 'object' && el !== null && (el as { id?: string }).id === seg,
      );
      if (idx === -1) {
        return {
          ok: false,
          code: collection === 'days' ? 'E103' : 'E131',
          message: `no existe ningún elemento con id "${seg}" en ${walked}`,
        };
      }
      parent = current;
      key = idx;
      current = current[idx];
      continue;
    }

    if (typeof current === 'object' && current !== null) {
      const obj = current as Record<string, unknown>;
      if (!(seg in obj)) {
        // Un `set` puede crear una clave nueva; sólo es error si falta un tramo
        // intermedio, porque entonces no hay dónde colgarla.
        if (i < segments.length - 1) {
          return {
            ok: false,
            code: 'E131',
            message: `"${seg}" no existe en ${walked}`,
          };
        }
        return { ok: true, parent: obj, key: seg, value: undefined };
      }
      parent = obj;
      key = seg;
      current = obj[seg];
      continue;
    }

    return {
      ok: false,
      code: 'E131',
      message: `no se puede descender a "${seg}": ${walked} no es un objeto`,
    };
  }

  return { ok: true, parent: parent as unknown[] | Record<string, unknown>, key, value: current };
}
