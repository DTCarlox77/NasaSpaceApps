import { describe, expect, it } from 'vitest';
import { canOpenPath, canSee, homePathFor, SECTIONS, sectionsFor } from '../nav/access.ts';

const ids = (role: Parameters<typeof sectionsFor>[0]) => sectionsFor(role).map((s) => s.id);

describe('navegación por rol (nav/access.ts)', () => {
  it('admin y flight_surgeon no ven nada conductual', () => {
    for (const role of ['admin', 'flight_surgeon'] as const) {
      expect(canSee(role, 'behavioral')).toBe(false);
      expect(ids(role)).not.toContain('behavioral');
    }
    expect(ids('admin')).toEqual(['crew', 'alerts', 'emergencies', 'compliance', 'demo']);
    expect(ids('flight_surgeon')).toEqual(['crew', 'alerts', 'emergencies']);
  });

  it('behavioral_health: solo Salud conductual (sin Cumplimiento ni Demo)', () => {
    expect(ids('behavioral_health')).toEqual(['behavioral']);
    expect(canSee('behavioral_health', 'compliance')).toBe(false);
    expect(canSee('behavioral_health', 'demo')).toBe(false);
  });

  it('astronaut (y service o sin rol): ninguna sección', () => {
    expect(sectionsFor('astronaut')).toEqual([]);
    expect(sectionsFor('service')).toEqual([]);
    expect(sectionsFor(null)).toEqual([]);
    expect(homePathFor('astronaut')).toBe('/login');
  });

  it('Cumplimiento y Demo solo admin', () => {
    for (const id of ['compliance', 'demo'] as const) {
      expect(canSee('admin', id)).toBe(true);
      expect(canSee('flight_surgeon', id)).toBe(false);
      expect(canSee('behavioral_health', id)).toBe(false);
    }
  });

  it('cada sección: los roles del panel son un subconjunto del x-roles del contrato', () => {
    for (const section of SECTIONS) {
      for (const role of section.roles) expect(section.contractRoles).toContain(role);
    }
  });

  it('ruta inicial: Dashboard para admin y flight_surgeon; Salud conductual para behavioral_health', () => {
    expect(homePathFor('admin')).toBe('/tripulacion');
    expect(homePathFor('flight_surgeon')).toBe('/tripulacion');
    expect(homePathFor('behavioral_health')).toBe('/salud-conductual');
  });

  it('canOpenPath respeta el rol (no vuelve a una sección ajena tras el login)', () => {
    expect(canOpenPath('flight_surgeon', '/alertas')).toBe(true);
    expect(canOpenPath('flight_surgeon', '/cumplimiento')).toBe(false);
    expect(canOpenPath('behavioral_health', '/tripulacion')).toBe(false);
  });
});
