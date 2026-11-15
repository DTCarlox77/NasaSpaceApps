/**
 * Compatibilidad: el motor de reglas vive ahora en `domain/rules/ruleEngine.ts`
 * (NEWS2 / AHA / referencia / línea base personal + escalamiento con persistencia).
 */
export { evaluateIndicator as evaluateMeasurement, type RuleResult as Evaluation } from '../rules/ruleEngine';
