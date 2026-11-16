import type { CrewMember } from '../entities/Crew';
import type { MissionCrewRole } from '../entities/Session';
import type { OutboxItem } from '../entities/Sync';
import type { LocalAnswer, TriageRosterEntry, TriageSessionView } from '../entities/Triage';
import type { CrewRepository } from '../repositories/CrewRepository';
import type { EmergencyReportRepository } from '../repositories/EmergencyReportRepository';
import type { HealthRepository } from '../repositories/HealthRepository';
import type { TriageRepository } from '../repositories/TriageRepository';

/** Especialidad de la maqueta (modo demo) → rol de tripulación del contrato (solo para mostrarlo). */
const DEMO_ROLE: Record<CrewMember['specialty'], MissionCrewRole> = {
  commander: 'commander',
  medicalOfficer: 'crew_medical_officer',
  flightEngineer: 'flight_engineer',
  missionSpecialist: 'mission_specialist',
  payloadSpecialist: 'mission_specialist',
};

/**
 * Datos para trabajar sin conexión: protocolo de triaje (GET /emergency/protocol) y reglas del semáforo
 * (GET /rules). Al iniciar sesión se bajan siempre (`force`); después, cuando el pull dice `changed`, cuando
 * la versión activa no coincide con la guardada o si todavía no hay nada guardado.
 */
export class RefreshOfflineData {
  constructor(
    private readonly triage: TriageRepository,
    private readonly health: HealthRepository,
    private readonly crew: CrewRepository,
  ) {}

  async execute(opts: { force?: boolean; protocolChanged?: boolean; protocolVersion?: number; rulesChanged?: boolean } = { force: true }) {
    const active = await this.triage.getProtocol(null, { network: false });
    const protocol =
      opts.force || opts.protocolChanged || active.origin === 'fallback' || (opts.protocolVersion !== undefined && opts.protocolVersion !== active.version);
    await Promise.all([
      protocol ? this.triage.refreshProtocol() : null,
      this.health.refreshRules({ onlyIfMissing: !opts.force && !opts.rulesChanged }),
      // La tripulación vigente también queda guardada: sin enlace es a quién evaluar.
      opts.force ? this.crew.getRoster().catch(() => null) : null,
    ]);
  }
}

export class GetTriageProtocol {
  constructor(private readonly triage: TriageRepository) {}
  execute(version?: number | null) {
    return this.triage.getProtocol(version);
  }
}

/** Sesión de triaje: estado, a quién evaluar (roster del servidor o, sin enlace, la tripulación vigente) y orden de atención. */
export class GetTriageSession {
  constructor(
    private readonly triage: TriageRepository,
    private readonly crew: CrewRepository,
  ) {}

  /** `remote: false` = solo el dispositivo (instantáneo); `remote: true` = además el servidor. */
  execute(ref: string, opts: { remote: boolean } = { remote: true }): Promise<TriageSessionView | null> {
    return this.triage.loadSession(ref, async () => {
      // Sin roster del servidor: la tripulación vigente guardada (sin volver a esperar a la red).
      const roster = await this.crew.getRoster({ cachedOnly: true }).catch(() => null);
      if (roster?.members.length) {
        const entries: TriageRosterEntry[] = [...roster.members]
          .sort((a, b) => a.callSign.localeCompare(b.callSign))
          .map((m, i) => ({ astronautId: m.astronautId, callSign: m.callSign, crewRole: m.crewRole, sequenceNo: i + 1, priorityReason: null }));
        return { entries, source: 'crew' as const };
      }
      const demo = await this.crew.list().catch(() => []);
      if (demo.length) {
        const entries: TriageRosterEntry[] = demo.map((m, i) => ({
          astronautId: m.id,
          callSign: m.displayName,
          crewRole: DEMO_ROLE[m.specialty] ?? null,
          sequenceNo: i + 1,
          priorityReason: null,
        }));
        return { entries, source: 'demo' as const };
      }
      return { entries: [], source: 'none' as const };
    }, opts);
  }
}

export class AnswerResponderSafe {
  constructor(private readonly triage: TriageRepository) {}
  execute(ref: string, answer: LocalAnswer) {
    return this.triage.answerResponderSafe(ref, answer);
  }
}

export class StartAssessment {
  constructor(private readonly triage: TriageRepository) {}
  execute(ref: string, member: TriageRosterEntry, protocolVersion: number) {
    return this.triage.startAssessment(ref, member, protocolVersion);
  }
}

export class GetAssessment {
  constructor(private readonly triage: TriageRepository) {}
  execute(clientUuid: string) {
    return this.triage.getAssessment(clientUuid);
  }
}

export class SaveAnswers {
  constructor(private readonly triage: TriageRepository) {}
  execute(clientUuid: string, answers: LocalAnswer[]) {
    return this.triage.saveAnswers(clientUuid, answers);
  }
}

export class CompleteAssessment {
  constructor(private readonly triage: TriageRepository) {}
  execute(clientUuid: string) {
    return this.triage.completeAssessment(clientUuid);
  }
}

export class SendHeartbeat {
  constructor(private readonly triage: TriageRepository) {}
  execute(ref: string) {
    return this.triage.heartbeat(ref);
  }
}

export class AskEarth {
  constructor(private readonly triage: TriageRepository) {}
  execute(ref: string, body: string) {
    return this.triage.askEarth(ref, body);
  }
}

export class ApplyTriagePushResult {
  constructor(private readonly triage: TriageRepository) {}
  execute(item: OutboxItem, status: string, result: Record<string, unknown> | null) {
    return this.triage.applyPushResult(item, status, result);
  }
}

/** Cerrar (solo comandante u oficial médico): `closed` = atendida, `cancelled` = falsa alarma. */
export class CloseTriageSession {
  constructor(
    private readonly emergency: EmergencyReportRepository,
    private readonly triage: TriageRepository,
  ) {}

  async execute(view: Pick<TriageSessionView, 'session'>, status: 'closed' | 'cancelled', notes?: string) {
    if (view.session.demo) {
      // Modo demo: no hay servidor; se cierra en el dispositivo.
      await this.triage.markClosed(view.session.ref, status);
      return 'closed' as const;
    }
    const res = await this.emergency.close(view.session.serverId ?? view.session.ref, status, notes);
    if (res !== 'forbidden') await this.triage.markClosed(view.session.ref, status);
    return res;
  }
}
