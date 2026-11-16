import 'i18next';
import type es from './locales/es.json';
import type { featuresEs } from './locales/features';

// Autocompletado y verificación de claves de traducción en `t('...')`.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof es & typeof featuresEs };
  }
}
