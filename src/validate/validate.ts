/**
 * Validación de un archivo entrante — §9.2 y §10.
 *
 * DECISIÓN CENTRAL: validar y aplicar son cosas distintas.
 *
 * §9.2 pone la comprobación de `version` en el paso 4 y la del payload en el 5,
 * así que un archivo con la versión mal ni siquiera llegaría a revisarse. Pero
 * el bucle de reparación de §10.3 —copiar los errores, pegárselos a la IA,
 * recibir el archivo corregido— exige poder validar archivos que NO se van a
 * aplicar. Si la versión cortase el paso, harían falta tantas rondas como
 * errores, y sin conexión no hay rondas.
 *
 * Aquí se valida siempre entero. `applicable` dice aparte si se puede aplicar.
 */

import type { Envelope, TripPayload, PatchPayload } from '../model/types.ts';
import { applyPatch, type Change } from '../patch/apply.ts';
import { validatePlan } from './plan.ts';
import { issue, countBySeverity, formatReport, type Issue } from './issues.ts';

export interface ValidationContext {
  /** Plan consolidado actual. Ausente = el viaje todavía no existe. */
  base?: TripPayload;
  /** Última `version` aplicada de este viaje. */
  appliedVersion?: number;
  /** Waypoints con datos del usuario, para W260. */
  journalledWaypoints?: ReadonlySet<string>;
  /** Versiones de formato que esta build entiende. */
  supportedFormatVersions?: number[];
}

export interface ValidationResult {
  issues: Issue[];
  /** `false` si algo impide aplicar, aunque el contenido sea correcto. */
  applicable: boolean;
  /** Motivos de no aplicabilidad, en lenguaje llano. */
  blockers: string[];
  /** Plan resultante del ensayo. Sirve para el diff sin tocar el bueno. */
  preview?: TripPayload;
  changes: Change[];
  errors: number;
  warnings: number;
  /** El bloque pegable de §10.3. */
  report: string;
}

export function validateFile(
  file: Envelope<unknown>,
  ctx: ValidationContext = {},
): ValidationResult {
  const issues: Issue[] = [];
  const blockers: string[] = [];
  const supported = ctx.supportedFormatVersions ?? [1];

  // ── Sobre (§4.1) ──
  if (file?.format !== 'trip-file') {
    issues.push(issue('E101', 'format', `se esperaba "trip-file" y llegó ${JSON.stringify(file?.format)}`));
    blockers.push('El archivo no es una guía de viaje.');
  }
  if (!supported.includes(file?.formatVersion)) {
    issues.push(
      issue('E101', 'formatVersion', `versión de formato ${file?.formatVersion} no soportada`),
    );
    blockers.push(`Formato v${file?.formatVersion}: esta versión de la app no lo entiende.`);
  }
  if (typeof file?.tripId !== 'string' || !file.tripId) {
    issues.push(issue('E100', 'tripId', 'obligatorio'));
  }

  // La versión NO corta la validación: sólo impide aplicar.
  if (typeof ctx.appliedVersion === 'number' && typeof file?.version === 'number') {
    if (file.version <= ctx.appliedVersion) {
      issues.push(
        issue(
          'E001',
          'version',
          `version ${file.version} no es mayor que la ya aplicada (${ctx.appliedVersion}). ` +
            `El archivo se ha revisado igualmente, pero no se aplicará`,
        ),
      );
      blockers.push(
        `Ya tienes la versión ${ctx.appliedVersion}; este archivo es la ${file.version}.`,
      );
    }
  }

  if (file?.kind !== 'trip' && !ctx.base) {
    issues.push(
      issue('E101', 'kind', `"${file?.kind}" sobre un viaje que no existe: primero hace falta un kind:"trip"`),
    );
    blockers.push('No hay ningún viaje cargado al que aplicar esto.');
  }

  // ── Payload ──
  let preview: TripPayload | undefined;
  let changes: Change[] = [];

  if (file?.kind === 'trip') {
    preview = file.payload as TripPayload;
    issues.push(...validatePlan(preview));
  } else if (file?.kind === 'patch' && ctx.base) {
    const ops = (file.payload as PatchPayload)?.ops;
    if (!Array.isArray(ops)) {
      issues.push(issue('E100', 'payload.ops', 'un parche necesita una lista de operaciones'));
    } else {
      const applied = applyPatch(ctx.base, ops, {
        journalledWaypoints: ctx.journalledWaypoints,
      });
      issues.push(...applied.issues);
      // El plan que saldría: los avisos lógicos se miden sobre el resultado,
      // no sobre el original, o se avisaría de conflictos que el parche arregla.
      issues.push(...validatePlan(applied.plan));
      preview = applied.plan;
      changes = applied.changes;
    }
  }

  const { errors, warnings } = countBySeverity(issues);
  return {
    issues,
    applicable: blockers.length === 0 && errors === 0,
    blockers,
    preview,
    changes,
    errors,
    warnings,
    report: formatReport(issues),
  };
}
