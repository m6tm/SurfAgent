/**
 * Graphe orchestrateur (LangGraph) : routeur -> (retrieval | direct) ->
 * chat / agent -> reponse finale. Les outils ne passant pas par le
 * function-calling natif, le noeud agent planifie via JSON structure puis
 * execute les outils, puis synthetise.
 */
import { StateGraph, Annotation, START, END } from '@langchain/langgraph'

import type { PageContext } from '../shared/types'
import { AgentState, type RetrievedDoc, type TodoItem } from './state'
import { routeMessage } from './router'
import { codexComplete } from './codexApi'
import { applyTodos, describeTools, toolRegistry, type ToolResult } from './tools'

import { RagStore } from './rag/store'
import { LocalHashEmbeddings } from './rag/embeddings'

/** Etat interne du graphe, etendu avec l'execution des outils. */
const OrchestratorState = Annotation.Root({
  ...AgentState.spec,
  toolResults: Annotation<ToolResult[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
})
export type OrchestratorStateType = typeof OrchestratorState.State

const MAX_TOOL_CALLS = 5

// ---------------------------------------------------------------------------
// Noeuds
// ---------------------------------------------------------------------------

/** Noeud 1 : routeur (Laya prioritaire, fallback LLM). */
async function routeNode(state: OrchestratorStateType): Promise<Partial<OrchestratorStateType>> {
  const routing = await routeMessage(state.question, state.pageContext?.title ?? null)
  return { routing, warning: routing.confidence < 0.5 ? `Routing peu confiant : ${routing.reason}` : null }
}

/** Noeud 2 : retrieval RAG sur la memoire vectorielle si on a un store non vide. */
async function retrieveNode(state: OrchestratorStateType): Promise<Partial<OrchestratorStateType>> {
  try {
    const store = await RagStore.create(new LocalHashEmbeddings())
    if ((await store.count()) === 0) return { retrievedDocs: [] }
    const docs = await store.similaritySearch(state.question, 4)
    return {
      retrievedDocs: docs
        .map((d): RetrievedDoc => ({
          content: d.pageContent,
          source: {
            kind: d.metadata.kind === 'conversation' || d.metadata.kind === 'memory' ? d.metadata.kind : 'page',
            url: typeof d.metadata.url === 'string' ? d.metadata.url : undefined,
            title: typeof d.metadata.title === 'string' ? d.metadata.title : undefined,
          },
          score: typeof d.metadata.score === 'number' ? d.metadata.score : 0,
        })),
    }
  } catch {
    // IndexedDB indisponible ou vide : pas de retrieval, a ne pas propager.
    return { retrievedDocs: [], warning: null }
  }
}

/** Noeud 3 (mode chat) : reponse directe au modele avec contexte RAG + page. */
async function chatNode(state: OrchestratorStateType): Promise<Partial<OrchestratorStateType>> {
  const context = formatContext(state)
  const answer = await codexComplete(
    buildUserPrompt(state.question, context),
    'Tu es un assistant percutant integre dans une panel de page web. Reponds de facon concise, en francais, en Markdown.',
  )
  return { finalAnswer: answer }
}

/** Noeud 3bis (mode agent) : plan JSON -> execution des outils -> synthese. */
async function agentNode(state: OrchestratorStateType): Promise<Partial<OrchestratorStateType>> {
  const toolList = describeTools()
  const context = formatContext(state)

  // 1. Planification et selection d'outils en JSON structure.
  const planRaw = await codexComplete(
    buildAgentPlanningPrompt(state.question, context, toolList),
    `Tu es un agent. Reponds UNIQUEMENT avec un JSON valide, sans texte autour :
{
  "todos": [{"label": "...", "status": "pending"}],            // 1-6 etapes du plan
  "tool_calls": [{"tool": "<nom>", "args": {<args du schema>}}] // 0-${MAX_TOOL_CALLS} appels
}`,
  )

  const plan = parseJsonBlock<{
    todos?: Array<{ id?: unknown; label?: unknown; status?: unknown }>
    tool_calls?: Array<{ tool?: unknown; args?: unknown }>
  }>(planRaw)

  let todos: TodoItem[] = []
  const results: ToolResult[] = []

  if (plan) {
    todos = applyTodos(plan.todos ?? [])

    // 2. Execution sequentielle des outils (borne).
    const calls = (plan.tool_calls ?? []).slice(0, MAX_TOOL_CALLS)
    for (const call of calls) {
      const name = typeof call.tool === 'string' ? (call.tool as keyof typeof toolRegistry) : null
      const fn = name ? toolRegistry[name] : undefined
      if (!fn) {
        results.push({ tool: String(call.tool ?? '?'), ok: false, output: 'Outil inconnu.' })
        continue
      }
      try {
        const output = await fn((call.args as Record<string, unknown>) ?? {})
        results.push({ tool: name as string, ok: true, output: output.slice(0, 4000) })
      } catch (err) {
        results.push({
          tool: name as string,
          ok: false,
          output: err instanceof Error ? err.message : String(err),
        })
      }
    }
    todos = todos.map((todo, i) =>
      todo.status === 'pending' && results[i]?.ok === true ? { ...todo, status: 'done' } : todo,
    )
  } else {
    // Plan non parsable : tenter la reponse directe, signaler la degradation.
    return {
      todos: [],
      toolResults: [],
      warning: 'Agent : plan JSON non parsable, reponse en mode chat.',
      ...(await chatNode({ ...state, routing: { source: 'llm', mode: 'chat', confidence: 0.5, reason: 'plan parse failed' } })),
    }
  }

  // 3. Synthese finale avec les resultats d'outils.
  const answer = await codexComplete(
    buildUserPrompt(state.question, context) +
      `${results.length === 0 ? '' : `\n\nResultats d'outils :\n${results.map((r) => `[${r.tool}] ${r.output}`).join('\n')}`}`,
    'Tu es un agent qui execute des actions. Redige la reponse finale en francais, en Markdown, en t appuyant sur les resultats des outils.',
  )
  return { todos, toolResults: results, finalAnswer: answer }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatContext(state: OrchestratorStateType): string {
  const parts: string[] = []
  if (state.pageContext) {
    parts.push(
      `Page active : ${state.pageContext.title ?? 'sans titre'}${state.pageContext.url ? ` (${state.pageContext.url})` : ''}\nContenu:\n${state.pageContext.text.slice(0, 2000)}`,
    )
  }
  if (state.retrievedDocs.length > 0) {
    parts.push(
      `Souvenirs pertinents :\n${state.retrievedDocs.map((d) => `- ${d.content}`).join('\n')}`,
    )
  }
  return parts.join('\n\n')
}

function buildUserPrompt(question: string, context: string): string {
  return `${context ? `Contexte :\n${context}\n\n` : ''}Question : ${question}`
}

function buildAgentPlanningPrompt(question: string, context: string, toolList: string): string {
  return `${context ? `Contexte :\n${context}\n\n` : ''}Question de l'utilisateur : ${question}

Outils disponibles :
${toolList}

Planifie les etapes puis choisis les outils a appeler (avec leurs arguments selon le schema). Reponds UNIQUEMENT avec le JSON.`
}

function parseJsonBlock<T>(raw: string): T | null {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    return JSON.parse(match[0]) as T
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Construction du graphe
// ---------------------------------------------------------------------------

function buildGraph() {
  const graph = new StateGraph(OrchestratorState)
    .addNode('route', routeNode)
    .addNode('retrieve', retrieveNode)
    .addNode('chat', chatNode)
    .addNode('agent', agentNode)
    .addEdge(START, 'route')
    .addEdge('route', 'retrieve')
    .addConditionalEdges('retrieve', (state: OrchestratorStateType) => (state.routing?.mode === 'agent' ? 'agent' : 'chat'), {
      chat: 'chat',
      agent: 'agent',
    })
    .addEdge('chat', END)
    .addEdge('agent', END)
  return graph.compile()
}

export type AgentGraph = ReturnType<typeof buildGraph>

let graphPromise: Promise<AgentGraph> | null = null

/** Graphe singleton compile (les compilations coutent cher). */
export function getAgentGraph(): Promise<AgentGraph> {
  graphPromise ??= Promise.resolve(buildGraph())
  return graphPromise
}

/** D'un coup : pose la question + contexte de page, recupere la reponse finale. */
export async function runAgentTurn(
  question: string,
  pageContext: PageContext | null,
): Promise<Partial<OrchestratorStateType>> {
  const graph = await getAgentGraph()
  const config = { recursionLimit: 10 } as const
  return graph.invoke({ question, pageContext }, config) as Promise<OrchestratorStateType>
}
