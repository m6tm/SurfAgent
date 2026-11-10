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
 * Interroge le serveur Laya (protocole Jev /v1/systemone). Rejette si non
 * configure ou injoignable, pour que l'appelant bascule sur son fallback.
 * Retourne une carte plate : choice -> libelle choisi, noul -> P(vrai),
 * les autres champs (probabilites, confidence) sont exposes en <qid>.<champ>.
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
    const res = await fetch(`${endpoint.replace(/\/$/, '')}/v1/systemone`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state, questions }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`Laya HTTP ${res.status}`)
    const raw = (await res.json()) as {
      answers?: Record<string, Record<string, unknown>>
    }
    return flattenAnswers(raw.answers ?? {})
  } finally {
    clearTimeout(timer)
  }
}

/** Aplatit les reponses Jev en valeurs directement exploitables. */
function flattenAnswers(answers: Record<string, Record<string, unknown>>): LayaResult {
  const out: LayaResult = {}
  for (const [qid, answer] of Object.entries(answers)) {
    if (typeof answer.choice === 'string') out[qid] = answer.choice
    if (typeof answer.noul === 'number') out[qid] = answer.noul
    if (typeof answer.score === 'number') out[qid] = answer.score
    if (typeof answer.confidence === 'number') out[`${qid}.confidence`] = answer.confidence
    if (answer.probabilities && typeof answer.probabilities === 'object') {
      for (const [label, prob] of Object.entries(answer.probabilities as Record<string, unknown>)) {
        if (typeof prob === 'number') out[`${qid}.${label}`] = prob
      }
    }
  }
  return out
}
