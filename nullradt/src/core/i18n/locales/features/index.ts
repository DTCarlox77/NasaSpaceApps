/**
 * Textos de las funcionalidades nuevas, separados por módulo para no inflar es.json / en.json.
 * Cada módulo aporta claves de primer nivel propias (no pisa las existentes).
 */
import accessEn from './access.en.json';
import accessEs from './access.es.json';
import coreEn from './core.en.json';
import coreEs from './core.es.json';
import wellbeingEn from './wellbeing.en.json';
import wellbeingEs from './wellbeing.es.json';
import voiceEn from './voice.en.json';
import voiceEs from './voice.es.json';

export const featuresEs = { ...coreEs, ...accessEs, ...wellbeingEs, ...voiceEs };
export const featuresEn = { ...coreEn, ...accessEn, ...wellbeingEn, ...voiceEn };
