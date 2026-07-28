/**
 * Generador de iconos PNG. Se ejecuta al construir, nunca en el navegador, así
 * que puede usar `node:zlib` sin añadir nada al bundle.
 *
 * Se dibujan a mano en vez de arrastrar un icono binario al repositorio: son
 * dos círculos y una línea —la ruta entre dos paradas— y así el icono se
 * regenera solo si cambian los colores del manifest.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

type RGBA = [number, number, number, number];

const ACCENT: RGBA = [0x1f, 0x60, 0x70, 0xff];
const LIGHT: RGBA = [0xdc, 0xe2, 0xe1, 0xff];
const SAND: RGBA = [0xe8, 0xb9, 0x74, 0xff];

class Canvas {
  readonly pixels: Uint8Array;
  readonly size: number;

  constructor(size: number) {
    this.size = size;
    this.pixels = new Uint8Array(size * size * 4);
  }

  fill(color: RGBA): void {
    for (let i = 0; i < this.size * this.size; i++) this.set(i % this.size, (i / this.size) | 0, color);
  }

  set(x: number, y: number, color: RGBA, alpha = 1): void {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    const i = (y * this.size + x) * 4;
    for (let c = 0; c < 3; c++) {
      this.pixels[i + c] = Math.round(this.pixels[i + c] * (1 - alpha) + color[c] * alpha);
    }
    this.pixels[i + 3] = 0xff;
  }

  /** Con antialias por distancia: a 180 px un borde duro se ve escalonado. */
  circle(cx: number, cy: number, r: number, color: RGBA): void {
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
      for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d <= r - 0.5) this.set(x, y, color);
        else if (d < r + 0.5) this.set(x, y, color, r + 0.5 - d);
      }
    }
  }

  line(x1: number, y1: number, x2: number, y2: number, width: number, color: RGBA): void {
    const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.circle(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, width / 2, color);
    }
  }

  toPng(): Uint8Array {
    const raw = new Uint8Array(this.size * (this.size * 4 + 1));
    for (let y = 0; y < this.size; y++) {
      raw[y * (this.size * 4 + 1)] = 0; // filtro None
      raw.set(
        this.pixels.subarray(y * this.size * 4, (y + 1) * this.size * 4),
        y * (this.size * 4 + 1) + 1,
      );
    }
    return buildPng(this.size, deflateSync(raw, { level: 9 }));
  }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function buildPng(size: number, compressed: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, size);
  v.setUint32(4, size);
  ihdr[8] = 8; // profundidad
  ihdr[9] = 6; // RGBA
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Dos paradas y el camino entre ellas. Legible a 40 px, que es lo que importa. */
function draw(size: number): Uint8Array {
  const c = new Canvas(size);
  const u = size / 100;
  c.fill(ACCENT);
  c.line(30 * u, 70 * u, 68 * u, 32 * u, 7 * u, LIGHT);
  c.circle(30 * u, 70 * u, 13 * u, LIGHT);
  c.circle(30 * u, 70 * u, 6 * u, ACCENT);
  c.circle(68 * u, 32 * u, 13 * u, SAND);
  c.circle(68 * u, 32 * u, 6 * u, ACCENT);
  return c.toPng();
}

export function writeIcons(dir: string): string[] {
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  for (const size of [180, 192, 512]) {
    const name = `icon-${size}.png`;
    const png = draw(size);
    writeFileSync(`${dir}/${name}`, png);
    written.push(`${name} (${(png.length / 1024).toFixed(1)} kB)`);
  }
  return written;
}
