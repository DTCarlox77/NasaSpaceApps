/**
 * Personas del modo demo (SINTÉTICAS), con los mismos ids del seed del backend
 * (backend/db/seeds/001 y 003). Nadie tiene contraseña: en mock entra cualquier contraseña no vacía.
 */
import type { CrewRole, GroundRole, Role } from '../../types.ts';

export interface MockUser {
  id: string;
  username: string;
  full_name: string;
  role: Role;
}

export interface MockCrewMember extends MockUser {
  role: 'astronaut';
  astronaut_id: string;
  call_sign: string;
  crew_role: CrewRole;
}

export interface MockGroundUser extends MockUser {
  role: GroundRole;
}

export const GROUND_USERS: readonly MockGroundUser[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    username: 'mission.control',
    full_name: 'Control de Misión (demo)',
    role: 'admin',
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    username: 'dr.reyes',
    full_name: 'Dra. Elena Reyes (sintética)',
    role: 'flight_surgeon',
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    username: 'bh.salas',
    full_name: 'Dra. Inés Salas (sintética)',
    role: 'behavioral_health',
  },
];

export const CREW: readonly MockCrewMember[] = [
  {
    id: '00000000-0000-4000-8000-000000000011',
    username: 'a.ortega',
    full_name: 'Ana Ortega (sintética)',
    role: 'astronaut',
    astronaut_id: '10000000-0000-4000-8000-000000000011',
    call_sign: 'ORION',
    crew_role: 'commander',
  },
  {
    id: '00000000-0000-4000-8000-000000000012',
    username: 'k.mensah',
    full_name: 'Kofi Mensah (sintético)',
    role: 'astronaut',
    astronaut_id: '10000000-0000-4000-8000-000000000012',
    call_sign: 'VEGA',
    crew_role: 'crew_medical_officer',
  },
  {
    id: '00000000-0000-4000-8000-000000000013',
    username: 'l.tanaka',
    full_name: 'Lin Tanaka (sintética)',
    role: 'astronaut',
    astronaut_id: '10000000-0000-4000-8000-000000000013',
    call_sign: 'LYRA',
    crew_role: 'flight_engineer',
  },
  {
    id: '00000000-0000-4000-8000-000000000014',
    username: 'm.silva',
    full_name: 'Marco Silva (sintético)',
    role: 'astronaut',
    astronaut_id: '10000000-0000-4000-8000-000000000014',
    call_sign: 'ATLAS',
    crew_role: 'mission_specialist',
  },
];

export const ALL_USERS: readonly MockUser[] = [...GROUND_USERS, ...CREW];

export const userByUsername = (username: string): MockUser | undefined =>
  ALL_USERS.find((u) => u.username === username);

export const userById = (id: string): MockUser | undefined => ALL_USERS.find((u) => u.id === id);

export const groundUser = (role: GroundRole): MockGroundUser =>
  GROUND_USERS.find((u) => u.role === role) as MockGroundUser;

export function crewByCallSign(callSign: string): MockCrewMember {
  const member = CREW.find((c) => c.call_sign === callSign);
  if (!member) throw new Error(`Tripulante desconocido: ${callSign}`);
  return member;
}

export const crewByAstronautId = (id: string): MockCrewMember | undefined =>
  CREW.find((c) => c.astronaut_id === id);
