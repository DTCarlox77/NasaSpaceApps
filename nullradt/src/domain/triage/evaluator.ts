import protocolV1 from './protocol.v1.json';

/**
 * EVALUADOR DE TRIAJE (función pura, sin React ni red).
 * El mismo archivo corre en la tableta y en el servidor a bordo: dado el protocolo versionado y las respuestas,
 * devuelve la categoría START, la siguiente pregunta y el estado del módulo de radiación.
 * Sin LLM ni servicios externos en la ruta crítica.
 */

export type TriageCategory = 'immediate' | 'delayed' | 'minor' | 'expectant';
export type RadiationLevel = 'none' | 'exposed' | 'high';
type Lang = 'es' | 'en';
type Localized = Record<Lang, string>;

export interface ProtocolNode {
  observable: boolean;
  q: Localized;
  yes: string;
  no: string;
  sets?: { yes?: { responsive?: boolean }; no?: { responsive?: boolean } };
  /** Si el tripulante no responde, esta pregunta se contesta sola con este valor. */
  autoIfUnresponsive?: boolean;
}

export interface TriageProtocol {
  id: string;
  version: string;
  updated: string;
  status: string;
  description: Localized;
  sources: { id: string; title: string; url: string }[];
  adaptations: Record<Lang, string[]>;
  start: string;
  categories: Record<TriageCategory, { priority: number; tone: string; label: Localized }>;
  nodes: Record<string, ProtocolNode>;
  radiation: { start: string; nodes: Record<string, ProtocolNode> };
  actions: Record<TriageCategory | 'radiationHigh', Record<Lang, string[]>>;
  outOfProtocol: Localized;
}

export const PROTOCOL = protocolV1 as unknown as TriageProtocol;

export type Answers = Record<string, boolean>;

export interface TriageEvaluation {
  /** Categoría START final (ya ajustada por radiación). null = faltan respuestas. */
  category: TriageCategory | null;
  /** Categoría antes del ajuste por radiación. */
  baseCategory: TriageCategory | null;
  radiation: RadiationLevel;
  /** Siguiente pregunta a hacer (núcleo o módulo de radiación). null = triaje completo. */
  next: { module: 'core' | 'radiation'; id: string; node: ProtocolNode } | null;
  /** Recorrido seguido (para el reporte a Tierra). */
  path: { id: string; answer: boolean; auto: boolean }[];
  responsive: boolean;
  complete: boolean;
  priority: number;
}

const UPGRADE: Record<TriageCategory, TriageCategory> = { minor: 'delayed', delayed: 'immediate', immediate: 'immediate', expectant: 'expectant' };

export function evaluateTriage(answers: Answers, protocol: TriageProtocol = PROTOCOL): TriageEvaluation {
  const path: TriageEvaluation['path'] = [];
  let responsive = true;
  let base: TriageCategory | null = null;
  let next: TriageEvaluation['next'] = null;

  // 1) Núcleo START.
  let id: string | undefined = protocol.start;
  for (let guard = 0; id && guard < 50; guard++) {
    if (id.startsWith('cat:')) {
      base = id.slice(4) as TriageCategory;
      break;
    }
    const node: ProtocolNode | undefined = protocol.nodes[id];
    if (!node) break;
    let answer: boolean | undefined = answers[id];
    let auto = false;
    if (answer === undefined && !responsive && node.autoIfUnresponsive !== undefined) {
      answer = node.autoIfUnresponsive;
      auto = true;
    }
    if (answer === undefined) {
      next = { module: 'core', id, node };
      break;
    }
    path.push({ id, answer, auto });
    const sets = answer ? node.sets?.yes : node.sets?.no;
    if (sets?.responsive === false) responsive = false;
    id = answer ? node.yes : node.no;
  }

  // 2) Módulo de radiación (solo cuando el núcleo terminó).
  let radiation: RadiationLevel = 'none';
  if (base && !next) {
    let rid: string | undefined = protocol.radiation.start;
    for (let guard = 0; rid && guard < 20; guard++) {
      if (rid.startsWith('end')) {
        const lvl = rid.split(':')[1];
        radiation = lvl === 'high' ? 'high' : lvl === 'exposed' ? 'exposed' : 'none';
        break;
      }
      const node: ProtocolNode | undefined = protocol.radiation.nodes[rid];
      if (!node) break;
      const answer: boolean | undefined = answers[rid];
      if (answer === undefined) {
        next = { module: 'radiation', id: rid, node };
        break;
      }
      path.push({ id: rid, answer, auto: false });
      rid = answer ? node.yes : node.no;
    }
  }

  const category = base && !next ? (radiation === 'high' ? UPGRADE[base] : base) : null;
  return {
    category,
    baseCategory: base,
    radiation,
    next,
    path,
    responsive,
    complete: !!category,
    priority: category ? protocol.categories[category].priority : 99,
  };
}

/** Texto de la pregunta (núcleo o radiación) en el idioma pedido. */
export const questionText = (id: string, lang: Lang, protocol: TriageProtocol = PROTOCOL) =>
  (protocol.nodes[id] ?? protocol.radiation.nodes[id])?.q[lang] ?? id;
