import i18n from '@/core/i18n';
import type { CrewMember } from '@/domain/entities/Crew';
import { evaluateTriage, PROTOCOL, questionText } from '@/domain/triage/evaluator';
import { sendToEarth, type OutboxMessage } from '@/presentation/store/outboxStore';
import { useTriageStore, type TriageIncident } from '@/presentation/store/triageStore';

const lang = () => (i18n.language === 'es' ? 'es' : 'en');

/** Reporte completo del incidente en texto plano (legible en Tierra sin la app). */
export function buildTriageReport(incident: TriageIncident, crew: CrewMember[]): string {
  const l = lang();
  const lines: string[] = [
    `${i18n.t('triage.report.header')} ${incident.id}`,
    `${i18n.t('triage.report.protocol')}: ${incident.protocolVersion}`,
    `${i18n.t('triage.report.trigger')}: ${i18n.t(`triage.triggers.${incident.trigger}`)} · ${new Date(incident.startedAt).toISOString()}`,
    '',
  ];
  const rows = crew
    .map((m) => ({ m, p: incident.patients[m.id] }))
    .filter((r) => r.p)
    .map((r) => ({ ...r, ev: evaluateTriage(r.p!.answers) }))
    .sort((a, b) => a.ev.priority - b.ev.priority);
  if (!rows.length) lines.push(i18n.t('triage.report.noneAssessed'));
  for (const { m, p, ev } of rows) {
    const cat = ev.category ? PROTOCOL.categories[ev.category].label[l] : i18n.t('triage.pending');
    lines.push(`■ ${m.fullName} (${m.id}, ${m.bloodType}) — ${cat}`);
    if (ev.radiation !== 'none') lines.push(`  ${i18n.t(`triage.radiation.${ev.radiation}`)}`);
    ev.path.forEach((s) => lines.push(`  · ${questionText(s.id, l)} → ${s.answer ? i18n.t('triage.yes') : i18n.t('triage.no')}${s.auto ? ` (${i18n.t('triage.auto')})` : ''}`));
    if (p!.outOfProtocol) lines.push(`  ⚠ ${i18n.t('triage.outOfProtocol')}: ${p!.outOfProtocol}`);
  }
  lines.push('', i18n.t('triage.report.footer'));
  return lines.join('\n');
}

/** Envía el reporte a Tierra (llega cuando el enlace lo permite: compute_deliver_at). */
export function sendTriageReport(crew: CrewMember[], auto = false): OutboxMessage | null {
  const incident = useTriageStore.getState().active;
  if (!incident) return null;
  const body = buildTriageReport(incident, crew);
  const msg = sendToEarth({
    kind: 'triageReport',
    audience: 'flightSurgeon',
    fromId: incident.activatedBy,
    title: `${i18n.t('triage.report.header')} ${incident.id}${auto ? ` · ${i18n.t('triage.report.auto')}` : ''}`,
    body,
    confidential: false,
  });
  // Control de misión recibe una copia (estado operativo; el detalle médico va al flight surgeon).
  sendToEarth({
    kind: 'emergency',
    audience: 'missionControl',
    fromId: incident.activatedBy,
    title: i18n.t('triage.report.mcTitle', { id: incident.id }),
    body: i18n.t('triage.report.mcBody', { count: Object.keys(incident.patients).length }),
    confidential: false,
  });
  useTriageStore.getState().addReport({ messageId: msg.id, sentAt: msg.createdAt, auto });
  return msg;
}
