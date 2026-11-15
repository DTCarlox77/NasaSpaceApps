import type { CrewMember } from '@/domain/entities/Crew';

/**
 * ⚠️ DATOS DE RELLENO — tripulación sintética para la demo sin backend.
 * Pesos elegidos dentro de un IMC saludable (≈ 20–23 kg/m²) para su estatura, edad y sexo.
 * Tipos de sangre asignados al azar (relleno).
 * El backend reemplazará esta lista con GET /api/v1/crew.
 */
export const CREW: CrewMember[] = [
  {
    id: 'NR-A-0101',
    fullName: 'Claudia Sofía Vargas Ayerdis',
    displayName: 'Claudia Vargas',
    sex: 'female',
    age: 19,
    heightM: 1.65,
    weightKg: 57,
    bloodType: 'O+',
    role: 'astronaut',
    specialty: 'missionSpecialist',
    module: 'Columbus',
    synthetic: true,
  },
  {
    id: 'NR-A-0102',
    fullName: 'María Alejandra Sarante Salinas',
    displayName: 'María Sarante',
    sex: 'female',
    age: 22,
    heightM: 1.7,
    weightKg: 62,
    bloodType: 'A+',
    role: 'astronaut',
    specialty: 'medicalOfficer',
    module: 'Destiny',
    synthetic: true,
  },
  {
    id: 'NR-A-0103',
    fullName: 'Carlos Adrián Espinosa Luna',
    displayName: 'Carlos Espinosa',
    sex: 'male',
    age: 22,
    heightM: 1.81,
    weightKg: 76,
    bloodType: 'B+',
    role: 'astronaut',
    specialty: 'commander',
    module: 'Harmony',
    synthetic: true,
  },
  {
    id: 'NR-A-0104',
    fullName: 'Mauro Engelbert Delgado Saenz',
    displayName: 'Mauro Delgado',
    sex: 'male',
    age: 19,
    heightM: 1.76,
    weightKg: 70,
    bloodType: 'O-',
    role: 'astronaut',
    specialty: 'flightEngineer',
    module: 'Unity',
    synthetic: true,
  },
  {
    id: 'NR-A-0105',
    fullName: 'Víctor Mateo Alcocer López',
    displayName: 'Víctor Alcocer',
    sex: 'male',
    age: 18,
    heightM: 1.73,
    weightKg: 66,
    bloodType: 'AB+',
    role: 'astronaut',
    specialty: 'payloadSpecialist',
    module: 'Kibo',
    synthetic: true,
  },
  {
    id: 'NR-A-0106',
    fullName: 'Jorge Adán Ortega Torres',
    displayName: 'Jorge Ortega',
    sex: 'male',
    age: 20,
    heightM: 1.78,
    weightKg: 73,
    bloodType: 'A-',
    role: 'astronaut',
    specialty: 'missionSpecialist',
    module: 'Tranquility',
    synthetic: true,
  },
];

/**
 * Contraseñas de PRUEBA de la demo (sin backend). No son credenciales reales;
 * con backend la validación la hace POST /api/v1/auth/login.
 */
const DEMO_PASSWORDS: Record<string, string> = {
  'NR-A-0101': 'Claudia2026',
  'NR-A-0102': 'Maria2026',
  'NR-A-0103': 'Carlos2026',
  'NR-A-0104': 'Mauro2026',
  'NR-A-0105': 'Victor2026',
  'NR-A-0106': 'Jorge2026',
};

/** Tripulante que usa la sesión demo (sin login). */
export const DEFAULT_CREW_ID = 'NR-A-0103';

export const crewMockDataSource = {
  list: async (): Promise<CrewMember[]> => CREW,
  findById: (id: string) => CREW.find((c) => c.id === id.trim().toUpperCase()) ?? null,
  /** Devuelve el tripulante solo si el ID y la contraseña de prueba coinciden. */
  verify: (id: string, password: string) => {
    const member = CREW.find((c) => c.id === id.trim().toUpperCase());
    return member && DEMO_PASSWORDS[member.id] === password ? member : null;
  },
};
