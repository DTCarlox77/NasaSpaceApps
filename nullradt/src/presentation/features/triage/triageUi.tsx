import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import type { TFunction } from 'i18next';
import { create } from 'zustand';
import { palette, useAppTheme } from '@/core/theme';
import { requestMicPermission, type MicPermission } from '@/core/speech/listenOnce';
import type { RadiationFlag, TriageCategory, TriageSessionView } from '@/domain/entities/Triage';
import { container } from '@/di/container';
import { AppText } from '@/presentation/components/ui';
import { useSyncStore } from '@/presentation/store/syncStore';

/** Colores de la categoría START: verde/amarillo/rojo del semáforo y negro (expectante) en neutros oscuros. */
export function useCategoryColors() {
  const { colors } = useAppTheme();
  return (c: TriageCategory | null) =>
    c === 'green'
      ? colors.status.normal
      : c === 'yellow'
        ? colors.status.caution
        : c === 'red'
          ? colors.status.critical
          : c === 'black'
            ? { solid: palette.neutral[900], background: palette.neutral[800], text: palette.neutral[0], ring: palette.neutral[700] }
            : colors.status.unevaluated;
}

const CATEGORY_ICON: Record<TriageCategory, keyof typeof Ionicons.glyphMap> = {
  red: 'alert-circle',
  yellow: 'warning',
  green: 'checkmark-circle',
  black: 'remove-circle',
};

/** Chip de categoría: siempre ícono + texto (nunca solo color). */
export function CategoryChip({
  category,
  flag,
  t,
  size = 'md',
  fallback,
}: {
  category: TriageCategory | null;
  flag?: RadiationFlag | null;
  t: TFunction;
  size?: 'md' | 'lg';
  fallback?: string;
}) {
  const { radius, spacing } = useAppTheme();
  const colorsFor = useCategoryColors();
  const c = colorsFor(category);
  const label = category ? t(`triage.category.${category}`) : (fallback ?? t('triage.attention.unassessed'));
  return (
    <View style={[styles.chip, { backgroundColor: c.background, borderColor: c.ring, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: size === 'lg' ? spacing.sm : 4 }]}>
      <Ionicons name={category ? CATEGORY_ICON[category] : 'ellipse-outline'} size={size === 'lg' ? 22 : 15} color={category === 'black' ? c.text : c.solid} />
      <AppText variant={size === 'lg' ? 'title' : 'label'} style={{ color: c.text }}>
        {label}
        {flag && flag !== 'none' ? ` · ${t(`triage.flag.${flag}`)}` : ''}
      </AppText>
    </View>
  );
}

const hhmm = (iso: string, lang: string) => new Date(iso).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });

/** Estado de un envío a Tierra por `deliver_at`: en camino (llega a las hh:mm), entregado o sin enlace. */
export function deliveryText(t: TFunction, lang: string, deliverAt: string | null | undefined, queued = false): string {
  if (queued || !deliverAt) return t('triage.delivery.noLink');
  return new Date(deliverAt).getTime() > Date.now()
    ? t('triage.delivery.inTransit', { time: hhmm(deliverAt, lang) })
    : t('triage.delivery.delivered', { time: hhmm(deliverAt, lang) });
}

export function DeliveryLine({ text, pending }: { text: string; pending: boolean }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.row}>
      <Ionicons name={pending ? 'cloud-offline-outline' : 'planet-outline'} size={14} color={pending ? colors.status.caution.solid : colors.textMuted} />
      <AppText variant="caption" color="textMuted" style={styles.flex}>{text}</AppText>
    </View>
  );
}

/** Permiso de micrófono: se pide una vez al entrar al triaje. Si lo niegan, solo botones. */
const useMicStore = create<{ permission: MicPermission | null; asked: boolean; set: (p: MicPermission) => void; markAsked: () => void }>((set) => ({
  permission: null,
  asked: false,
  set: (permission) => set({ permission }),
  markAsked: () => set({ asked: true }),
}));

export function useMicPermission(): MicPermission | null {
  const permission = useMicStore((s) => s.permission);
  useEffect(() => {
    const store = useMicStore.getState();
    if (store.asked) return;
    store.markAsked();
    void requestMicPermission().then((p) => useMicStore.getState().set(p));
  }, []);
  return permission;
}

/** Estado de la sesión de triaje: se recarga al enfocar la pantalla y cuando la sincronización trae cambios. */
export function useTriageSession(ref: string | undefined) {
  const [view, setView] = useState<TriageSessionView | null>(null);
  const [loading, setLoading] = useState(true);
  const syncVersion = useSyncStore((s) => s.version);
  const seq = useRef(0);

  // Dos fases: primero lo del dispositivo (instantáneo, también sin enlace) y luego el servidor si responde.
  // Solo cuenta la recarga más reciente (focus y sync pueden llegar juntos).
  const reload = useCallback(() => {
    if (!ref) return Promise.resolve();
    const my = ++seq.current;
    const show = (v: TriageSessionView | null) => {
      if (my !== seq.current) return;
      if (v) setView(v);
      setLoading(false);
    };
    return container.getTriageSession
      .execute(ref, { remote: false })
      .then(show)
      .then(() => container.getTriageSession.execute(ref, { remote: true }))
      .then(show, () => show(null));
  }, [ref]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );
  useEffect(() => {
    void reload();
  }, [reload, syncVersion]);

  return { view, loading, reload };
}

/** Latido cada ~30 s mientras la pantalla está enfocada y la sesión activa (guía §10: 120 s sin latido avisa a Tierra). */
export function useTriageHeartbeat(view: TriageSessionView | null) {
  const ref = view?.session.ref;
  const active = !!view && !view.session.demo && !['closed', 'cancelled'].includes(view.session.status);
  useFocusEffect(
    useCallback(() => {
      if (!ref || !active) return;
      void container.sendHeartbeat.execute(ref);
      const timer = setInterval(() => void container.sendHeartbeat.execute(ref), 30_000);
      return () => clearInterval(timer);
    }, [ref, active]),
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, alignSelf: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  flex: { flex: 1 },
});
