/**
 * PHQ-2 y GAD-2 (Pfizer, uso libre sin permiso). Se aplican cada 2 semanas, un día antes de la conferencia
 * psicológica privada (NASA BHP). Punto de corte ≥ 3 en cualquiera → positivo → escalamiento CONFIDENCIAL
 * a salud conductual. Deliberadamente NO se usa el PHQ-9: su ítem 9 exige un protocolo de crisis que la app no maneja.
 */
export const SCREENING = { everyDays: 14, cutoff: 3 } as const;
export const PHQ2_ITEMS = ['phq1', 'phq2'] as const;
export const GAD2_ITEMS = ['gad1', 'gad2'] as const;

export function scoreScreening(phq: [number, number], gad: [number, number]) {
  const phqTotal = phq[0] + phq[1];
  const gadTotal = gad[0] + gad[1];
  return { phqTotal, gadTotal, positive: phqTotal >= SCREENING.cutoff || gadTotal >= SCREENING.cutoff };
}

/**
 * Calendario: conferencias psicológicas en los días de misión múltiplos de 14.
 * El cuestionario se abre el día anterior (y sigue disponible el día de la conferencia).
 */
export function screeningSchedule(missionDay: number, lastScreeningMissionDay?: number) {
  const nextConference = Math.ceil(missionDay / SCREENING.everyDays) * SCREENING.everyDays || SCREENING.everyDays;
  const conference = nextConference < missionDay ? nextConference + SCREENING.everyDays : nextConference;
  const opensOn = conference - 1;
  const previousConference = conference - SCREENING.everyDays;
  const doneThisCycle = lastScreeningMissionDay !== undefined && lastScreeningMissionDay > previousConference;
  const open = missionDay >= opensOn && !doneThisCycle;
  return { conference, opensOn, open, doneThisCycle, daysUntilOpen: Math.max(0, opensOn - missionDay) };
}
