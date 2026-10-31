import { AUTH_POLL_ALARM, OPENAI_CONFIG, STORAGE_KEYS } from '../shared/config'
import type { LoginState } from '../shared/types'
import { postForm, postJson } from '../shared/messaging'

/** Flow d'appareil en cours (persiste en session entre les pollings). */
interface PendingDeviceFlow {
  deviceAuthId: string
  userCode: string
  expiresAt: number
}

interface TokenSet {
  access_token: string
  refresh_token?: string
  id_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    return JSON.parse(atob(padded)) as Record<string, unknown>
  } catch {
    return null
  }
}

function getEmailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null
  const payload = decodeJwtPayload(idToken)
  if (payload && typeof payload.email === 'string') return payload.email
  return null
}

/**
 * Extrait le ChatGPT-Account-Id du JWT, comme le fait le client Codex
 * (claims prives {"https://api.openai.com/auth": { chatgpt_account_id }}).
 */
export function getAccountIdFromToken(accessToken: string): string | null {
  const payload = decodeJwtPayload(accessToken)
  if (!payload) return null

  const authClaim = payload['https://api.openai.com/auth']
  if (authClaim && typeof authClaim === 'object') {
    const auth = authClaim as Record<string, unknown>
    const candidate = auth['chatgpt_account_id'] ?? auth['chatgpt_account_user_id']
    if (typeof candidate === 'string' && candidate) return candidate
  }
  if (typeof payload['https://api.openai.com/auth.chatgpt_account_id'] === 'string') {
    return payload['https://api.openai.com/auth.chatgpt_account_id'] as string
  }
  if (typeof payload['chatgpt_account_id'] === 'string') return payload['chatgpt_account_id'] as string
  if (typeof payload['sub'] === 'string') return payload['sub'] as string
  return null
}

async function persistTokens(accessToken: string, refreshToken: string | null, idToken: string | null, expiresIn: number | null): Promise<void> {
  const accountId = getAccountIdFromToken(accessToken)
  await chrome.storage.local.set({
    [STORAGE_KEYS.accessToken]: accessToken,
    [STORAGE_KEYS.refreshToken]: refreshToken,
    [STORAGE_KEYS.idToken]: idToken,
    [STORAGE_KEYS.tokenExpiry]: expiresIn ? Date.now() + expiresIn * 1000 : null,
    [STORAGE_KEYS.accountId]: accountId,
    [STORAGE_KEYS.profileEmail]: getEmailFromIdToken(idToken ?? undefined),
  })
}

async function readStoredAuth(): Promise<{
  accessToken: string | null
  refreshToken: string | null
  expiresAt: number | null
  email: string | null
}> {
  const items = await chrome.storage.local.get([
    STORAGE_KEYS.accessToken,
    STORAGE_KEYS.refreshToken,
    STORAGE_KEYS.tokenExpiry,
    STORAGE_KEYS.profileEmail,
  ])
  return {
    accessToken: typeof items[STORAGE_KEYS.accessToken] === 'string' ? (items[STORAGE_KEYS.accessToken] as string) : null,
    refreshToken: typeof items[STORAGE_KEYS.refreshToken] === 'string' ? (items[STORAGE_KEYS.refreshToken] as string) : null,
    expiresAt: typeof items[STORAGE_KEYS.tokenExpiry] === 'number' ? (items[STORAGE_KEYS.tokenExpiry] as number) : null,
    email: typeof items[STORAGE_KEYS.profileEmail] === 'string' ? (items[STORAGE_KEYS.profileEmail] as string) : null,
  }
}

async function readPendingFlow(): Promise<PendingDeviceFlow | null> {
  const { [STORAGE_KEYS.pendingFlow]: flow } = await chrome.storage.session.get([STORAGE_KEYS.pendingFlow])
  if (!flow) return null
  const parsed = flow as PendingDeviceFlow
  if (typeof parsed.deviceAuthId !== 'string' || typeof parsed.userCode !== 'string') return null
  return parsed
}

async function writePendingFlow(flow: PendingDeviceFlow | null): Promise<void> {
  if (flow === null) {
    await chrome.storage.session.remove([STORAGE_KEYS.pendingFlow])
  } else {
    await chrome.storage.session.set({ [STORAGE_KEYS.pendingFlow]: flow })
  }
}

/** Echange authorization_code + code_verifier contre les tokens. */
async function exchangeAuthorization(authorizationCode: string, codeVerifier: string): Promise<void> {
  const tokens = await postForm<TokenSet>(OPENAI_CONFIG.tokenUrl, {
    grant_type: 'authorization_code',
    code: authorizationCode,
    redirect_uri: OPENAI_CONFIG.redirectUri,
    client_id: OPENAI_CONFIG.clientId,
    code_verifier: codeVerifier,
  })
  if (!tokens.access_token) {
    throw new Error('Echec de l\'echange du jeton : malformed response.')
  }
  await persistTokens(tokens.access_token, tokens.refresh_token ?? null, tokens.id_token ?? null, tokens.expires_in ?? null)
}

/** Rafraichit le token avec refresh_token (non interactif). */
async function tryRefresh(): Promise<void> {
  const stored = await readStoredAuth()
  if (!stored.refreshToken) throw new Error('Aucun refresh token.')

  const tokens = await postForm<TokenSet>(OPENAI_CONFIG.tokenUrl, {
    grant_type: 'refresh_token',
    refresh_token: stored.refreshToken,
    client_id: OPENAI_CONFIG.clientId,
  })
  if (!tokens.access_token) {
    await clearAuth()
    throw new Error('Session ChatGPT expiree (refresh refuse). Reconnecte-toi.')
  }
  await persistTokens(tokens.access_token, tokens.refresh_token ?? stored.refreshToken, tokens.id_token ?? null, tokens.expires_in ?? null)
}

/** Sollicite un code d'appareil aupres du backend Codex. */
async function requestDeviceCode(): Promise<PendingDeviceFlow> {
  const res = await postJson<{
    device_auth_id?: string
    user_code?: string
    usercode?: string
    interval?: number
    expires_in?: number
    error?: string
  }>(OPENAI_CONFIG.deviceCodeUrl, { client_id: OPENAI_CONFIG.clientId })

  const deviceAuthId = res.device_auth_id
  const userCode = res.user_code ?? res.usercode
  if (!deviceAuthId || !userCode) {
    throw new Error(`Impossible de demarrer la connexion ChatGPT (${res.error ?? 'reponse incomplette'}).`)
  }

  const expiresIn = Math.max(res.expires_in ?? 600, 60)
  return {
    deviceAuthId,
    userCode,
    expiresAt: Date.now() + expiresIn * 1000,
  }
}

/** Tente de valider le code entraine par l'utilisateur. */
async function pollDeviceFlowOnce(): Promise<'pending' | 'success' | 'failed'> {
  const flow = await readPendingFlow()
  if (!flow) return 'pending'

  if (Date.now() > flow.expiresAt) {
    await writePendingFlow(null)
    await chrome.alarms.clear(AUTH_POLL_ALARM)
    return 'failed'
  }

  let res: Response
  try {
    res = await fetch(OPENAI_CONFIG.deviceTokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_auth_id: flow.deviceAuthId, user_code: flow.userCode }),
    })
  } catch {
    return 'pending' // reseau instable : on reessaie au prochain tick
  }

  if (res.status === 403 || res.status === 404 || res.status === 429) {
    return 'pending'
  }

  if (!res.ok) {
    await writePendingFlow(null)
    await chrome.alarms.clear(AUTH_POLL_ALARM)
    return 'failed'
  }

  let body: { authorization_code?: string; code_verifier?: string }
  try {
    body = (await res.json()) as { authorization_code?: string; code_verifier?: string }
  } catch {
    return 'pending'
  }

  if (!body.authorization_code || !body.code_verifier) {
    return 'pending'
  }

  try {
    await exchangeAuthorization(body.authorization_code, body.code_verifier)
  } finally {
    await writePendingFlow(null)
    await chrome.alarms.clear(AUTH_POLL_ALARM)
  }
  return 'success'
}

/** Lance le flow de connexion et renvoie l'etat a afficher. */
export async function login(): Promise<LoginState> {
  const current = await status()
  if (current.state === 'signedIn') return current

  const flow = await requestDeviceCode()
  await writePendingFlow(flow)
  await chrome.alarms.create(AUTH_POLL_ALARM, { periodInMinutes: 0.5 })
  return {
    state: 'deviceCode',
    verifyUrl: OPENAI_CONFIG.verifyUrl,
    userCode: flow.userCode,
    expiresAt: flow.expiresAt,
  }
}

/** Declenche un poll immediat (appele par l'UI et par l'alarme). */
export async function poll(): Promise<LoginState> {
  await pollDeviceFlowOnce()
  return status()
}

export async function cancelFlow(): Promise<LoginState> {
  await writePendingFlow(null)
  await chrome.alarms.clear(AUTH_POLL_ALARM)
  return { state: 'signedOut' }
}

export async function logout(): Promise<LoginState> {
  await clearAuth()
  return cancelFlow()
}

async function clearAuth(): Promise<void> {
  await chrome.storage.local.remove([
    STORAGE_KEYS.accessToken,
    STORAGE_KEYS.refreshToken,
    STORAGE_KEYS.idToken,
    STORAGE_KEYS.tokenExpiry,
    STORAGE_KEYS.accountId,
    STORAGE_KEYS.profileEmail,
  ])
}

export async function status(): Promise<LoginState> {
  const stored = await readStoredAuth()
  if (stored.accessToken) {
    const expired = stored.expiresAt !== null && Date.now() > stored.expiresAt
    if (expired) {
      await clearAuth()
      return { state: 'signedOut' }
    }
    return { state: 'signedIn', email: stored.email, expiresAt: stored.expiresAt }
  }

  const flow = await readPendingFlow()
  if (flow) {
    if (Date.now() > flow.expiresAt) {
      await writePendingFlow(null)
      await chrome.alarms.clear(AUTH_POLL_ALARM)
      return { state: 'signedOut' }
    }
    return { state: 'deviceCode', verifyUrl: OPENAI_CONFIG.verifyUrl, userCode: flow.userCode, expiresAt: flow.expiresAt }
  }

  return { state: 'signedOut' }
}

/** Renvoie le token valide, en le rafraichissant si necessaire. */
export async function getAccessToken(): Promise<string> {
  const stored = await readStoredAuth()
  if (!stored.accessToken) throw new Error('Connexion requise : connecte-toi avec ChatGPT.')

  const needsRefresh = stored.expiresAt !== null && Date.now() > stored.expiresAt - 60_000
  if (needsRefresh && stored.refreshToken) {
    await tryRefresh()
    const refreshed = await readStoredAuth()
    if (refreshed.accessToken) return refreshed.accessToken
  }
  const again = await readStoredAuth()
  if (!again.accessToken) throw new Error('Connexion requise : connecte-toi avec ChatGPT.')
  return again.accessToken
}

export async function getAccountId(): Promise<string | null> {
  const { [STORAGE_KEYS.accountId]: accountId } = await chrome.storage.local.get([STORAGE_KEYS.accountId])
  return typeof accountId === 'string' ? accountId : null
}