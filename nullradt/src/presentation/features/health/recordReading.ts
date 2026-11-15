import { File, Paths } from 'expo-file-system';
import i18n from '@/core/i18n';
import type { IndicatorId, MeasurementSource } from '@/domain/entities/HealthIndicator';
import { evaluateIndicator, type RuleResult } from '@/domain/rules/ruleEngine';
import { alertCrew } from '@/presentation/features/crew/crewAlerts';
import { biometricsOf } from '@/presentation/hooks/useMyBiometrics';
import { useAuthStore } from '@/presentation/store/authStore';
import { useHealthLogStore } from '@/presentation/store/healthLogStore';
import { sendToEarth } from '@/presentation/store/outboxStore';

export interface RecordInput {
  indicatorId: IndicatorId;
  value: number;
  secondaryValue?: number;
  source: MeasurementSource;
  photoUri?: string;
  note?: string;
  /** Historial previo de valores (línea base) si se conoce; si no, se usan las lecturas locales. */
  history?: number[];
}

/** Copia la foto de la cámara (caché temporal) a la carpeta permanente de la app. */
export function persistPhoto(uri: string): string {
  try {
    const dest = new File(Paths.document, `reading-${Date.now()}.jpg`);
    new File(uri).copy(dest);
    return dest.uri;
  } catch {
    return uri;
  }
}

/**
 * Registra una lectura: la evalúa con el motor de reglas, la guarda en el dispositivo (offline-first)
 * y aplica el escalamiento:
 *  - precaución persistente → aviso a la tripulación
 *  - crítico → aviso inmediato a la tripulación + escalamiento al flight surgeon (llega a Tierra con retraso)
 */
export function recordReading(input: RecordInput, opts: { notify?: boolean } = {}): RuleResult {
  const session = useAuthStore.getState().session;
  const userId = session?.userId ?? '';
  const mine = (useHealthLogStore.getState().readings[userId] ?? []).filter((r) => r.indicatorId === input.indicatorId);
  const result = evaluateIndicator(input.indicatorId, input.value, input.secondaryValue, {
    history: input.history ?? mine.slice(-7).map((r) => r.reading.value),
    recentStatuses: mine.slice(-3).map((r) => r.status),
    sex: session?.sex ?? biometricsOf(userId)?.sex,
  });
  const takenAt = new Date().toISOString();
  useHealthLogStore.getState().addReading(userId, {
    indicatorId: input.indicatorId,
    status: result.status,
    reading: {
      value: input.value,
      secondaryValue: input.secondaryValue,
      takenAt,
      source: input.source,
      synced: false,
      photoUri: input.photoUri,
      note: input.note,
    },
  });

  const valueText = `${input.secondaryValue !== undefined ? `${input.value}/${input.secondaryValue}` : input.value}`;
  if (opts.notify !== false) {
    if (result.status === 'critical' || result.escalation === 'crew') {
      alertCrew({ kind: 'measurement', severity: result.status === 'critical' ? 'critical' : 'caution', indicatorId: input.indicatorId, value: valueText });
    }
  }
  if (result.escalation === 'flightSurgeon') {
    sendToEarth({
      kind: 'escalation',
      audience: 'flightSurgeon',
      fromId: userId,
      subjectId: userId,
      title: i18n.t('rules.earthTitle', { name: session?.displayName ?? userId }),
      body: i18n.t('rules.earthBody', { what: i18n.t(`indicators.${input.indicatorId}.name`), value: valueText, status: i18n.t(`status.${result.status}`) }),
      confidential: false,
    });
  }
  return result;
}
