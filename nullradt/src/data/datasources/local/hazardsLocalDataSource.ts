import type { Hazard } from '@/domain/entities/Hazard';

const HRP_HAZARDS = {
  title: 'NASA Human Research Program – 5 Hazards of Human Spaceflight',
  url: 'https://www.nasa.gov/hrp/hazards/',
};

/** Catálogo estático, disponible sin conexión. */
export const hazardsLocalDataSource = {
  getAll: async (): Promise<Hazard[]> => [
    { id: 'radiation', letter: 'R', source: HRP_HAZARDS },
    { id: 'isolation', letter: 'I', source: HRP_HAZARDS },
    { id: 'distance', letter: 'D', source: HRP_HAZARDS },
    { id: 'gravity', letter: 'G', source: HRP_HAZARDS },
    { id: 'environment', letter: 'E', source: HRP_HAZARDS },
  ],
};
