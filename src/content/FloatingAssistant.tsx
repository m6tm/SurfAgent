import { useEffect, useState, type FormEvent } from 'react'
import type { LoginState, PageContext } from '../shared/types'

interface ModelsState {
  models: string[]
  selected: string
}
import { sendToBackground } from '../shared/messaging'
import { AUTH_POLL_INTERVAL_MS } from '../shared/config'
import { renderMarkdown } from './markdown'

const MAX_PAGE_TEXT_LENGTH = 12_000

function getPageContext(): PageContext {
  return {
    url: window.location.href,
    title: document.title,
    text: (document.body?.innerText ?? '').slice(0, MAX_PAGE_TEXT_LENGTH),
  }
}

export function FloatingAssistant() {
  const [question, setQuestion] = useState('')
  const [auth, setAuth] = useState<LoginState | null>(null)
  const [answer, setAnswer] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [models, setModels] = useState<ModelsState | null>(null)

  useEffect(() => {
    if (auth?.state !== 'signedIn' || models) return
    sendToBackground<ModelsState>({ type: 'MODELS:LIST' })
      .then(setModels)
      .catch(() => {
        // Catalogue indisponible : le background utilisera son modele par defaut.
      })
  }, [auth?.state, models])

  async function handleModelChange(model: string) {
    if (!model || loading) return
    try {
      setModels(await sendToBackground<ModelsState>({ type: 'MODELS:SELECT', payload: { model } }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    if (auth?.state !== 'deviceCode') return
    const timer = window.setInterval(async () => {
      try {
        setAuth(await sendToBackground<LoginState>({ type: 'AUTH:POLL' }))
      } catch {
        // Keep polling while the device flow is active.
      }
    }, AUTH_POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [auth?.state])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = question.trim()
    if (!text || loading) return

    setQuestion('')
    setPanelOpen(true)
    setAnswer(null)
    setError(null)
    setLoading(true)
    try {
      let currentAuth = auth ?? (await sendToBackground<LoginState>({ type: 'AUTH:STATUS' }))
      setAuth(currentAuth)

      if (currentAuth.state === 'signedOut') {
        currentAuth = await sendToBackground<LoginState>({ type: 'AUTH:LOGIN' })
        setAuth(currentAuth)
      }

      if (currentAuth.state !== 'signedIn') return

      const result = await sendToBackground<string>({
        type: 'PAGE:ASK',
        payload: { question: text, page: getPageContext() },
      })
      setAnswer(result)
      setQuestion('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function openVerifyPage() {
    if (auth?.state !== 'deviceCode') return
    try {
      await sendToBackground<null>({ type: 'AUTH:OPEN_VERIFY', payload: { url: auth.verifyUrl } })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="uaai-assistant">
      {panelOpen ? (
        <section className="uaai-assistant-panel" aria-label="Assistant IA">
          <div className="uaai-assistant-header">
            <span className="uaai-assistant-header-label">Assistant IA · Page actuelle</span>
            <button
              className="uaai-assistant-close"
              type="button"
              aria-label="Fermer la réponse"
              onClick={() => setPanelOpen(false)}
            >
              ×
            </button>
          </div>
          <div className="uaai-assistant-content" aria-live="polite">
            {loading ? (
            <p className="uaai-assistant-status">
              <span className="uaai-spinner" aria-hidden="true" />
              Réponse en cours…
            </p>
          ) : null}
            {auth?.state === 'deviceCode' ? (
              <div className="uaai-assistant-login">
                <p>Connecte-toi avec ton compte ChatGPT, puis renvoie ta question.</p>
                <div className="uaai-device-code">{auth.userCode}</div>
                <button className="uaai-btn uaai-btn-primary" type="button" onClick={() => void openVerifyPage()}>
                  Ouvrir la page de vérification
                </button>
              </div>
            ) : null}
            {auth?.state === 'signedIn' && !loading && !answer && !error ? (
              <p className="uaai-assistant-status">Connexion réussie. Envoie à nouveau ta question.</p>
            ) : null}
            {error ? <div className="uaai-error">{error}</div> : null}
            {answer ? (
              <div
                className="uaai-body uaai-assistant-answer"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(answer) }}
              />
            ) : null}
          </div>
        </section>
      ) : null}
      <form className="uaai-assistant-form" onSubmit={(event) => void handleSubmit(event)}>
        <input
          className="uaai-assistant-input"
          type="text"
          value={question}
          maxLength={2000}
          aria-label="Question sur cette page"
          placeholder="Pose une question sur cette page…"
          onChange={(event) => setQuestion(event.target.value)}
        />
        {models && models.models.length > 0 ? (
          <select
            className="uaai-assistant-model"
            value={models.selected}
            aria-label="Modèle IA"
            title={`Modèle : ${models.selected}`}
            onChange={(event) => void handleModelChange(event.target.value)}
          >
            {models.models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        ) : null}
        <button
          className="uaai-assistant-submit"
          type="submit"
          aria-label="Envoyer la question"
          disabled={!question.trim() || loading}
        >
              {loading ? <span className="uaai-spinner" aria-hidden="true" /> : '↑'}
        </button>
      </form>
    </div>
  )
}
