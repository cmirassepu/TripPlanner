/**
 * Persistencia — IndexedDB (§3).
 *
 * Los datos van aquí y NO a la caché del service worker (§12.2): la caché es
 * para el armazón, que se puede volver a descargar, y esto es lo que no se
 * puede. El registro del usuario es el único dato irreemplazable del sistema.
 *
 * Envoltorio mínimo sobre IndexedDB en vez de una librería: son cuatro almacenes
 * y operaciones de clave-valor. El bundle se cachea entero y tiene que ser
 * pequeño (§3).
 */

import type { TripPayload, Envelope } from '../model/types.ts';
import type { Journal } from '../journal/types.ts';
import type { DocsPayload } from '../model/docs.ts';

const DB_NAME = 'guia-viaje';
const DB_VERSION = 1;

/** Un almacén por tipo de dato, todos indexados por `tripId`. */
export const STORES = {
  plans: 'plans',
  journals: 'journals',
  history: 'history',
  docs: 'docs',
  meta: 'meta',
} as const;

export interface StoredPlan {
  tripId: string;
  plan: TripPayload;
  /** Última `version` aplicada. Decide si un archivo entrante se acepta (§4.1). */
  version: number;
  updated: string;
}

export interface StoredHistoryEntry {
  /** `${tripId}:${seq}` — el orden importa: el historial se reproduce en secuencia. */
  key: string;
  tripId: string;
  seq: number;
  file: Envelope<unknown>;
  applied: string;
  /** Plan anterior, para deshacer sin reproducir todo el historial (§9.3). */
  planBefore: TripPayload | null;
}

export interface StoredDocs {
  tripId: string;
  docs: DocsPayload;
}

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORES.plans)) {
        db.createObjectStore(STORES.plans, { keyPath: 'tripId' });
      }
      if (!db.objectStoreNames.contains(STORES.journals)) {
        db.createObjectStore(STORES.journals, { keyPath: 'tripId' });
      }
      if (!db.objectStoreNames.contains(STORES.history)) {
        const store = db.createObjectStore(STORES.history, { keyPath: 'key' });
        store.createIndex('byTrip', 'tripId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.docs)) {
        db.createObjectStore(STORES.docs, { keyPath: 'tripId' });
      }
      if (!db.objectStoreNames.contains(STORES.meta)) {
        db.createObjectStore(STORES.meta, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

type StoreName = (typeof STORES)[keyof typeof STORES];

function tx<T>(
  db: IDBDatabase,
  store: StoreName,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const request = run(transaction.objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export const get = <T>(db: IDBDatabase, store: StoreName, key: IDBValidKey): Promise<T | undefined> =>
  tx<T | undefined>(db, store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);

export const put = <T>(db: IDBDatabase, store: StoreName, value: T): Promise<IDBValidKey> =>
  tx(db, store, 'readwrite', (s) => s.put(value as unknown as object));

export const all = <T>(db: IDBDatabase, store: StoreName): Promise<T[]> =>
  tx<T[]>(db, store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);

export const remove = (db: IDBDatabase, store: StoreName, key: IDBValidKey): Promise<undefined> =>
  tx<undefined>(db, store, 'readwrite', (s) => s.delete(key) as IDBRequest<undefined>);

/* ── Operaciones de dominio ──────────────────────────────────────────── */

export async function savePlan(
  db: IDBDatabase,
  tripId: string,
  plan: TripPayload,
  version: number,
): Promise<void> {
  const record: StoredPlan = { tripId, plan, version, updated: new Date().toISOString() };
  await put(db, STORES.plans, record);
}

export const loadPlan = (db: IDBDatabase, tripId: string) =>
  get<StoredPlan>(db, STORES.plans, tripId);

export const allPlans = (db: IDBDatabase) => all<StoredPlan>(db, STORES.plans);

/** El registro sólo lo escribe la app, nunca un archivo entrante (§2.5). */
export async function saveJournal(db: IDBDatabase, journal: Journal): Promise<void> {
  await put(db, STORES.journals, journal);
}

export const loadJournal = (db: IDBDatabase, tripId: string) =>
  get<Journal>(db, STORES.journals, tripId);

export async function appendHistory(
  db: IDBDatabase,
  entry: Omit<StoredHistoryEntry, 'key'>,
): Promise<void> {
  await put(db, STORES.history, { ...entry, key: `${entry.tripId}:${entry.seq}` });
}

export async function historyFor(db: IDBDatabase, tripId: string): Promise<StoredHistoryEntry[]> {
  const entries = await all<StoredHistoryEntry>(db, STORES.history);
  return entries.filter((e) => e.tripId === tripId).sort((a, b) => a.seq - b.seq);
}

export const saveDocs = (db: IDBDatabase, tripId: string, docs: DocsPayload) =>
  put(db, STORES.docs, { tripId, docs } satisfies StoredDocs);

export const loadDocs = (db: IDBDatabase, tripId: string) =>
  get<StoredDocs>(db, STORES.docs, tripId);
