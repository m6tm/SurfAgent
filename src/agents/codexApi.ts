/**
 * Acces bas niveau au backend Codex (compte ChatGPT).
 * Extrait de background/openai.ts pour etre reutilise par l'adaptateur
 * LangChain (codexChatModel.ts) sans dependance circulaire.
 */
import { OPENAI_CONFIG, STORAGE_KEYS } from '../shared/config'
import { getAccessToken, getAccountId } from '../background/auth'

const MODELS_CACHE_TTL_MS = 60 * 60 * 1000
/** Fallback si le catalogue du compte est indisponible. */
const FALLBACK_MODEL = 'gpt-5-codex'

export async function codexHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken()
  const accountId = await getAccountId()
  if (!token) throw new Error('Non connecte. Connecte-toi avec ChatGPT depuis le popup.')
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    'openai-beta': 'responses=experimental',
  }
  if (accountId) headers['chatgpt-account-id'] = accountId
  return headers
}

/** Lit un flux SSE Responses API et reconstruit le texte de la reponse. */
export async function readSseResponse(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''
  const dispatchEvent = (evt: Record<string, unknown>) => {
    const type = evt.type
    if (type === 'response.output_text.delta') {
      const delta = evt.delta
      if (typeof delta === 'string') fullText += delta
      return
    }
    if (type === 'response.output_item.done') {
      const item = evt.item as Record<string, unknown> | undefined
      if (item && item.type === 'thought') return
      const content = Array.isArray(item?.content) ? item.content : []
      for (const c of content) {
        if (!c || typeof c !== 'object') continue
        const cc = c as Record<string, unknown>
        if (cc.type === 'thought') continue
        if (typeof cc.text === 'string' && !fullText) fullText = cc.text
      }
    }
    if (type === 'response.completed') {
      const response = evt.response as Record<string, unknown> | undefined
      const output = Array.isArray(response?.output) ? response.output : []
      for (const item of output) {
        if (!item || typeof item !== 'object') continue
        const it = item as Record<string, unknown>
        if (it.type === 'thought') continue
        const content = Array.isArray(it.content) ? it.content : []
        for (const c of content) {
          if (!c || typeof c !== 'object') continue
          const cc = c as Record<string, unknown>
          if (cc.type === 'thought') continue
          if (typeof cc.text === 'string') {
            if (!fullText) fullText = cc.text
          }
        }
      }
    }
  }
  return new Promise((resolve, reject) => {
    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let idx = buffer.indexOf('\n\n')
          while (idx >= 0) {
            const chunk = buffer.slice(0, idx)
            buffer = buffer.slice(idx + 2)
            const lines = chunk.split('\n')
            for (const line of lines) {
              if (!line.startsWith('data:')) continue
              const dataLine = line.slice(5).trim()
              if (!dataLine) continue
              if (dataLine === '[DONE]') continue
              let evt: Record<string, unknown>
              try {
                evt = JSON.parse(dataLine) as Record<string, unknown>
              } catch {
                continue
              }
              dispatchEvent(evt)
            }
            idx = buffer.indexOf('\n\n')
          }
        }
        resolve(fullText.trim())
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })()
  })
}

function parseModelCatalog(payload: unknown): string[] {
  const container = payload as { data?: unknown; models?: unknown } | null
  const list = Array.isArray(container?.data)
    ? container?.data
    : Array.isArray(container?.models)
      ? container?.models
      : []
  const slugs: string[] = []
  for (const entry of list) {
    if (typeof entry === 'string') {
      slugs.push(entry)
    } else if (entry && typeof entry === 'object') {
      const slug = (entry as Record<string, unknown>).slug
      if (typeof slug === 'string' && slug.trim()) slugs.push(slug.trim())
    }
  }
  return [...new Set(slugs)]
}

async function fetchModelCatalog(): Promise<string[]> {
  const session = await chrome.storage.session.get([
    STORAGE_KEYS.modelsCache,
    STORAGE_KEYS.modelsCacheAt,
  ])
  const cachedAt = (session as Record<string, unknown>)[STORAGE_KEYS.modelsCacheAt]
  const cached = (session as Record<string, unknown>)[STORAGE_KEYS.modelsCache]
  if (
    typeof cachedAt === 'number' &&
    Date.now() - cachedAt < MODELS_CACHE_TTL_MS &&
    Array.isArray(cached) &&
    cached.length > 0
  ) {
    return cached as string[]
  }

  try {
    const headers = await codexHeaders()
    const res = await fetch(
      `${OPENAI_CONFIG.apiUrl}/models?client_version=${OPENAI_CONFIG.clientVersion}`,
      { headers },
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const models = parseModelCatalog(await res.json())
    if (models.length > 0) {
      await chrome.storage.session.set({
        [STORAGE_KEYS.modelsCache]: models,
        [STORAGE_KEYS.modelsCacheAt]: Date.now(),
      })
    }
    return models
  } catch {
    // Catalogue indisponible : on repart sur les donnees cachees perimees, sinon le fallback.
    return Array.isArray(cached) && cached.length > 0 ? (cached as string[]) : []
  }
}

async function getStoredModel(): Promise<string> {
  const raw = await chrome.storage.local.get('openai:model')
  const stored = (raw as Record<string, unknown>)['openai:model']
  return typeof stored === 'string' ? stored.trim() : ''
}

/** Catalogue des modeles du compte + modele effectivement utilise. */
export async function listModels(): Promise<{ models: string[]; selected: string }> {
  const models = await fetchModelCatalog()
  return { models, selected: await resolveModel() }
}

/** Memorise le modele choisi par l'utilisateur (ignore s'il n'existe pas). */
export async function selectModel(model: string): Promise<{ models: string[]; selected: string }> {
  const trimmed = model.trim()
  if (trimmed) {
    await chrome.storage.local.set({ 'openai:model': trimmed })
  }
  return listModels()
}

export async function resolveModel(): Promise<string> {
  const catalog = await fetchModelCatalog()

  if (catalog.length === 0) {
    return (await getStoredModel()) || OPENAI_CONFIG.preferredModel || FALLBACK_MODEL
  }
  // Un modele hors catalogue (ex. "gpt-5") est rejete par le backend avec un compte ChatGPT.
  const storedModel = await getStoredModel()
  if (storedModel && catalog.includes(storedModel)) return storedModel
  if (catalog.includes(OPENAI_CONFIG.preferredModel)) return OPENAI_CONFIG.preferredModel
  return catalog[0]
}

/** Un appel complet vers /responses (SSE) avec un input deja structure (fichiers, etc.). */
export async function codexCompleteRaw(
  input: unknown,
  instructions: string,
  model?: string,
): Promise<string> {
  const headers = await codexHeaders()
  const body = {
    model: model ?? (await resolveModel()),
    instructions,
    input,
    stream: true,
    store: false,
    include: ['reasoning.encrypted_content'],
  }

  const res = await fetch(`${OPENAI_CONFIG.apiUrl}/responses`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    let detail = `HTTP ${res.status}`
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string }; message?: string }
      detail = parsed?.error?.message ?? parsed?.message ?? detail
    } catch {
      if (text) detail = text.slice(0, 300)
    }
    throw new Error(detail)
  }

  if (!res.body) throw new Error('Reponse du modele vide.')
  return readSseResponse(res.body)
}

/** Un appel complet vers /responses (SSE) avec instructions systeme et input texte simple. */
export async function codexComplete(
  input: string,
  instructions: string,
  model?: string,
): Promise<string> {
  return codexCompleteRaw(
    [
      {
        role: 'user',
        content: input,
      },
    ],
    instructions,
    model,
  )
}
