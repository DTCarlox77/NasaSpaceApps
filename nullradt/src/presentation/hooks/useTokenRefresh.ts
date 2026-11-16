import { useEffect } from 'react';
import i18n from '@/core/i18n';
import { onboardServer } from '@/data/onboard/onboardServer';
import { TokenReuseError } from '@/domain/entities/Session';
import { useAuthStore } from '@/presentation/store/authStore';
import { showToast } from '@/presentation/store/toastStore';

/** Rota el JWT de acceso antes de que caduque usando el refresh token (un solo uso). */
export async function rotateTokens(): Promise<boolean> {
  const { session, updateSession, signOut } = useAuthStore.getState();
  if (!session?.refreshToken || session.authMode !== 'onboard') return false;
  try {
    const next = onboardServer.refresh(session.refreshToken);
    await updateSession({ token: next.token, refreshToken: next.refreshToken, accessExpiresAt: next.accessExpiresAt });
    return true;
  } catch (e) {
    if (e instanceof TokenReuseError) {
      showToast({ level: 'critical', title: i18n.t('access.reuseTitle'), body: i18n.t('access.reuseBody') });
      await signOut();
    }
    return false;
  }
}

export function useTokenRefresh() {
  const status = useAuthStore((s) => s.status);
  useEffect(() => {
    if (status !== 'unlocked') return;
    const tick = () => {
      const exp = useAuthStore.getState().session?.accessExpiresAt;
      if (exp && new Date(exp).getTime() - Date.now() < 60_000) rotateTokens();
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [status]);
}
