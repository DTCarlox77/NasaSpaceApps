import i18n from '@/core/i18n';
import { apiEnabled } from '@/core/config/env';
import { statusFromServerLevel } from '@/domain/entities/HealthIndicator';
import type { PushItemResult } from '@/domain/entities/Sync';
import { container } from '@/di/container';
import { useAuthStore } from '@/presentation/store/authStore';
import { useCheckInStore } from '@/presentation/store/checkInStore';
import { useHealthLogStore } from '@/presentation/store/healthLogStore';
import { useSupportStore } from '@/presentation/store/supportStore';
import { useSyncStore } from '@/presentation/store/syncStore';
import { showToast } from '@/presentation/store/toastStore';

const str = (v: unknown) => (typeof v === 'string' ? v : null);

/** Aplica a las pantallas lo que el servidor respondió por cada item de la cola. */
function applyPushResult(r: PushItemResult) {
  const { item, result } = r;
  const res = (result ?? {}) as Record<string, unknown>;
  if (r.status === 'conflict') {
    showToast({ level: 'caution', title: i18n.t('sync.conflictTitle'), body: i18n.t('sync.conflictBody') });
    return;
  }
  if (r.status === 'rejected') {
    const clock = r.errorCode === 'FUTURE_TIMESTAMP';
    showToast({ level: 'caution', title: i18n.t('sync.rejectedTitle'), body: i18n.t(clock ? 'sync.clockBody' : 'sync.rejectedBody') });
    return;
  }
  // accepted / duplicate
  switch (item.entity) {
    case 'reading': {
      const ev = (res.evaluation ?? {}) as { level?: string; recommendation?: string };
      if (ev.level) useHealthLogStore.getState().applyEvaluation(item.clientUuid, statusFromServerLevel(ev.level), ev.recommendation ?? null);
      break;
    }
    case 'wellbeing_checkin': {
      const s = res.streak as { streak_days: number; checkins_this_week: number; checkins_goal_week: number } | undefined;
      useCheckInStore.getState().applyAck(item.clientUuid, {
        message: str(res.message) ?? undefined,
        streak: s ? { streakDays: s.streak_days, checkinsThisWeek: s.checkins_this_week, checkinsGoalWeek: s.checkins_goal_week } : null,
        screeningDue: !!res.screening_due,
      });
      break;
    }
    case 'support_request':
      useSupportStore.getState().markSent(item.clientUuid, {
        serverId: r.serverId ?? str(res.id),
        deliverAt: str(res.deliver_at),
        suggestions: Array.isArray(res.suggestions) ? (res.suggestions as never[]) : undefined,
      });
      break;
    case 'emergency_session':
      showToast({
        level: 'critical',
        title: i18n.t('sync.emergencySentTitle'),
        body: i18n.t(res.joined ? 'alert.joinedBody' : 'sync.emergencySentBody'),
      });
      break;
    case 'pvt_run':
      if (str(res.fitness)) {
        showToast({ level: 'info', title: i18n.t('tests.pvt.syncedTitle'), body: i18n.t(`tests.pvt.fitness.${res.fitness === 'fit' ? 'fit' : 'not_confirmed'}`) });
      }
      break;
  }
}

let running: Promise<void> | null = null;

/**
 * Sincroniza ahora (guía §3): sube la cola (emergencias primero) y baja lo nuevo.
 * Seguro de llamar muchas veces: si ya hay una sincronización en curso, espera esa.
 */
export function runSync(): Promise<void> {
  if (!apiEnabled()) return Promise.resolve();
  const session = useAuthStore.getState().session;
  if (!session || session.demo || useAuthStore.getState().status !== 'unlocked') return Promise.resolve();
  if (running) return running;

  const store = useSyncStore.getState();
  running = (async () => {
    store.setSyncing(true);
    try {
      const { push, pull } = await container.syncNow.execute(session.userId);
      push.results.forEach(applyPushResult);

      if (pull) {
        for (const e of pull.evaluations) {
          useHealthLogStore.getState().applyEvaluation(e.clientUuid, statusFromServerLevel(e.level), e.recommendation);
        }
        const support = pull.messages.filter((m) => m.channel === 'support');
        if (support.length) {
          useSupportStore.getState().addReplies(support);
          showToast({ level: 'info', title: i18n.t('support.replyTitle'), body: i18n.t('support.replyBody') });
        }
        const fromEarth = pull.messages.filter((m) => m.channel === 'escalation');
        if (fromEarth.length) showToast({ level: 'info', title: i18n.t('sync.earthReplyTitle'), body: fromEarth[0]!.body });
        store.finish({
          link: pull.link,
          messages: fromEarth,
          changed: push.results.length > 0 || pull.evaluations.length > 0 || pull.escalations.length > 0,
        });
      } else if (push.results.length) {
        store.finish({ changed: true });
      }
      store.setPending(push.remaining);
    } catch {
      // Sin red: la cola sigue en el dispositivo y se reintenta en el próximo ciclo.
    } finally {
      store.setSyncing(false);
      running = null;
    }
  })();
  return running;
}

/** Actualiza el contador de pendientes sin sincronizar. */
export async function refreshPendingCount() {
  const session = useAuthStore.getState().session;
  if (!session || session.demo) return;
  const pending = await container.getPendingSync.execute(session.userId).catch(() => []);
  useSyncStore.getState().setPending(pending.length);
}
