import type { GlobalRole, MissionCrewRole } from '../entities/Session';

/**
 * Acciones administrativas. Solo control de misión crea cuentas.
 * El comandante tiene permisos DELEGADOS y auditados (se reportan a Tierra) para operar sin esperar al enlace:
 * desbloquear cuentas, restablecer PIN y registrar una tableta de repuesto.
 * Ninguna de estas acciones da acceso a datos médicos o de bienestar (eso lo decide visibility.ts).
 */
export type AdminAction = 'createAccount' | 'unlockAccount' | 'resetPin' | 'registerDevice';

export interface Actor {
  userId: string;
  role: GlobalRole;
  crewRole?: MissionCrewRole;
  missionId?: string;
}

const COMMANDER_DELEGATED: AdminAction[] = ['unlockAccount', 'resetPin', 'registerDevice'];

export function can(actor: Actor, action: AdminAction, target?: { missionId?: string }): { allowed: boolean; delegated: boolean } {
  if (actor.role === 'admin') return { allowed: true, delegated: false };
  if (actor.role === 'astronaut' && actor.crewRole === 'commander' && COMMANDER_DELEGATED.includes(action)) {
    // Solo sobre su propia misión.
    const sameMission = !target || !target.missionId || target.missionId === actor.missionId;
    return { allowed: sameMission, delegated: true };
  }
  return { allowed: false, delegated: false };
}

/** Política de contraseñas: ≥ 8 caracteres con letras y números. */
export const isStrongPassword = (p: string) => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
export const isValidPin = (p: string) => /^\d{6}$/.test(p) && !/^(\d)\1{5}$/.test(p) && p !== '123456' && p !== '654321';
