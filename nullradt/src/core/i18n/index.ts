import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import en from './locales/en.json';
import es from './locales/es.json';
import { featuresEn, featuresEs } from './locales/features';

export const supportedLanguages = ['es', 'en'] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

export const resources = {
  // Las funcionalidades nuevas viven en archivos propios (locales/features) y se fusionan aquí.
  es: { translation: { ...es, ...featuresEs } },
  en: { translation: { ...en, ...featuresEn } },
} as const;

/** Idioma del dispositivo si está soportado; si no, inglés. */
export function getDeviceLanguage(): SupportedLanguage {
  const code = getLocales()[0]?.languageCode ?? 'en';
  return (supportedLanguages as readonly string[]).includes(code) ? (code as SupportedLanguage) : 'en';
}

i18n.use(initReactI18next).init({
  resources,
  lng: getDeviceLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
