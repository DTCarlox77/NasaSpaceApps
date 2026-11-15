import { apiEnabled } from '@/core/config/env';
import type { HealthIndicator, IndicatorId, Reading } from '@/domain/entities/HealthIndicator';
import type { ReadingInput, ReadingOutcome } from '@/domain/entities/ReadingSubmission';
import type { HealthRepository, HealthSnapshot } from '@/domain/repositories/HealthRepository';
import { newUuid } from '@/domain/usecases/uuid';
import { evaluateReadingOffline } from '@/domain/usecases/evaluateReadingOffline';
import { healthCacheDataSource } from '../datasources/local/healthCacheDataSource';
import { rulesLocalDataSource, type StoredRules } from '../datasources/local/rulesLocalDataSource';
import { sessionSecureDataSource } from '../datasources/local/sessionSecureDataSource';
import { healthMockDataSource } from '../datasources/mock/healthMockDataSource';
import type { ApiIndicator, ApiIndicatorList, ApiIndicatorStatus } from '../datasources/remote/apiTypes';
import { healthRemoteDataSource } from '../datasources/remote/healthRemoteDataSource';
import {
  ESCALATION_FROM_API,
  HAZARD_FROM_API,
  INDICATOR_CODE,
  INDICATOR_FROM_CODE,
  inputMethodFor,
  LOCAL_ONLY_INDICATORS,
  STATUS_FROM_LEVEL,
  SYMPTOM_CODE,
  SYSTEM_FROM_ZONE,
} from '../mappers/catalogMap';
import { sendOrQueue, serverSession } from './outbox';

const TREND_POINTS = 10;
/** Ventana de la serie: GET /me/readings ordena ascendente; 7 días caben en una página (limit 200) aun con datos cada hora. */
const TREND_DAYS = 7;

/** Unidades de los indicadores que solo viven en el dispositivo (sin catálogo del servidor). */
const LOCAL_ONLY_META: Record<string, { systemId: HealthIndicator['systemId']; unit: string }> = {
  reactionTime: { systemId: 'brain', unit: 'ms' },
  eyePressure: { systemId: 'eyes', unit: 'mmHg' },
  urinaryCalcium: { systemId: 'skeletal', unit: 'mg/día' },
  gripStrength: { systemId: 'muscular', unit: 'kg' },
};

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Valor mostrable de una lectura según los `components` del catálogo. */
function readingValue(code: string, values: Record<string, unknown>): { value?: number; secondaryValue?: number } {
  switch (code) {
    case 'BLOOD_PRESSURE':
      return { value: num(values.systolic), secondaryValue: num(values.diastolic) };
    case 'VISION_CHECK':
      // Cuántas respuestas "sí" (síntomas visuales) tuvo el cuestionario.
      return { value: Object.values(values).filter((v) => v === true).length };
    case 'SYMPTOM':
      return { value: Array.isArray(values.symptoms) ? values.symptoms.length : 0 };
    default:
      return { value: num(values.value) };
  }
}

/** Síntomas de la app → códigos de GET /symptoms (los que el catálogo no tiene se quedan en el dispositivo). */
const symptomCodes = (symptoms: string[] = []) =>
  [...new Set(symptoms.map((s) => SYMPTOM_CODE[s]).filter((c): c is string => !!c))];

/** Cuerpo de POST /readings según los `components` del catálogo. */
function readingValues(code: string, input: ReadingInput): Record<string, unknown> {
  switch (code) {
    case 'BLOOD_PRESSURE':
      return { systolic: input.value, diastolic: input.secondaryValue, symptoms: [] };
    case 'HEART_RATE':
      // La pantalla Medir pide quedarse quieto: es pulso en reposo.
      return { value: input.value, at_rest: true };
    case 'SYMPTOM':
      return { symptoms: symptomCodes(input.symptoms) };
    default:
      return { value: input.value };
  }
}

/**
 * Offline-first:
 * - Con API: GET /me/body-status + catálogo + series → (guarda caché); si falla, última caché.
 * - Sin API (demo): maqueta del Figma, marcada como sintética.
 */
export class HealthRepositoryImpl implements HealthRepository {
  private catalog: ApiIndicatorList | null = null;

  constructor(
    private readonly remote = healthRemoteDataSource,
    private readonly cache = healthCacheDataSource,
    private readonly mock = healthMockDataSource,
    private readonly rules = rulesLocalDataSource,
  ) {}

  /** GET /rules?since_version=<guardada>: solo las reglas nuevas; se mezclan por indicador. */
  async refreshRules(opts: { onlyIfMissing?: boolean } = {}): Promise<boolean> {
    if (!(await serverSession())) return false;
    try {
      const stored = await this.rules.get();
      if (opts.onlyIfMissing && stored) return true;
      const bundle = await this.remote.getRules(stored?.rulesVersion);
      const next: StoredRules = {
        rulesVersion: bundle.rules_version,
        catalogVersion: bundle.catalog_version,
        indicators: { ...(stored?.indicators ?? {}) },
        fetchedAt: new Date().toISOString(),
      };
      for (const ind of bundle.indicators) next.indicators[ind.code] = { rules_version: ind.rules_version, rules: ind.rules };
      await this.rules.set(next);
      // El catálogo (derived_fields) se relee con las reglas nuevas.
      if (!stored || stored.catalogVersion !== bundle.catalog_version) this.catalog = null;
      await this.getCatalog();
      return true;
    } catch {
      return false;
    }
  }

  /** Catálogo del servidor (memoria → red → caché en disco). */
  private async getCatalog(): Promise<ApiIndicatorList | null> {
    if (this.catalog) return this.catalog;
    try {
      this.catalog = await this.remote.getCatalog();
      await this.cache.setCatalog(this.catalog).catch(() => {});
    } catch {
      this.catalog = await this.cache.getCatalog();
    }
    return this.catalog;
  }

  async getSnapshot(): Promise<HealthSnapshot> {
    if (!apiEnabled()) {
      return { indicators: await this.mock.getIndicators(), origin: 'mock', fetchedAt: new Date().toISOString() };
    }
    try {
      const [status, catalog] = await Promise.all([this.remote.getBodyStatus(), this.getCatalog()]);
      const byCode = new Map<string, ApiIndicator>((catalog?.items ?? []).map((i) => [i.code, i]));
      const indicators: HealthIndicator[] = [];

      for (const zone of status.zones) {
        const systemId = SYSTEM_FROM_ZONE[zone.zone];
        if (!systemId) continue; // `environment` es una tarjeta aparte (pendiente en la app).
        for (const s of zone.indicators) {
          const ind = this.toIndicator(s, systemId, byCode.get(s.code));
          if (ind) indicators.push(ind);
        }
      }
      await this.attachTrends(indicators);

      // Indicadores de la app sin código en el catálogo: solo en el dispositivo y "sin evaluar".
      for (const id of LOCAL_ONLY_INDICATORS) {
        const meta = LOCAL_ONLY_META[id]!;
        indicators.push({ id, systemId: meta.systemId, unit: meta.unit, hazards: [], status: 'unevaluated', trend: [], frequencyHours: 0, synthetic: true, localOnly: true });
      }

      const fetchedAt = new Date().toISOString();
      await this.cache.set(indicators, fetchedAt).catch(() => {});
      return { indicators, origin: 'remote', fetchedAt };
    } catch (e) {
      const cached = await this.cache.get();
      if (cached) return { ...cached, origin: 'cache' };
      throw e;
    }
  }

  private toIndicator(s: ApiIndicatorStatus, systemId: HealthIndicator['systemId'], meta?: ApiIndicator): HealthIndicator | null {
    const id = INDICATOR_FROM_CODE[s.code];
    if (!id) return null; // Código nuevo del catálogo que la app aún no conoce.
    const v = s.last_value ? readingValue(s.code, s.last_value.values) : {};
    const latest: Reading | undefined =
      s.last_value && v.value !== undefined
        ? { value: v.value, secondaryValue: v.secondaryValue, takenAt: s.last_value.measured_at, synced: true }
        : undefined;
    return {
      id,
      code: s.code,
      systemId,
      unit: s.code === 'SYMPTOM' || s.code === 'VISION_CHECK' ? '' : (meta?.unit ?? ''),
      hazards: (meta?.hazards ?? []).map((h) => HAZARD_FROM_API[h]).filter((h): h is NonNullable<typeof h> => !!h),
      status: STATUS_FROM_LEVEL[s.level] ?? 'unevaluated',
      recommendation: s.recommendation ?? null,
      escalation: ESCALATION_FROM_API[s.escalation],
      sources: meta?.sources?.map((src) => ({ title: src.title, url: src.url })),
      latest,
      trend: [],
      frequencyHours: 24,
      synthetic: true,
    };
  }

  /** Tendencia: últimos valores de GET /me/readings?code= (una petición por indicador con dato). */
  private async attachTrends(indicators: HealthIndicator[]) {
    const from = new Date(Date.now() - TREND_DAYS * 86_400_000).toISOString();
    const codes = [...new Set(indicators.filter((i) => i.latest && i.code !== 'SYMPTOM' && i.code !== 'VISION_CHECK').map((i) => i.code!))];
    const series = await Promise.allSettled(codes.map((c) => this.remote.getReadings(c, from)));
    const byCode = new Map<string, number[]>();
    series.forEach((r, i) => {
      if (r.status !== 'fulfilled') return;
      const values = r.value.items
        .map((p) => readingValue(p.indicator_code, p.values).value)
        .filter((x): x is number => x !== undefined);
      byCode.set(codes[i]!, values.slice(-TREND_POINTS));
    });
    for (const ind of indicators) if (ind.code) ind.trend = byCode.get(ind.code) ?? [];
  }

  async submitReading(input: ReadingInput): Promise<ReadingOutcome> {
    const clientUuid = newUuid();
    const code = INDICATOR_CODE[input.indicatorId as IndicatorId];
    const session = await serverSession();
    if (!session || !code) return { status: 'local', clientUuid };
    if (code === 'SYMPTOM' && !symptomCodes(input.symptoms).length) return { status: 'local', clientUuid };

    const catalog = await this.getCatalog();
    const meta = catalog?.items.find((i) => i.code === code);
    const payload: Record<string, unknown> = {
      indicator_code: code,
      measured_at: input.takenAt,
      values: readingValues(code, input),
      input_method: code === 'SYMPTOM' ? 'clicks' : inputMethodFor(meta?.input_methods, input.source),
      device_id: await sessionSecureDataSource.getDeviceId(),
    };
    const res = await sendOrQueue({
      clientUuid,
      entity: 'reading',
      ownerId: session.userId,
      payload,
      send: () => this.remote.createReading({ client_uuid: clientUuid, ...payload }),
    });
    if (res.kind === 'queued') {
      // Sin conexión: mismo motor (conditions.js) y reglas guardadas; el servidor confirma al sincronizar.
      const rules = await this.rules.get();
      const device = evaluateReadingOffline({
        code,
        values: payload.values as Record<string, unknown>,
        sex: session.sex,
        rules: rules?.indicators[code],
        derivedFields: meta ? (meta.derived_fields ?? []).map((d) => d.name) : null,
        sensitivity: meta?.sensitivity,
      });
      return {
        status: 'queued',
        clientUuid,
        device:
          device && device.level !== 'unrated'
            ? {
                level: STATUS_FROM_LEVEL[device.level] ?? 'unevaluated',
                recommendation: device.recommendation ?? null,
                escalation: ESCALATION_FROM_API[device.escalation ?? 'self_care'] ?? 'self',
              }
            : null,
      };
    }
    const { evaluation, escalation_id, emergency } = res.value;
    return {
      status: 'evaluated',
      clientUuid,
      level: STATUS_FROM_LEVEL[evaluation.level] ?? 'unevaluated',
      recommendation: evaluation.recommendation ?? null,
      escalation: ESCALATION_FROM_API[evaluation.escalation] ?? 'self',
      escalationId: escalation_id,
      emergency: emergency ? { sessionId: emergency.session_id, status: emergency.status, deadlineAt: emergency.deadline_at } : null,
    };
  }
}
