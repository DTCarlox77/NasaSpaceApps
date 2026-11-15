/**
 * Control de misión (solo admin):
 * - GET  /admin/compliance?mission_id=   cumplimiento y aptitud (lo único de bienestar que ve admin)
 * - POST /admin/demo/reset { confirm }   reinicio de la demo de ARES-1 (solo con el modo demo del
 *   servidor; 404 fuera de él). Tarda hasta ~1 min en Render: timeout de 6 min.
 */
import { request } from './http.ts';
import { withQuery } from './params.ts';
import type { ComplianceReport, DemoResetSummary } from './types.ts';

export const DEMO_RESET_TIMEOUT_MS = 6 * 60_000;

export function getCompliance(missionId: string, signal?: AbortSignal): Promise<ComplianceReport> {
  return request<ComplianceReport>(withQuery('/admin/compliance', { mission_id: missionId }), { signal });
}

export function resetDemo(confirm: string): Promise<DemoResetSummary> {
  return request<DemoResetSummary>('/admin/demo/reset', {
    method: 'POST',
    body: { confirm },
    timeoutMs: DEMO_RESET_TIMEOUT_MS,
  });
}
