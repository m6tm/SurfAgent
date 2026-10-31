/** Contexte textuel de la page transmis a l'IA sur demande de l'utilisateur. */
export interface PageContext {
  url: string
  title: string
  text: string
}

/** Etat d'authentification partage par toute l'UI. */
export type LoginState =
  | { state: 'signedIn'; email: string | null; expiresAt: number | null }
  | { state: 'signedOut' }
  | { state: 'deviceCode'; verifyUrl: string; userCode: string; expiresAt: number }

/** Protocole de messagerie extension-wide (discriminated union). */
export type RuntimeMessage =
  | { type: 'AUTH:LOGIN' }
  | { type: 'AUTH:POLL' }
  | { type: 'AUTH:LOGOUT' }
  | { type: 'AUTH:STATUS' }
  | { type: 'AUTH:CANCEL_FLOW' }
  | { type: 'AUTH:OPEN_VERIFY'; payload: { url: string } }
  | { type: 'PAGE:ASK'; payload: { question: string; page: PageContext } }
  | { type: 'MODELS:LIST' }
  | { type: 'MODELS:SELECT'; payload: { model: string } }

export type RuntimeResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string }
