/** Contexte textuel de la page transmis a l'IA sur demande de l'utilisateur. */
export interface PageContext {
  url: string
  title: string
  text: string
}

/** Resultat renvoye a l'UI apres un tour d'orchestration multi-agents. */
export interface AgentTurnResult {
  mode: 'chat' | 'agent' | null
  routingSource: 'laya' | 'llm' | null
  confidence: number
  answer: string
  todos: Array<{ id: string; label: string; status: 'pending' | 'in_progress' | 'done' }>
  warning: string | null
}

export interface AttachedFile {
  name: string
  mimeType: string
  dataUrl: string
  size: number
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
  | { type: 'PAGE:ASK'; payload: { question: string; page: PageContext; files?: AttachedFile[] } }
  | { type: 'AGENTS:ASK'; payload: { question: string; page: PageContext | null } }
  | { type: 'AGENTS:INGEST_PAGE'; payload: { page: PageContext } }
  | { type: 'LAYA:GET' }
  | { type: 'LAYA:SET'; payload: { endpoint: string } }
  | { type: 'LAYA:TEST' }
  | { type: 'MODELS:LIST' }
  | { type: 'MODELS:SELECT'; payload: { model: string } }

export type RuntimeResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string }
