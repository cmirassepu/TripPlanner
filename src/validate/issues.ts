/**
 * Catálogo de códigos y formato de salida — §10.3.
 *
 * El formato importa más que el esquema: el bloque se copia, se le pega a la
 * IA y vuelve el archivo corregido. Por eso cada línea lleva ruta exacta y
 * mensaje autocontenido, sin depender de haber visto la pantalla anterior.
 */

export type Severity = 'error' | 'warning';

export interface Issue {
  code: string;
  severity: Severity;
  /** Ruta por id, igual que en los parches. */
  path: string;
  message: string;
}

/** Los códigos que el fixture `sevilla-roto.json` espera, más los de §10.2. */
export const CODES = {
  // ── Estructura (§10.1) ──
  E001: 'version no creciente',
  E100: 'campo obligatorio ausente',
  E101: 'sobre inválido',
  E102: 'referencia a place inexistente',
  E103: 'referencia a día inexistente',
  E104: 'id duplicado',
  E105: 'referencia a stay inexistente',
  E110: 'duración negativa',
  E111: 'tipo incorrecto',
  E112: 'hora inválida',
  E113: 'intervalo horario inválido',
  E120: 'ruta por índice',
  E130: 'operación desconocida',
  E131: 'ruta no encontrada',

  // ── Lógica (§10.2) ──
  W211: 'llegada fuera de horario',
  W212: 'ancla inalcanzable',
  W213: 'día sobrecargado',
  W214: 'horario desconocido: no se puede comprobar la llegada',
  W215: 'ancla vencida',
  W230: 'coordenadas sospechosas',
  W231: 'velocidad implausible',
  W232: 'coordenadas ausentes',
  W240: 'confianza sin fuente',
  W250: 'traducción faltante',
  W260: 'se elimina un waypoint con datos del usuario',
  W261: 'travelFrom del sucesor sin actualizar tras un remove',
  W262: 'id reutilizado tras eliminarse',
} as const;

export type Code = keyof typeof CODES;

export function issue(code: Code, path: string, message: string): Issue {
  return { code, severity: code.startsWith('E') ? 'error' : 'warning', path, message };
}

/** Una línea, tal cual se pega de vuelta. */
export function formatIssue(i: Issue): string {
  return `[${i.code}] ${i.path} → ${i.message}`;
}

/**
 * El bloque completo. Errores primero —bloquean— y después los avisos, cada
 * grupo en orden de código para que dos ejecuciones iguales den el mismo texto
 * y el diff entre intentos sea legible.
 */
export function formatReport(issues: Issue[]): string {
  const rank = (i: Issue) => (i.severity === 'error' ? 0 : 1);
  const sorted = [...issues].sort(
    (a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code) || a.path.localeCompare(b.path),
  );
  return sorted.map(formatIssue).join('\n');
}

export function countBySeverity(issues: Issue[]): { errors: number; warnings: number } {
  return {
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
  };
}
