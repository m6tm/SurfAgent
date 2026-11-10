/**
 * Agent routeur : determine si le message de l'utilisateur relève
 * d'une conversation simple (reponse directe) ou du mode agent
 * (action avec outils). Decision prioritaire via Laya (choix typé),
 * fallback LLM JSON si Laya est absent/injoignable.
 */
import type { RoutingDecision } from './state'
import { codexComplete } from './codexApi'
import { layaPredict } from './laya'

const ROUTER_INSTRUCTIONS = `Tu es un routeur. Analyse le message de l'utilisateur et reponds UNIQUEMENT avec un objet JSON valide, sans texte autour :
{"mode": "chat" | "agent", "confidence": <nombre entre 0 et 1>, "reason": "<justification courte>"}

- "agent" si le message demande une ACTION : recherche web, navigation/scraping d'autres pages, sauvegarde en memoire, planification multi-etapes, ou toute tache necessitant des outils.
- "chat" pour une question, une explication, une discussion, un resume ou une reformulation repondable directement.`

/** Decision via le serveur Laya (choice + noul en une passe). */
async function routeWithLaya(question: string, pageTitle: string | null): Promise<RoutingDecision | null> {
  try {
    const result = await layaPredict(
      { body: question, page_title: pageTitle ?? '' },
      {
        mode: {
          type: 'choice',
          instructions:
            "Quel mode doit traiter ce message ? 'conversation_simple' pour questionner/discuter, 'mode_agent' si le message demande une action avec des outils (recherche web, navigation, sauvegarde memoire, plan multi-etapes).",
          criteria: {
            conversation_simple: 'question, explication, discussion, resume, reformulation',
            mode_agent: 'action, recherche, navigation, scraping, sauvegarde, planification multi-etapes',
          },
        },
        needs_tools: {
          type: 'noul',
          instructions:
            "Ce message requiert-il l'usage d'outils (web, navigation, memoire) pour etre traite correctement ?",
        },
      },
    )

    const mode = result.mode
    const needsTools = result.needs_tools
    if (typeof mode !== 'string') return null

    const isAgent = mode.includes('agent') || (typeof needsTools === 'number' && needsTools >= 0.5)
    const confidence =
      typeof needsTools === 'number'
        ? isAgent
          ? Math.min(0.99, Math.max(0.5, needsTools))
          : Math.min(0.99, Math.max(0.5, 1 - needsTools))
        : 0.7
    return {
      source: 'laya',
      mode: isAgent ? 'agent' : 'chat',
      confidence,
      reason: `Laya: mode=${mode}${typeof needsTools === 'number' ? ` needs_tools=${needsTools.toFixed(2)}` : ''}`,
    }
  } catch {
    return null // Laya absent/injoignable -> fallback LLM.
  }
}

/** Fallback : decision par le modele de chat (JSON structure). */
async function routeWithLlm(question: string): Promise<RoutingDecision> {
  const raw = await codexComplete(
    `Message de l'utilisateur :\n"""${question.slice(0, 1500)}"""`,
    ROUTER_INSTRUCTIONS,
  )

  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { mode?: unknown; confidence?: unknown; reason?: unknown }
      const mode = parsed.mode === 'agent' ? 'agent' : 'chat'
      const confidence =
        typeof parsed.confidence === 'number' && parsed.confidence >= 0 && parsed.confidence <= 1
          ? parsed.confidence
          : 0.7
      const reason = typeof parsed.reason === 'string' ? parsed.reason.slice(0, 200) : 'Decision LLM.'
      return { source: 'llm', mode, confidence, reason }
    } catch {
      // JSON invalide : on continue sur le defaut prudent.
    }
  }
  // Defaut prudent : conversation simple.
  return { source: 'llm', mode: 'chat', confidence: 0.5, reason: 'Parsing impossible, defaut chat.' }
}

/** Point d'entree du routeur. */
export async function routeMessage(question: string, pageTitle: string | null): Promise<RoutingDecision> {
  const layaDecision = await routeWithLaya(question, pageTitle)
  if (layaDecision) return layaDecision
  return routeWithLlm(question)
}
