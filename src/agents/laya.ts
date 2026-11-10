/**
 * Client Laya AI (modele de decision System 1, open-source).
 *
 * Laya repond en une seule passe avec des sorties typées :
 * - choice : choisir une option nommee (+ probabilites)
 * - score  : placer une entree sur une echelle ordonnee
 * - noul   : P(proposition vraie)
 *
 * Le serveur Laya est auto-heberge (serveur HTTP compatible Jev). Son URL
 * est configuree dans la page options (chrome.storage.local). En son absence,
 * chaque decision bascule sur un fallback LLM (JSON structure) via le backend
 * Codex — le systeme reste fonctionnel sans Laya installe.
 */
import { chromeStorageGet } from './chromeStorage'

export const LAYA_ENDPOINT_KEY = 'laya:endpoint'
const LAYA_TIMEOUT_MS = 5000

/** Question typée soumise a Laya. */
export type LayaQuestion =
  | {
      type: 'choice'
      instructions: string
      criteria: Record<string, string>
    }
  | {
      type: 'score'
      instructions: string
      criteria: Record<string, string>
    }
  | {
      type: 'noul'
      instructions: string
    }

/** Reponse d'une question, indexee par nom de question. */
export type LayaResult = Record<string, string | number>

export async function getLayaEndpoint(): Promise<string | null> {
  const value = await chromeStorageGet(LAYA_ENDPOINT_KEY)
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export async function setLayaEndpoint(endpoint: string): Promise<void> {
  await chrome.storage.local.set({ [LAYA_ENDPOINT_KEY]: endpoint.trim() })
}

/**
 * Interroge le serveur Laya. Rejette si non configure ou injoignable,
 * pour que l'appelant bascule sur son fallback.
 */
export async function layaPredict(
  state: Record<string, unknown>,
  questions: Record<string, LayaQuestion>,
): Promise<LayaResult> {
  const endpoint = await getLayaEndpoint()
  if (!endpoint) throw new Error('Serveur Laya non configure.')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LAYA_TIMEOUT_MS)
  try {
    const res = await fetch(`${endpoint.replace(/\/$/, '')}/predict`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state, questions }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`Laya HTTP ${res.status}`)
    return (await res.json()) as LayaResult
  } finally {
    clearTimeout(timer)
  }
}
