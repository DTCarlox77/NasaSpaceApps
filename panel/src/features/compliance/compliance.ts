/**
 * Lógica de Cumplimiento (sin React). Solo lo que manda la API: completar, nunca el resultado.
 * screenCompliance() deja únicamente los campos de cumplimiento del contrato: si la respuesta
 * trajera un valor de bienestar (ánimo, estrés…), no se muestra.
 */
import type { ComplianceAstronaut, ComplianceReport } from '../../api/types.ts';

export const COMPLIANCE_NOTE = 'La racha mide completar, nunca el resultado. Sin valores de bienestar.';

const FIELDS = [
  'astronaut_id',
  'call_sign',
  'checkin_today',
  'streak_days',
  'checkins_completed',
  'checkins_expected',
  'screenings_completed',
  'pvt_runs',
  'fitness',
  'last_checkin_at',
] as const;

export function screenCompliance(report: ComplianceReport): { report: ComplianceReport; dropped: number } {
  let dropped = 0;
  const astronauts = (Array.isArray(report.astronauts) ? report.astronauts : []).map((row) => {
    const clean: Record<string, unknown> = {};
    for (const key of Object.keys(row)) {
      if ((FIELDS as readonly string[]).includes(key)) clean[key] = (row as unknown as Record<string, unknown>)[key];
      else dropped += 1;
    }
    return clean as unknown as ComplianceAstronaut;
  });
  return { report: { ...report, astronauts }, dropped };
}

/** Sin ningún check-in (p. ej. un alta reciente). */
export const neverCheckedIn = (row: ComplianceAstronaut): boolean =>
  !row.last_checkin_at && row.checkins_completed === 0;

export function streakLabel(days: number | undefined): string {
  if (typeof days !== 'number') return 'Sin dato';
  return days === 1 ? '1 día' : `${days} días`;
}

export const FITNESS_META = {
  fit: { icon: '✓', text: 'Apto' },
  not_confirmed: { icon: '?', text: 'No confirmado' },
} as const;
