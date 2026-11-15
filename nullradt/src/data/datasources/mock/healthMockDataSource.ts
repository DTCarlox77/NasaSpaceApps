import type { HealthIndicator, Reading } from '@/domain/entities/HealthIndicator';

/**
 * ⚠️ MAQUETA (MOCK) — valores de ejemplo del prototipo en Figma, NO datos reales ni umbrales validados.
 * Se usa solo mientras no exista backend (EXPO_PUBLIC_API_URL vacío).
 * El backend debe devolver esta misma forma en GET /api/v1/health/indicators,
 * incluyendo el `status` calculado con reglas validadas y su `range.source` citado.
 */
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

const reading = (value: number, h: number, extra: Partial<Reading> = {}): Reading => ({
  value,
  takenAt: hoursAgo(h),
  missionDay: 142,
  source: 'wearable',
  synced: true,
  ...extra,
});

const MOCK: HealthIndicator[] = [
  { id: 'heartRate', systemId: 'cardiovascular', unit: 'bpm', hazards: ['gravity', 'isolation'], status: 'normal', latest: reading(63, 2), personalRange: { min: 54, max: 70 }, trend: [61, 64, 62, 66, 63, 60, 63], frequencyHours: 24, synthetic: true },
  { id: 'bloodPressure', systemId: 'cardiovascular', unit: 'mmHg', hazards: ['gravity'], status: 'normal', latest: reading(118, 26, { secondaryValue: 76, source: 'manual' }), personalRange: { min: 108, max: 124 }, trend: [114, 120, 117, 121, 116, 119, 118], frequencyHours: 48, synthetic: true },
  { id: 'spo2', systemId: 'respiratory', unit: '%', hazards: ['environment'], status: 'normal', latest: reading(98, 2), personalRange: { min: 96, max: 99 }, trend: [97, 98, 98, 97, 99, 98, 98], frequencyHours: 24, synthetic: true },
  { id: 'respRate', systemId: 'respiratory', unit: 'rpm', hazards: ['environment'], status: 'normal', latest: reading(14, 30), personalRange: { min: 12, max: 16 }, trend: [15, 14, 13, 15, 14, 14, 14], frequencyHours: 48, synthetic: true },
  { id: 'reactionTime', systemId: 'brain', unit: 'ms', hazards: ['isolation', 'radiation'], status: 'normal', latest: reading(281, 40, { source: 'manual' }), personalRange: { min: 240, max: 290 }, trend: [262, 270, 258, 275, 268, 284, 281], frequencyHours: 72, synthetic: true },
  { id: 'eyePressure', systemId: 'eyes', unit: 'mmHg', hazards: ['gravity'], status: 'caution', latest: reading(22, 20, { source: 'camera' }), personalRange: { min: 14, max: 18 }, trend: [16, 17, 17, 18, 19, 20, 22], frequencyHours: 168, synthetic: true },
  { id: 'urinaryCalcium', systemId: 'skeletal', unit: 'mg/día', hazards: ['gravity'], status: 'unevaluated', latest: reading(286, 120, { source: 'manual' }), trend: [240, 252, 260, 271, 278, 286], frequencyHours: 336, synthetic: true },
  { id: 'gripStrength', systemId: 'muscular', unit: 'kg', hazards: ['gravity'], status: 'normal', latest: reading(41.8, 50, { source: 'manual', synced: false }), personalRange: { min: 42, max: 47 }, trend: [45.1, 44.6, 44.0, 43.2, 42.5, 41.8], frequencyHours: 168, synthetic: true },
  { id: 'bodyTemperature', systemId: 'immune', unit: '°C', hazards: ['environment', 'radiation'], status: 'normal', latest: reading(36.9, 3), trend: [36.7, 36.8, 36.9, 36.6, 36.8, 36.9], frequencyHours: 24, synthetic: true },
];

export const healthMockDataSource = {
  getIndicators: async (): Promise<HealthIndicator[]> => MOCK,
};
