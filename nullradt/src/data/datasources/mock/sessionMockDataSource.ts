import type { Session } from '@/domain/entities/Session';
import { CREW, DEFAULT_CREW_ID } from './crewMockDataSource';

/**
 * ⚠️ DATOS DE RELLENO — sesión con un tripulante sintético.
 * Se usa cuando el login está desactivado (EXPO_PUBLIC_REQUIRE_AUTH ≠ "true").
 */
export const sessionMockDataSource = {
  demoSession: (): Session => {
    const member = CREW.find((c) => c.id === DEFAULT_CREW_ID)!;
    return {
      userId: member.id,
      displayName: member.displayName,
      role: member.role,
      crewRole: member.specialty === 'commander' ? 'commander' : member.specialty === 'medicalOfficer' ? 'medical_officer' : 'crew',
      missionId: 'artemis-gateway-7',
      token: 'demo-token',
      issuedAt: new Date().toISOString(),
      demo: true,
      authMode: 'demoAuto',
    };
  },
};
