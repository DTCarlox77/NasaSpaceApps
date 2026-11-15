import type {
  ApiAssessment,
  ApiAssessmentResult,
  ApiEmergencyQuestion,
  ApiHeartbeatResponse,
  ApiSessionWithRoster,
  ApiTriageProtocol,
} from './apiTypes';
import { getJson, HttpError, postJson, putJson } from './httpClient';

const enc = encodeURIComponent;

/**
 * Emergencia y triaje (guía §10). `POST /alerts` NO existe en el contrato: se usa
 *   POST /emergency/sessions { client_uuid, trigger_type, started_at, context, responder_safe }
 *     → 201 (o 200 duplicado). Si ya había una abierta, `joined: true` (unirse, no abrir otra).
 *   GET  /emergency/sessions/{id}                  (id o client_uuid)
 *   POST /emergency/sessions/{id}/confirm          ("Estoy bien"; 409 DEADMAN_EXPIRED tarde)
 *   POST /emergency/sessions/{id}/close            (solo comandante u oficial médico)
 *   GET  /emergency/protocol[?version=N]           (protocolo para evaluar sin conexión)
 *   POST /emergency/sessions/{id}/assessments      → PUT /emergency/assessments/{id}/answers
 *     → POST /emergency/assessments/{id}/complete  (device_result; el resultado del servidor manda)
 *   POST /emergency/sessions/{id}/heartbeat        (cada ~30 s mientras se atiende)
 *   POST /emergency/sessions/{id}/questions        ("Pregunta a Tierra")
 */
export const emergencyRemoteDataSource = {
  async openSession(body: Record<string, unknown>): Promise<ApiSessionWithRoster> {
    const res = await postJson<ApiSessionWithRoster>('/emergency/sessions', body);
    if (!res?.session) throw new HttpError('invalid response');
    return res;
  },
  async getSession(id: string, timeoutMs?: number): Promise<ApiSessionWithRoster> {
    const res = await getJson<ApiSessionWithRoster>(`/emergency/sessions/${enc(id)}`, timeoutMs ? { timeoutMs } : undefined);
    if (!res?.session) throw new HttpError('invalid response');
    return res;
  },
  confirm: (id: string, body: Record<string, unknown>) => postJson<unknown>(`/emergency/sessions/${enc(id)}/confirm`, body),
  close: (id: string, body: Record<string, unknown>) => postJson<unknown>(`/emergency/sessions/${enc(id)}/close`, body),

  async getProtocol(version?: number): Promise<ApiTriageProtocol> {
    const res = await getJson<ApiTriageProtocol>(`/emergency/protocol${version ? `?version=${version}` : ''}`);
    if (!res?.definition || !Array.isArray(res.definition.questions)) throw new HttpError('invalid response');
    return res;
  },
  async createAssessment(sessionId: string, body: Record<string, unknown>): Promise<ApiAssessment> {
    const res = await postJson<ApiAssessment>(`/emergency/sessions/${enc(sessionId)}/assessments`, body);
    if (!res?.id) throw new HttpError('invalid response');
    return res;
  },
  putAnswers: (assessmentId: string, body: { answers: Record<string, unknown>[] }) =>
    putJson<{ accepted: number; duplicates: number; preview: ApiAssessmentResult }>(`/emergency/assessments/${enc(assessmentId)}/answers`, body),
  async complete(assessmentId: string, body: Record<string, unknown>): Promise<ApiAssessmentResult> {
    const res = await postJson<ApiAssessmentResult>(`/emergency/assessments/${enc(assessmentId)}/complete`, body);
    if (!res?.status) throw new HttpError('invalid response');
    return res;
  },
  heartbeat: (sessionId: string, body: Record<string, unknown>) =>
    postJson<ApiHeartbeatResponse>(`/emergency/sessions/${enc(sessionId)}/heartbeat`, body),
  async askEarth(sessionId: string, body: Record<string, unknown>): Promise<ApiEmergencyQuestion> {
    const res = await postJson<ApiEmergencyQuestion>(`/emergency/sessions/${enc(sessionId)}/questions`, body);
    if (!res?.id) throw new HttpError('invalid response');
    return res;
  },
};
