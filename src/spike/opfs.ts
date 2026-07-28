/**
 * El spike de §8.4 — el go/no-go de toda la funcionalidad de mapas.
 *
 *   1. Instalar la PWA en el iPhone desde la pantalla de inicio
 *   2. Escribir ~150 MB en OPFS
 *   3. Llamar a persist() y comprobar que devuelve true
 *   4. Cerrar, esperar 24-48 h, reabrir
 *   5. Comprobar que el archivo sigue ahí y se lee por rangos
 *
 * El paso 5 es el que importa de verdad. PMTiles no descomprime el archivo
 * entero: lee los bytes que necesita, así que si OPFS conserva el archivo pero
 * no permite leer rangos con soltura, los mapas no sirven igual.
 *
 * En vez de descargar teselas reales se escribe un patrón determinista: el
 * experimento es sobre el almacenamiento, no sobre la red, y así se puede
 * verificar cualquier rango sin guardar nada con qué compararlo.
 */

const PROBE_FILE = 'spike-probe.bin';
const CHUNK = 4 * 1024 * 1024;

/** Byte esperado en la posición `i`. Barato y comprobable en cualquier punto. */
export const patternByte = (i: number): number => (i * 31 + 7) & 0xff;

export interface ProbeProgress {
  written: number;
  total: number;
}

export interface ProbeResult {
  ok: boolean;
  bytes: number;
  /** Milisegundos que tardó, para saber si leer rangos es viable. */
  elapsedMs: number;
  error?: string;
}

async function root(): Promise<FileSystemDirectoryHandle> {
  if (!navigator.storage?.getDirectory) throw new Error('OPFS no disponible en este navegador');
  return navigator.storage.getDirectory();
}

/** Escribe el archivo de prueba. `onProgress` para que la pantalla no parezca colgada. */
export async function writeProbe(
  megabytes = 150,
  onProgress?: (p: ProbeProgress) => void,
): Promise<ProbeResult> {
  const started = performance.now();
  const total = megabytes * 1024 * 1024;

  try {
    const dir = await root();
    const handle = await dir.getFileHandle(PROBE_FILE, { create: true });
    const writable = await handle.createWritable();

    const chunk = new Uint8Array(CHUNK);
    let written = 0;

    while (written < total) {
      const size = Math.min(CHUNK, total - written);
      for (let i = 0; i < size; i++) chunk[i] = patternByte(written + i);
      await writable.write(size === CHUNK ? chunk : chunk.subarray(0, size));
      written += size;
      onProgress?.({ written, total });
    }

    await writable.close();
    return { ok: true, bytes: written, elapsedMs: Math.round(performance.now() - started) };
  } catch (error) {
    return {
      ok: false,
      bytes: 0,
      elapsedMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface ProbeInfo {
  exists: boolean;
  bytes: number;
  /** Fecha de última modificación según OPFS. Delata si algo lo reescribió. */
  modified: string | null;
}

export async function probeInfo(): Promise<ProbeInfo> {
  try {
    const dir = await root();
    const handle = await dir.getFileHandle(PROBE_FILE);
    const file = await handle.getFile();
    return { exists: true, bytes: file.size, modified: new Date(file.lastModified).toISOString() };
  } catch {
    return { exists: false, bytes: 0, modified: null };
  }
}

/**
 * Lee rangos sueltos y comprueba el patrón. Esto es lo que hace PMTiles: saltar
 * a un desplazamiento y leer unos kilobytes, sin tocar el resto del archivo.
 */
export async function verifyRanges(samples = 24, length = 64 * 1024): Promise<ProbeResult> {
  const started = performance.now();

  try {
    const dir = await root();
    const handle = await dir.getFileHandle(PROBE_FILE);
    const file = await handle.getFile();
    if (file.size === 0) throw new Error('el archivo está vacío');

    for (let s = 0; s < samples; s++) {
      // Desplazamientos repartidos, incluido el último rango del archivo.
      const offset = Math.min(
        Math.floor((file.size / samples) * s),
        Math.max(0, file.size - length),
      );
      const slice = file.slice(offset, offset + Math.min(length, file.size - offset));
      const bytes = new Uint8Array(await slice.arrayBuffer());

      for (let i = 0; i < bytes.length; i += 997) {
        if (bytes[i] !== patternByte(offset + i)) {
          throw new Error(`byte corrupto en ${offset + i}: ${bytes[i]} ≠ ${patternByte(offset + i)}`);
        }
      }
    }

    return { ok: true, bytes: file.size, elapsedMs: Math.round(performance.now() - started) };
  } catch (error) {
    return {
      ok: false,
      bytes: 0,
      elapsedMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function deleteProbe(): Promise<void> {
  const dir = await root();
  await dir.removeEntry(PROBE_FILE).catch(() => undefined);
}

/** Veredicto de §8.4, en una frase. */
export function verdict(
  info: ProbeInfo,
  persisted: boolean,
  ranges: ProbeResult | null,
  startedAt: string | null,
): string {
  if (!info.exists) return 'Sin datos todavía: escribe el archivo de prueba.';

  const hours = startedAt
    ? Math.floor((Date.now() - Date.parse(startedAt)) / 3_600_000)
    : 0;
  const size = `${(info.bytes / 1024 ** 2).toFixed(0)} MB`;

  // El resultado de los rangos se cuenta siempre: aunque persist() falle, saber
  // si la lectura por rangos funciona en el aparato sigue siendo información, y
  // este experimento se hace una vez y se espera dos días.
  const reads = ranges ? (ranges.ok ? `Rangos OK (${ranges.elapsedMs} ms).` : `Rangos KO: ${ranges.error}.`) : '';

  if (!persisted) {
    return `${size} escritos, pero persist() dijo que no. ${reads} Sin instalar en la pantalla de inicio esto es lo normal; instálala y repítelo.`;
  }
  if (ranges && !ranges.ok) {
    return `${size} conservados ${hours} h, pero la lectura por rangos falla: ${ranges.error}`;
  }
  if (hours < 24) {
    return `${size} conservados y persistentes. Faltan ${24 - hours} h para el veredicto: vuelve a abrirla mañana.`;
  }
  return `APROBADO — ${size} conservados ${hours} h, persistentes y legibles por rangos${
    ranges ? ` (${ranges.elapsedMs} ms)` : ''
  }. Los mapas entran en v1.`;
}
