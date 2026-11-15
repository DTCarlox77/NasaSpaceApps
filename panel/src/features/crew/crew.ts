/**
 * Lógica del dashboard de tripulación (sin React, para probarla sola).
 * Apoyo a la decisión, no diagnóstico: el panel muestra lo que manda la API (nivel, valor,
 * serie, tendencia) sin calcular niveles ni inventar umbrales.
 */
import type {
  Compliance,
  CrewDashboard,
  CrewRole,
  DashboardAstronaut,
  DashboardIndicator,
  GroundRole,
  IndicatorDef,
  Level,
  ReadingValues,
  SeriesPoint,
  Trend,
} from '../../api/types.ts';

/** Orden del dashboard: crítico, precaución, normal, sin datos. */
export const LEVEL_ORDER: readonly Level[] = ['critical', 'caution', 'normal', 'unrated'];

export const LEVEL_LABELS: Record<Level, string> = {
  critical: 'Crítico',
  caution: 'Precaución',
  normal: 'Normal',
  unrated: 'Sin datos',
};

const levelRank = (level: Level): number => {
  const rank = LEVEL_ORDER.indexOf(level);
  return rank === -1 ? LEVEL_ORDER.length : rank;
};

export function sortAstronauts(list: DashboardAstronaut[]): DashboardAstronaut[] {
  return [...list].sort(
    (a, b) =>
      levelRank(a.worst_level) - levelRank(b.worst_level) || a.call_sign.localeCompare(b.call_sign),
  );
}

/** Indicadores de una tarjeta: primero lo crítico. */
export function sortIndicators(list: DashboardIndicator[]): DashboardIndicator[] {
  return [...list].sort((a, b) => levelRank(a.level) - levelRank(b.level));
}

export type LevelFilter = Level | 'all';

export function filterByLevel(list: DashboardAstronaut[], filter: LevelFilter): DashboardAstronaut[] {
  return filter === 'all' ? list : list.filter((a) => a.worst_level === filter);
}

export const CREW_ROLE_LABELS: Record<CrewRole, string> = {
  commander: 'Comandante',
  pilot: 'Piloto',
  crew_medical_officer: 'Oficial médico de a bordo (CMO)',
  flight_engineer: 'Ingeniería de vuelo',
  mission_specialist: 'Especialista de misión',
};

export const crewRoleLabel = (role: string): string =>
  CREW_ROLE_LABELS[role as CrewRole] ?? role;

export const TREND_LABELS: Record<Trend, { icon: string; text: string }> = {
  rising: { icon: '↑', text: 'Subiendo' },
  falling: { icon: '↓', text: 'Bajando' },
  stable: { icon: '→', text: 'Estable' },
  insufficient_data: { icon: '·', text: 'Sin puntos suficientes para la tendencia' },
};

export function fitnessLabel(fitness: DashboardAstronaut['fitness']): string {
  if (fitness === 'fit') return 'Apto para tarea crítica';
  if (fitness === 'not_confirmed') return 'Aptitud no confirmada';
  return 'Aptitud: sin acceso';
}

/**
 * Cumplimiento (check-ins en 7 días): SOLO admin y solo si viene. Para cualquier otro rol, o si
 * viene null, "Sin acceso" (nunca "0").
 */
export function complianceLabel(compliance: Compliance | null | undefined, role: GroundRole | null): string {
  if (role !== 'admin' || !compliance) return 'Sin acceso';
  return `${compliance.checkins_completed_7d} de ${compliance.checkins_expected_7d} check-ins en 7 días`;
}

// ---------------------------------------------------------------- valores

const numberFormat = new Intl.NumberFormat('es', { maximumFractionDigits: 2 });

function formatScalar(value: unknown): string {
  if (typeof value === 'number') return numberFormat.format(value);
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (value === null || value === undefined) return '—';
  return String(value);
}

/** Último valor con unidad: "145/88 mmHg", "31 rpm", "Sí". */
export function formatReading(values: ReadingValues, def?: IndicatorDef): string {
  let text: string;
  if ('systolic' in values && 'diastolic' in values) {
    text = `${formatScalar(values.systolic)}/${formatScalar(values.diastolic)}`;
  } else if ('value' in values) {
    text = formatScalar(values.value);
  } else {
    // Otros componentes: solo los escalares (p. ej. `symptoms: []` no se pinta).
    text = Object.entries(values)
      .filter(([, v]) => v === null || typeof v !== 'object')
      .map(([key, v]) => `${key} ${formatScalar(v)}`)
      .join(' · ');
  }
  const unit = def?.unit?.trim();
  const isBoolean = typeof values.value === 'boolean';
  return unit && !isBoolean ? `${text} ${unit}` : text;
}

// ---------------------------------------------------------------- filtro de lo que no corresponde

export interface ScreenedDashboard {
  dashboard: CrewDashboard;
  /** Cuántos datos se ocultaron porque este rol no debe verlos (para avisar). */
  hidden: number;
}

/**
 * Indicadores que el dashboard nunca muestra, para ningún rol. SLEEP_HOURS llega con el
 * check-in de bienestar y su valor diría quién lo hizo y a qué hora (cumplimiento). Defensa: el
 * backend ya lo excluye de GET /admin/dashboard/crew desde el contrato v1.8, y en el catálogo
 * figura como `standard`, así que el filtro por catálogo no bastaría.
 */
export const NEVER_ON_DASHBOARD: ReadonlySet<string> = new Set(['SLEEP_HOURS']);

/**
 * El dashboard es solo físico. Si la respuesta trae algo que no corresponde, no se muestra:
 * - SLEEP_HOURS (NEVER_ON_DASHBOARD), con o sin catálogo;
 * - un indicador que no está en el catálogo estándar (p. ej. uno confidencial de bienestar);
 * - el cumplimiento para un rol que no es admin.
 * Sin catálogo cargado no se filtran los demás indicadores (no hay con qué compararlos).
 */
export function screenDashboard(
  data: CrewDashboard,
  role: GroundRole | null,
  catalog: Map<string, IndicatorDef> | null,
): ScreenedDashboard {
  let hidden = 0;
  const astronauts = data.astronauts.map((astronaut) => {
    const indicators = astronaut.indicators.filter((indicator) => {
      const ok =
        !NEVER_ON_DASHBOARD.has(indicator.code) &&
        (!catalog || catalog.get(indicator.code)?.sensitivity === 'standard');
      if (!ok) hidden += 1;
      return ok;
    });
    let compliance = astronaut.compliance;
    if (role !== 'admin' && compliance) {
      hidden += 1;
      compliance = null;
    }
    return { ...astronaut, indicators, compliance };
  });
  return { dashboard: { ...data, astronauts }, hidden };
}

export function catalogMap(items: IndicatorDef[] | undefined): Map<string, IndicatorDef> | null {
  return items ? new Map(items.map((def) => [def.code, def])) : null;
}

/** Descripción en texto de la serie (para lectores de pantalla). */
export function seriesSummary(points: SeriesPoint[], unit = ''): string {
  if (points.length === 0) return 'Sin serie';
  const values = points.map((p) => p.value);
  const u = unit ? ` ${unit}` : '';
  if (points.length === 1) return `1 punto: ${numberFormat.format(values[0] ?? 0)}${u}`;
  return `Serie de ${points.length} puntos, entre ${numberFormat.format(Math.min(...values))} y ${numberFormat.format(Math.max(...values))}${u}`;
}
