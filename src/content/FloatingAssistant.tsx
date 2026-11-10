import { useEffect, useRef, useState, type FormEvent, type ChangeEvent } from 'react'
import type { AttachedFile, LoginState, PageContext } from '../shared/types'
import { sendToBackground } from '../shared/messaging'
import { AUTH_POLL_INTERVAL_MS } from '../shared/config'
import { renderMarkdown } from './markdown'

const MAX_PAGE_TEXT_LENGTH = 12_000
const MAX_FILE_SIZE = 10 * 1024 * 1024
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain', 'text/markdown']

function getPageContext(): PageContext {
  return {
    url: window.location.href,
    title: document.title,
    text: (document.body?.innerText ?? '').slice(0, MAX_PAGE_TEXT_LENGTH),
  }
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function FloatingAssistant() {
  const [question, setQuestion] = useState('')
  const [auth, setAuth] = useState<LoginState | null>(null)
  const [answer, setAnswer] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [files, setFiles] = useState<AttachedFile[]>([])
  const [models, setModels] = useState<{ models: string[]; selected: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (auth?.state !== 'deviceCode') return
    const timer = window.setInterval(async () => {
      try {
        setAuth(await sendToBackground<LoginState>({ type: 'AUTH:POLL' }))
      } catch {}
    }, AUTH_POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [auth?.state])

  useEffect(() => {
    if (auth?.state !== 'signedIn') {
      setModels(null)
      return
    }
    void loadModels()
  }, [auth?.state])

  async function loadModels() {
    try {
      const result = await sendToBackground<{ models: string[]; selected: string }>({ type: 'MODELS:LIST' })
      setModels(result)
    } catch {
      // keep silent
    }
  }

  async function handleModelChange(model: string) {
    try {
      const result = await sendToBackground<{ selected: string }>({ type: 'MODELS:SELECT', payload: { model } })
      setModels((prev) => (prev ? { ...prev, selected: result.selected } : prev))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? [])
    event.target.value = ''
    for (const file of selected) {
      if (file.size > MAX_FILE_SIZE) {
        setError(`Fichier trop volumineux (max 10Mo) : ${file.name}`)
        continue
      }
      const mime = file.type || (file.name.endsWith('.md') ? 'text/markdown' : file.name.endsWith('.txt') ? 'text/plain' : '')
      if (!ACCEPTED_TYPES.includes(mime) && !file.name.endsWith('.md') && !file.name.endsWith('.txt')) {
        setError(`Type non pris en charge : ${file.name}`)
        continue
      }
      try {
        const dataUrl = await fileToDataUrl(file)
        setFiles((prev) => [
          ...prev,
          {
            name: file.name,
            mimeType: mime || 'application/octet-stream',
            dataUrl,
            size: file.size,
          },
        ])
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    }
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = question.trim()
    if ((!text && files.length === 0) || loading) return

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
        payload: { question: text || 'Analyse ces fichiers.', page: getPageContext(), files },
      })
      setAnswer(result)
      setQuestion('')
      setFiles([])
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
            <span>Assistant IA · Page actuelle</span>
            <button className="uaai-assistant-close" type="button" aria-label="Fermer la réponse" onClick={() => setPanelOpen(false)}>×</button>
          </div>
          <div className="uaai-assistant-content" aria-live="polite">
            {loading ? <p className="uaai-assistant-status">Réponse en cours…</p> : null}
            {auth?.state === 'deviceCode' ? (
              <div className="uaai-assistant-login">
                <p>Connecte-toi avec ton compte ChatGPT, puis renvoie ta question.</p>
                <div className="uaai-device-code">{auth.userCode}</div>
                <button className="uaai-btn uaai-btn-primary" type="button" onClick={() => void openVerifyPage()}>Ouvrir la page de vérification</button>
              </div>
            ) : null}
            {auth?.state === 'signedIn' && !loading && !answer && !error ? (
              <p className="uaai-assistant-status">Connexion réussie. Envoie ta question.</p>
            ) : null}
            {error ? <div className="uaai-error">{error}</div> : null}
            {answer ? <div className="uaai-body uaai-assistant-answer" dangerouslySetInnerHTML={{ __html: renderMarkdown(answer) }} /> : null}
          </div>
        </section>
      ) : null}
      {files.length > 0 ? (
        <div className="uaai-assistant-files">
          {files.map((file, index) => (
            <div key={`${file.name}-${index}`} className="uaai-assistant-file">
              <span className="uaai-assistant-file-name">{file.name}</span>
              <button type="button" onClick={() => removeFile(index)} aria-label="Supprimer le fichier">×</button>
            </div>
          ))}
        </div>
      ) : null}
      <form className="uaai-assistant-form" onSubmit={(event) => void handleSubmit(event)}>
        <input ref={fileInputRef} type="file" multiple accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.md,image/*,application/pdf,text/plain,text/markdown" style={{ display: 'none' }} onChange={(event) => void handleFileChange(event)} />
        <button className="uaai-assistant-attach" type="button" aria-label="Joindre un fichier" onClick={() => fileInputRef.current?.click()}>+</button>
        <input className="uaai-assistant-input" type="text" value={question} maxLength={2000} aria-label="Question sur cette page" placeholder="Pose une question sur cette page…" onChange={(event) => setQuestion(event.target.value)} />
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
        <button className="uaai-assistant-submit" type="submit" aria-label="Envoyer la question" disabled={(!question.trim() && files.length === 0) || loading}>
          {loading ? '…' : '↑'}
        </button>
      </form>
    </div>
  )
}
