/**
 * Etat partage du graphe d'agents (LangGraph).
 * Chaque noeud lit/écrit dans cet objet via des reducers.
 */
import { Annotation, MessagesAnnotation } from '@langchain/langgraph'
import type { PageContext } from '../shared/types'

/** Decision produite par l'agent routeur (Laya ou fallback LLM). */
export interface RoutingDecision {
  /** 'laya' si decide par Laya, 'llm' si fallback modele. */
  source: 'laya' | 'llm'
  /** Mode choisi pour ce tour. */
  mode: 'chat' | 'agent'
  /** Probabilite/confiance rapportee par le decideur (0..1). */
  confidence: number
  /** Justification courte (utile au debug/UI). */
  reason: string
}

/** Element du plan d'action affiche en live dans l'UI. */
export interface TodoItem {
  id: string
  label: string
  status: 'pending' | 'in_progress' | 'done'
}

/** Document retrievable depuis la base vectorielle. */
export interface RetrievedDoc {
  content: string
  source: { kind: 'page' | 'conversation' | 'memory'; url?: string; title?: string }
  score: number
}

export const AgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  /** Contexte de la page ouverte au moment de la question. */
  pageContext: Annotation<PageContext | null>({
    reducer: (_prev, next) => next ?? _prev,
    default: () => null,
  }),
  /** Tour courant : question brute de l'utilisateur. */
  question: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  /** Resultat de l'agent routeur. */
  routing: Annotation<RoutingDecision | null>({
    reducer: (_prev, next) => next ?? _prev,
    default: () => null,
  }),
  /** Documents RAG recuperes pour ce tour. */
  retrievedDocs: Annotation<RetrievedDoc[]>({
    reducer: (_prev, next) => next ?? [],
    default: () => [],
  }),
  /** Plan d'action du mode agent (mis a jour par l'outil todoPlanner). */
  todos: Annotation<TodoItem[]>({
    reducer: (_prev, next) => next ?? [],
    default: () => [],
  }),
  /** Reponse finale produite par le graphe. */
  finalAnswer: Annotation<string | null>({
    reducer: (_prev, next) => next ?? _prev,
    default: () => null,
  }),
  /** Erreur non fatale a signaler dans la reponse finale. */
  warning: Annotation<string | null>({
    reducer: (_prev, next) => next ?? _prev,
    default: () => null,
  }),
})

export type AgentStateType = typeof AgentState.State
