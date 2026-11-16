/**
 * Modelo del enlace Tierra ↔ nave. Función pura (la misma corre en el servidor a bordo y en Tierra).
 *
 * - Retraso de una vía = distancia / velocidad de la luz. Valores de referencia:
 *   órbita baja ≈ 0 s; Luna / Gateway ≈ 1,3 s; Marte 3–22 min según la posición orbital (NASA).
 * - Cortes de enlace (pérdida de señal) en ventanas periódicas.
 * En la demo el perfil se elige en "Comunicaciones" y se simula en el dispositivo.
 */

export type LinkProfileId = 'leo' | 'lunar' | 'mars' | 'demo';

export interface LinkProfile {
  id: LinkProfileId;
  /** Retraso de una vía en segundos. */
  oneWayDelaySec: number;
  /** Ciclo de cortes: cada `periodMin` minutos hay `blackoutMin` minutos sin enlace. 0 = sin cortes. */
  periodMin: number;
  blackoutMin: number;
}

export const LINK_PROFILES: Record<LinkProfileId, LinkProfile> = {
  leo: { id: 'leo', oneWayDelaySec: 0.25, periodMin: 92, blackoutMin: 6 },
  lunar: { id: 'lunar', oneWayDelaySec: 1.3, periodMin: 0, blackoutMin: 0 },
  mars: { id: 'mars', oneWayDelaySec: 12 * 60, periodMin: 24 * 60 + 40, blackoutMin: 60 },
  // Demo: retraso visible en vivo (45 s) y un corte de 1 min cada 6 min.
  demo: { id: 'demo', oneWayDelaySec: 45, periodMin: 6, blackoutMin: 1 },
};

/** ¿Está el enlace cortado en este instante? Las ventanas se alinean a la época Unix para que sean deterministas. */
export function isBlackout(at: number, p: LinkProfile, forcedOffline = false): boolean {
  if (forcedOffline) return true;
  if (!p.periodMin || !p.blackoutMin) return false;
  const periodMs = p.periodMin * 60_000;
  return at % periodMs >= periodMs - p.blackoutMin * 60_000;
}

/** Próximo instante con enlace disponible (≥ at). */
export function nextLinkWindow(at: number, p: LinkProfile): number {
  if (!isBlackout(at, p)) return at;
  const periodMs = p.periodMin * 60_000;
  return Math.ceil(at / periodMs) * periodMs;
}

/**
 * compute_deliver_at: cuándo llega a Tierra (o a bordo) un mensaje enviado en `sentAt`.
 * Espera a la próxima ventana con enlace y suma el retraso de la luz.
 * `forcedOffline` = el usuario desconectó el enlace a mano: queda en cola sin hora de entrega.
 */
export function computeDeliverAt(sentAt: number, p: LinkProfile, forcedOffline = false): number | null {
  if (forcedOffline) return null;
  return nextLinkWindow(sentAt, p) + Math.round(p.oneWayDelaySec * 1000);
}

/** Tiempo de ida y vuelta mínimo (pregunta → respuesta), sin contar cortes. */
export const roundTripSec = (p: LinkProfile) => p.oneWayDelaySec * 2;
