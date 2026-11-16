import { useEffect } from 'react';
import i18n, { getDeviceLanguage } from '@/core/i18n';
import { useSettingsStore } from '@/presentation/store/settingsStore';

/** Mantiene i18next sincronizado con la preferencia de idioma guardada. */
export function useLanguageSync() {
  const preference = useSettingsStore((s) => s.languagePreference);
  useEffect(() => {
    const lng = preference === 'system' ? getDeviceLanguage() : preference;
    if (i18n.language !== lng) i18n.changeLanguage(lng);
  }, [preference]);
}
