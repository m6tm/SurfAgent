/**
 * Configuration de l'extension.
 *
 * Cette extension utilise le flow "Sign in with ChatGPT" via le client OAuth
 * public de Codex CLI (il n'y a PAS d'application a creer sur platform.openai.com).
 * Valeurs issues du client open-source openai/codex et des integrations
 * communautaires (litellm, hermes, openclaw, etc.).
 */
export const OPENAI_CONFIG = {
  /** Client OAuth public de Codex CLI. */
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',

  /** Issuer OpenAI. */
  issuerUrl: 'https://auth.openai.com',

  /** Demande d'un code d'appareil (device-auth Codex, JSON). */
  deviceCodeUrl: 'https://auth.openai.com/api/accounts/deviceauth/usercode',

  /** Polling de validation du code (device-auth Codex, JSON). */
  deviceTokenUrl: 'https://auth.openai.com/api/accounts/deviceauth/token',

  /** Echange autorisation -> tokens (OAuth, form-urlencoded). */
  tokenUrl: 'https://auth.openai.com/oauth/token',

  /** Page ou l'utilisateur entre son code. */
  verifyUrl: 'https://auth.openai.com/codex/device',

  /** Redirect URI attendu par l'echange device-auth. */
  redirectUri: 'https://auth.openai.com/deviceauth/callback',

  /** Scopes demandes. */
  scope: 'openid profile email offline_access',

  /**
   * Backend Codex (abonnement ChatGPT), pas l'API Platform.
   * Endpoints : GET  /models?client_version=... / POST /responses (SSE).
   */
  apiUrl: 'https://chatgpt.com/backend-api/codex',

  /** Version client envoyee au backend (gating du catalogue modeles). */
  clientVersion: '1.0.0',

  /** Modele prefer si present dans le catalogue du compte. */
  preferredModel: 'gpt-5.4-mini',

  /** Headers codex-cli attendus par le backend. */
  originator: 'codex_cli_rs',
  userAgent: 'codex_cli_rs/0.0.0 (Unknown 0; unknown) unknown',
} as const

/** Nom de l'alarme utilisee pour le polling du device-auth. */
export const AUTH_POLL_ALARM = 'uaai:auth-poll'

/** Intervalles de polling (ms). */
export const AUTH_POLL_INTERVAL_MS = 2500

/** Clefs de stockage de session. */
export const STORAGE_KEYS = {
  accessToken: 'openai:accessToken',
  refreshToken: 'openai:refreshToken',
  idToken: 'openai:idToken',
  tokenExpiry: 'openai:tokenExpiry',
  accountId: 'openai:accountId',
  profileEmail: 'openai:profileEmail',
  modelsCache: 'openai:modelsCache',
  modelsCacheAt: 'openai:modelsCacheAt',
  pendingFlow: 'openai:pendingDeviceFlow',
} as const

/** URLs sur lesquelles le scraper peut s'executer. */
export const UPWORK_PROFILE_URL_PATTERN =
  /^https:\/\/(?:www\.)?upwork\.com\/(?:freelancers|contractors)\//

/** Delai (ms) d'attente du DOM Upwork avant scraping. */
export const SCRAPE_GRACE_PERIOD_MS = 1500