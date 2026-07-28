/**
 * Escritor de ZIP mínimo, sin comprimir (método `store`).
 *
 * Un `.trip` es un `.zip` (§11.2), y la alternativa era arrastrar una
 * dependencia de compresión al núcleo. No compensa: el núcleo tiene que correr
 * igual en Node que en el navegador, y `zlib` es sólo de Node mientras que
 * `CompressionStream` es sólo del navegador. Sin comprimir, el mismo código
 * vale en los dos sitios y no hay nada que cachear de más.
 *
 * El coste es tamaño. Un viaje son unos cientos de kB de JSON; las fotos, que
 * es lo que pesa, ya vienen comprimidas y no ganarían nada.
 */

export interface ZipEntry {
  /** Ruta dentro del paquete, con `/` como separador. */
  path: string;
  data: Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Fecha y hora en formato MS-DOS, que es lo que entiende el ZIP. */
function dosDateTime(date: Date): { time: number; date: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: (((date.getFullYear() - 1980) & 0x7f) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export function createZip(entries: ZipEntry[], modified = new Date()): Uint8Array {
  const { time, date } = dosDateTime(modified);
  const encoder = new TextEncoder();

  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = new Uint8Array(30 + name.length + size);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // firma
    lv.setUint16(4, 20, true); // versión necesaria
    lv.setUint16(6, 0, true); // flags
    lv.setUint16(8, 0, true); // método 0 = store
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true); // comprimido
    lv.setUint32(22, size, true); // sin comprimir
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true); // extra
    local.set(name, 30);
    local.set(entry.data, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // versión creadora
    cv.setUint16(6, 20, true); // versión necesaria
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true); // extra
    cv.setUint16(32, 0, true); // comentario
    cv.setUint16(34, 0, true); // disco
    cv.setUint16(36, 0, true); // atributos internos
    cv.setUint32(38, 0, true); // atributos externos
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const total =
    locals.reduce((n, l) => n + l.length, 0) + centralSize + end.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}
