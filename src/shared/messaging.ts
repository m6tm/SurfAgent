import type { RuntimeMessage, RuntimeResponse } from './types'

function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController()
  setTimeout(() => controller.abort(), ms)
  return controller.signal
}

/** Envoie un message au service worker (background) et attend la reponse. */
export function sendToBackground<T>(message: RuntimeMessage): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
        reject(
          new Error(
            'Connexion a l\'extension perdue. Recharge la page (F5) apres avoir recharge l\'extension.',
          ),
        )
        return
      }
      chrome.runtime.sendMessage(message, (res: RuntimeResponse<T> | undefined) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }
        if (!res) {
          reject(new Error('Aucune reponse du background.'))
          return
        }
        if (res.ok) resolve(res.data)
        else reject(new Error(res.error))
      })
    } catch (err) {
      reject(err as Error)
    }
  })
}

/**
 * Envoie un message vers une tab (content script) via chrome.tabs.
 * Ajoute un timeout manuel car tabs.sendMessage ne fournit pas de signal.
 */
export function sendToTab<T>(
  tabId: number,
  message: RuntimeMessage,
  timeoutMs = 10_000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Delai depasse (contenu de page injoignable).'))
    }, timeoutMs)

    chrome.tabs.sendMessage(tabId, message, (res: RuntimeResponse<T> | undefined) => {
      clearTimeout(timer)
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      if (!res) {
        reject(new Error('Aucune reponse du content script.'))
        return
      }
      if (res.ok) resolve(res.data)
      else reject(new Error(res.error))
    })
  })
}

/** Fetch avec gestion d'erreur normalisee (JSON requis). */
export async function safeFetchJson<T>(
  url: string,
  init: RequestInit,
  timeoutMs = 90_000,
): Promise<T> {
  const res = await fetch(url, { ...init, signal: timeoutSignal(timeoutMs) })
  const text = await res.text()
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = JSON.parse(text) as { error?: { message?: string }; message?: string }
      detail = body?.error?.message ?? body?.message ?? detail
    } catch {
      if (text) detail = text.slice(0, 300)
    }
    throw new Error(detail)
  }
  return JSON.parse(text) as T
}

/** POST JSON simple. */
export function postJson<T>(
  url: string,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
  timeoutMs = 60_000,
): Promise<T> {
  return safeFetchJson<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  }, timeoutMs)
}

/** POST form-urlencoded simple (endpoints OAuth). */
export function postForm<T>(
  url: string,
  params: Record<string, string>,
  timeoutMs = 60_000,
): Promise<T> {
  return safeFetchJson<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  }, timeoutMs)
}