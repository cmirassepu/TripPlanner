/**
 * Aplicación de parches — §4.9.
 *
 * Se trabaja siempre sobre una copia: si algo falla a mitad, el plan bueno
 * sigue intacto. Las operaciones que no pasan la comprobación estructural se
 * saltan pero NO abortan el resto, porque la validación tiene que llegar al
 * final y enseñar todos los problemas de una vez (§10.3). Aplicar es otra
 * decisión, posterior, y la toma quien llama.
 */

import type { TripPayload, PatchOperation, Waypoint, Localized } from '../model/types.ts';
import { resolvePath, splitPath } from './paths.ts';
import { issue, type Issue, type Code } from '../validate/issues.ts';
import { isValidClock } from '../core/time.ts';

const KNOWN_OPS = new Set(['set', 'remove', 'insertAfter', 'insertBefore', 'merge']);

export interface Change {
  kind: 'set' | 'remove' | 'insert' | 'merge';
  path: string;
  before?: unknown;
  after?: unknown;
  reason?: Localized | null;
}

export interface ApplyResult {
  plan: TripPayload;
  issues: Issue[];
  changes: Change[];
  /** Ids eliminados: los necesita el detector de reutilización (W262). */
  removedIds: string[];
}

export interface ApplyOptions {
  /** Ids con datos del registro del usuario. Sirve para W260. */
  journalledWaypoints?: ReadonlySet<string>;
}

export function applyPatch(
  base: TripPayload,
  ops: PatchOperation[],
  opts: ApplyOptions = {},
): ApplyResult {
  const plan: TripPayload = structuredClone(base);
  const issues: Issue[] = [];
  const changes: Change[] = [];
  const removedIds: string[] = [];
  const journalled = opts.journalledWaypoints ?? new Set<string>();

  // Un `remove` deja al sucesor con un `travelFrom` medido desde una parada que
  // ya no está (W261) — salvo que el mismo parche lo corrija más adelante. Se
  // mira el lote entero antes de empezar, porque el arreglo suele ir al final.
  const travelFromFixed = new Set(
    ops
      .filter((o) => o.op === 'set' && splitPath(o.path).at(-1) === 'travelFrom')
      .map((o) => splitPath(o.path).at(-2))
      .filter((id): id is string => Boolean(id)),
  );

  for (const op of ops) {
    if (!KNOWN_OPS.has(op.op)) {
      issues.push(
        issue(
          'E130',
          op.path ?? '(sin ruta)',
          `operación "${op.op}" desconocida. Válidas: set, remove, insertAfter, insertBefore, merge`,
        ),
      );
      continue;
    }

    const resolved = resolvePath(plan, op.path);
    if (!resolved.ok) {
      issues.push(issue(resolved.code, op.path, resolved.message));
      continue;
    }

    const valueIssues = checkValue(plan, op, issues);
    if (valueIssues) continue;

    const { parent, key } = resolved;

    switch (op.op) {
      case 'set': {
        const before = resolved.value;
        (parent as Record<string | number, unknown>)[key] = op.value;
        changes.push({ kind: 'set', path: op.path, before, after: op.value, reason: op.reason });
        break;
      }

      case 'merge': {
        const target = resolved.value;
        if (!isPlainObject(target) || !isPlainObject(op.value)) {
          issues.push(issue('E111', op.path, 'merge requiere que origen y destino sean objetos'));
          break;
        }
        const before = structuredClone(target);
        Object.assign(target, op.value);
        changes.push({ kind: 'merge', path: op.path, before, after: op.value, reason: op.reason });
        break;
      }

      case 'remove': {
        if (!Array.isArray(parent)) {
          issues.push(issue('E131', op.path, 'sólo se pueden eliminar elementos de una colección'));
          break;
        }
        const [removed] = parent.splice(key as number, 1);
        const id = (removed as { id?: string })?.id;
        if (id) removedIds.push(id);

        if (id && journalled.has(id)) {
          issues.push(
            issue(
              'W260',
              op.path,
              `se elimina "${id}", que tiene datos del usuario. El registro no se borra ` +
                `(§2.5): quedará huérfano. Avisar antes de aplicar`,
            ),
          );
        }
        // El sucesor heredaba su `travelFrom` de la parada que se acaba de ir.
        flagStaleTravelFrom(parent, key as number, op.path, issues, travelFromFixed);
        changes.push({ kind: 'remove', path: op.path, before: removed, reason: op.reason });
        break;
      }

      case 'insertAfter':
      case 'insertBefore': {
        if (!Array.isArray(parent)) {
          issues.push(issue('E131', op.path, 'sólo se puede insertar dentro de una colección'));
          break;
        }
        const newId = (op.value as { id?: string })?.id;
        if (newId && parent.some((el) => (el as { id?: string })?.id === newId)) {
          issues.push(issue('E104', op.path, `id duplicado: "${newId}" ya existe en la colección`));
          break;
        }
        if (newId && removedIds.includes(newId)) {
          issues.push(
            issue(
              'W262',
              [...splitPath(op.path).slice(0, -1), newId].join('.'),
              `"${newId}" se acaba de eliminar y se reutiliza para otra parada. El registro ` +
                `del usuario se indexa por id: los datos de la antigua se pegarían a la nueva`,
            ),
          );
        }
        const at = op.op === 'insertAfter' ? (key as number) + 1 : (key as number);
        parent.splice(at, 0, op.value);
        changes.push({ kind: 'insert', path: op.path, after: op.value, reason: op.reason });
        break;
      }
    }
  }

  return { plan, issues, changes, removedIds };
}

/** Tras un `remove`, el `travelFrom` del sucesor mide desde una parada que ya no está. */
function flagStaleTravelFrom(
  collection: unknown[],
  idx: number,
  path: string,
  issues: Issue[],
  fixed: ReadonlySet<string>,
): void {
  const successor = collection[idx] as Waypoint | undefined;
  if (!successor || typeof successor.travelFrom !== 'number') return;
  if (!splitPath(path).includes('waypoints')) return;
  if (fixed.has(successor.id)) return;

  issues.push(
    issue(
      'W261',
      `${path.split('.').slice(0, -1).join('.')}.${successor.id}`,
      `"${successor.id}" conserva travelFrom ${successor.travelFrom} min, medido desde la ` +
        `parada recién eliminada. Confirmar o corregir en el mismo parche`,
    ),
  );
}

/** Comprobaciones sobre el valor. Devuelve `true` si hay que saltarse la operación. */
function checkValue(plan: TripPayload, op: PatchOperation, issues: Issue[]): boolean {
  const segments = splitPath(op.path);
  const last = segments[segments.length - 1];
  const push = (code: Code, msg: string) => issues.push(issue(code, op.path, msg));

  if (last === 'duration' || last === 'travelFrom') {
    if (typeof op.value !== 'number') {
      push('E111', `se esperaba un entero de minutos y llegó ${describe(op.value)}`);
      return true;
    }
    if (op.value < 0) {
      push('E110', `${last} no puede ser negativo (${op.value})`);
      return true;
    }
  }

  if (last === 'startTime' || last === 'time') {
    if (!isValidClock(op.value)) {
      push('E112', `hora inválida ${describe(op.value)}; se esperaba "HH:MM" entre 00:00 y 23:59`);
      return true;
    }
  }

  if (last === 'place' && typeof op.value === 'string' && !(op.value in plan.places)) {
    push('E102', `el sitio "${op.value}" no existe en places`);
    return true;
  }

  if (isPlainObject(op.value) && typeof op.value.place === 'string') {
    if (!(op.value.place in plan.places)) {
      push('E102', `el sitio "${op.value.place}" no existe en places`);
      return true;
    }
  }

  if (last === 'default' || last === 'hours' || isDayKey(last)) {
    const ranges = last === 'hours' ? (op.value as { default?: unknown })?.default : op.value;
    if (Array.isArray(ranges) && checkRanges(ranges, push)) return true;
  }

  if (isPlainObject(op.value) && Array.isArray((op.value as { default?: unknown }).default)) {
    if (checkRanges((op.value as { default: unknown[] }).default, push)) return true;
  }

  if (last === 'anchor' && isPlainObject(op.value) && !isValidClock(op.value.time)) {
    push('E112', `hora de ancla inválida ${describe(op.value.time)}`);
    return true;
  }

  return false;
}

/**
 * Un cierre anterior a la apertura puede ser un intervalo invertido o un
 * negocio nocturno. Se distinguen por la hora de cierre: un mercado que cierra
 * a las 02:00 es normal en Bangkok; algo que "cierra" a las 09:30 tras abrir a
 * las 19:00 son catorce horas de madrugada y es un dato al revés.
 */
const OVERNIGHT_LATEST_CLOSE = 6 * 60;

function checkRanges(ranges: unknown[], push: (c: Code, m: string) => void): boolean {
  for (const r of ranges) {
    if (!Array.isArray(r) || r.length !== 2 || !isValidClock(r[0]) || !isValidClock(r[1])) {
      push('E113', `intervalo horario mal formado: ${JSON.stringify(r)}`);
      return true;
    }
    const open = toMinutes(r[0]);
    const close = toMinutes(r[1]);
    if (close < open && close > OVERNIGHT_LATEST_CLOSE) {
      push(
        'E113',
        `intervalo invertido ${r[0]}–${r[1]}: la apertura es posterior al cierre. ` +
          `Si de verdad cruza medianoche, el cierre debe caer de madrugada (hasta 06:00)`,
      );
      return true;
    }
  }
  return false;
}

const toMinutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const isDayKey = (s: string) => DAY_KEYS.includes(s);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function describe(v: unknown): string {
  if (typeof v === 'string') return `"${v}"`;
  return String(v);
}
