import { describe, expect, it } from 'vitest';
import {
  clockTime,
  countdownLabel,
  deliveryState,
  formatDuration,
  lagLabel,
  lateSyncLabel,
  registeredLabel,
  timeAgo,
} from '../lib/time.ts';

// Las pruebas corren con TZ=UTC (vite.config.ts).
const NOW = Date.parse('2026-11-14T08:15:00Z');

describe('lib/time', () => {
  it('clockTime: hh:mm local de 24 h; vacío si no hay fecha', () => {
    expect(clockTime('2026-11-14T08:05:40Z')).toBe('08:05');
    expect(clockTime('2026-11-14T18:30:00Z')).toBe('18:30');
    expect(clockTime(null)).toBe('');
    expect(clockTime('no es fecha')).toBe('');
  });

  it('formatDuration: dos unidades como máximo', () => {
    expect(formatDuration(0)).toBe('0 s');
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(90)).toBe('1 min 30 s');
    expect(formatDuration(120)).toBe('2 min');
    expect(formatDuration(2 * 3600 + 5 * 60 + 9)).toBe('2 h 5 min');
    expect(formatDuration(3 * 86400 + 4 * 3600)).toBe('3 d 4 h');
  });

  it('timeAgo: "hace X" relativo', () => {
    expect(timeAgo('2026-11-14T08:14:40Z', NOW)).toBe('hace un momento');
    expect(timeAgo('2026-11-14T08:10:00Z', NOW)).toBe('hace 5 min');
    expect(timeAgo('2026-11-14T06:00:00Z', NOW)).toBe('hace 2 h');
    expect(timeAgo('2026-11-11T08:15:00Z', NOW)).toBe('hace 3 d');
    expect(timeAgo('2026-11-14T08:25:00Z', NOW)).toBe('en 10 min');
  });

  it('retraso legible a partir de lag_s y etiqueta de late_sync', () => {
    expect(lagLabel(90)).toBe('llegó 1 min 30 s después');
    expect(lagLabel(0)).toBe('llegó al momento');
    expect(lagLabel(undefined)).toBe('');
    expect(lateSyncLabel(true)).toBe('sincronizado tarde');
    expect(lateSyncLabel(false)).toBe('');
    expect(registeredLabel('2026-11-14T06:15:00Z', NOW, 6600, true)).toBe(
      'registrado hace 2 h · llegó 1 h 50 min después · sincronizado tarde',
    );
    expect(registeredLabel('2026-11-14T08:10:00Z', NOW)).toBe('registrado hace 5 min');
  });

  it('cuenta regresiva hasta deliver_at', () => {
    expect(countdownLabel('2026-11-14T08:16:25Z', NOW)).toBe('faltan 1 min 25 s');
    expect(countdownLabel('2026-11-14T08:10:00Z', NOW)).toBe('');
  });

  it('los 3 estados de deliver_at: futuro, null y pasado', () => {
    expect(deliveryState('2026-11-14T08:16:30Z', NOW)).toEqual({
      kind: 'in_transit',
      label: 'Llega a bordo a las 08:16',
      countdown: 'faltan 1 min 30 s',
    });
    expect(deliveryState(null, NOW)).toEqual({
      kind: 'pending',
      label: 'Pendiente de envío: sin enlace',
      countdown: '',
    });
    expect(deliveryState('2026-11-14T08:12:30Z', NOW)).toEqual({
      kind: 'delivered',
      label: 'Entregado a bordo',
      countdown: '',
    });
  });
});
