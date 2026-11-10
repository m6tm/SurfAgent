/**
 * Outils de l'agent (mode "agent"). Le backend Chat Completions ne supporte
 * pas le function-calling natif ici, donc les outils sont declares au LLM
 * (descriptif texte) et appeles via un plan JSON dans `graph.ts`.
 */
import { tool } from '@langchain/core/tools'
import { z } from 'zod'

import type { TodoItem } from './state'
import { ingestMemory } from './rag/ingest'
import { RagStore } from './rag/store'
import { LocalHashEmbeddings } from './rag/embeddings'

/** Resultat normalise d'un appel d'outil. */
export interface ToolResult {
  tool: string
  ok: boolean
  output: string
}

// ---------------------------------------------------------------------------
// Store partage (ouverture paresseuse : une seule instance IndexedDB).
// ---------------------------------------------------------------------------

let storePromise: Promise<RagStore> | null = null

function getStore(): Promise<RagStore> {
  storePromise ??= RagStore.create(new LocalHashEmbeddings())
  return storePromise
}

/** Passe les todos a jour au graphe (ecrit dans l'etat du graphe). */
export function applyTodos(
  todos: Array<{ id?: unknown; label?: unknown; status?: unknown }>,
): TodoItem[] {
  return todos.slice(0, 20).map((todo, index) => ({
    id: typeof todo.id === 'string' && todo.id.trim() ? todo.id : `todo-${index + 1}`,
    label: typeof todo.label === 'string' ? todo.label.slice(0, 200) : '',
    status: todo.status === 'in_progress' || todo.status === 'done' ? todo.status : 'pending',
  }))
}

// ---------------------------------------------------------------------------
// Outils exposes au modele
// ---------------------------------------------------------------------------

const searchMemoryTool = tool(
  async ({ query }) => {
    const store = await getStore()
    const docs = await store.similaritySearch(query, 4)
    if (docs.length === 0) return 'Aucun souvenir pertinent.'
    return docs
      .map((doc, i) => `${i + 1}. ${doc.pageContent} (${JSON.stringify(doc.metadata)})`)
      .join('\n')
  },
  {
    name: 'search_memory',
    description:
      'Recherche dans la memoire vectorielle (pages ingerees, conversations passees, notes sauvegardees). A utiliser quand la question a besoin de contexte sauvegarde.',
    schema: z.object({ query: z.string().describe('Recherche en langage naturel') }),
  },
)

const saveMemoryTool = tool(
  async ({ note }) => {
    const store = await getStore()
    const added = await ingestMemory(store, note)
    return added > 0 ? 'Note sauvegardee en memoire.' : 'Note vide, rien sauvegarde.'
  },
  {
    name: 'save_memory',
    description: 'Sauvegarde une information importante en memoire pour les tours futurs.',
    schema: z.object({
      note: z.string().describe('Information formulee comme une fiche autonome'),
    }),
  },
)

const fetchWebTool = tool(
  async ({ url }) => {
    if (!/^https?:\/\//.test(url)) return 'URL invalide.'
    const res = await fetch(url, { headers: { accept: 'text/html' } })
    if (!res.ok) return `Erreur HTTP ${res.status} sur ${url}`
    const html = await res.text()
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    return `Contenu de ${url} (extrait) :\n${text.slice(0, 6000)}`
  },
  {
    name: 'fetch_web',
    description: "Recupere le contenu texte d'une page web publique par son URL.",
    schema: z.object({ url: z.string().url().describe('URL http(s) complete') }),
  },
)

export const agentTools = [searchMemoryTool, saveMemoryTool, fetchWebTool] as const
export type AgentToolName = Exclude<(typeof agentTools)[number]['name'], undefined>

/** Schema des arguments d'un outil, en JSON compact (affiche au modele). */
function toolArgsSchema(t: (typeof agentTools)[number]): string {
  const schema = z.toJSONSchema(t.schema)
  const props = (schema.properties ?? {}) as Record<string, { type?: string; description?: string }>
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(props).map(([key, prop]) => [
        key,
        { type: prop.type ?? 'string', description: prop.description },
      ]),
    ),
  )
}

/** Liste des outils formatee pour le prompt d'agent. */
export function describeTools(): string {
  return agentTools.map((t) => `- ${t.name} : ${t.description} Args: ${toolArgsSchema(t)}`).join('\n')
}

/** Registre explicite pour l'execution par le graphe (protege des fautes de frappe). */
export const toolRegistry: Record<AgentToolName, (args: Record<string, unknown>) => Promise<string>> =
  {
    search_memory: (args) => searchMemoryTool.invoke(args as never).then(String),
    save_memory: (args) => saveMemoryTool.invoke(args as never).then(String),
    fetch_web: (args) => fetchWebTool.invoke(args as never).then(String),
  }
