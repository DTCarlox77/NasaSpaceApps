/**
 * Textos de las funcionalidades nuevas, separados por módulo para no inflar es.json / en.json.
 * Cada módulo aporta claves de primer nivel propias (no pisa las existentes).
 */
import accessEn from './access.en.json';
import accessEs from './access.es.json';
import coreEn from './core.en.json';
import coreEs from './core.es.json';
import triageEn from './triage.en.json';
import triageEs from './triage.es.json';
import wellbeingEn from './wellbeing.en.json';
import wellbeingEs from './wellbeing.es.json';
import voiceEn from './voice.en.json';
import voiceEs from './voice.es.json';

export const featuresEs = { ...coreEs, ...triageEs, ...accessEs, ...wellbeingEs, ...voiceEs };
export const featuresEn = { ...coreEn, ...triageEn, ...accessEn, ...wellbeingEn, ...voiceEn };
