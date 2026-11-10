import { useEffect, useState } from 'react'
import type { LoginState } from '../shared/types'
import { sendToBackground } from '../shared/messaging'
import { AUTH_POLL_INTERVAL_MS, OPENAI_CONFIG } from '../shared/config'
import './options.css'

export function Options() {
  const [auth, setAuth] = useState<LoginState | null>(null)
  const [busy, setBusy] = useState<'logout' | 'login' | 'test' | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [layaEndpoint, setLayaEndpoint] = useState('')
  const [layaBusy, setLayaBusy] = useState<'save' | 'test' | null>(null)
  const [layaMessage, setLayaMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    sendToBackground<LoginState>({ type: 'AUTH:STATUS' })
      .then(setAuth)
      .catch(() => setAuth({ state: 'signedOut' }))
    sendToBackground<{ endpoint: string | null }>({ type: 'LAYA:GET' })
      .then((res) => setLayaEndpoint(res.endpoint ?? ''))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (auth?.state !== 'deviceCode') return
    const timer = setInterval(async () => {
      try {
        setAuth(await sendToBackground<LoginState>({ type: 'AUTH:POLL' }))
      } catch {
        // keep polling
      }
    }, AUTH_POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [auth?.state])

  const signedInAuth = auth !== null && auth.state === 'signedIn' ? auth : null
  const deviceAuth = auth !== null && auth.state === 'deviceCode' ? auth : null
  const signedIn = signedInAuth !== null
  const deviceCode = deviceAuth !== null

  async function handleLogin() {
    setBusy('login')
    setMessage(null)
    try {
      const result = await sendToBackground<LoginState>({ type: 'AUTH:LOGIN' })
      setAuth(result)
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(null)
    }
  }

  async function handleCancelFlow() {
    try {
      setAuth(await sendToBackground<LoginState>({ type: 'AUTH:CANCEL_FLOW' }))
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : String(err) })
    }
  }

  async function openVerifyPage() {
    if (auth?.state !== 'deviceCode') return
    await sendToBackground<null>({ type: 'AUTH:OPEN_VERIFY', payload: { url: auth.verifyUrl } })
  }

  async function handleLogout() {
    setBusy('logout')
    setMessage(null)
    try {
      setAuth(await sendToBackground<LoginState>({ type: 'AUTH:LOGOUT' }))
      setMessage({ kind: 'ok', text: 'Deconnecte.' })
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(null)
    }
  }

  async function handleTest() {
    setBusy('test')
    setMessage(null)
    try {
      setMessage({ kind: 'ok', text: 'Connexion ChatGPT active.' })
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(null)
    }
  }

  async function handleSaveLaya() {
    setLayaBusy('save')
    setLayaMessage(null)
    try {
      await sendToBackground<{ endpoint: string | null }>({ type: 'LAYA:SET', payload: { endpoint: layaEndpoint } })
      setLayaMessage({
        kind: 'ok',
        text: layaEndpoint.trim() ? 'Endpoint Laya enregistre.' : 'Endpoint Laya vide : le routeur utilisera le fallback LLM.',
      })
    } catch (err) {
      setLayaMessage({ kind: 'err', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setLayaBusy(null)
    }
  }

  async function handleTestLaya() {
    setLayaBusy('test')
    setLayaMessage(null)
    try {
      const res = await sendToBackground<{ endpoint: string; result: unknown }>({ type: 'LAYA:TEST' })
      setLayaMessage({ kind: 'ok', text: `Laya repond sur ${res.endpoint}.` })
    } catch (err) {
      setLayaMessage({ kind: 'err', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setLayaBusy(null)
    }
  }

  return (
    <div className="wrap">
      <header>
        <h1>Assistant ChatGPT</h1>
        <p>Parametres de l'assistant flottant.</p>
      </header>

      <div className="card">
        <h2>Authentification</h2>
        <dl className="row">
          <dt>Statut</dt>
          <dd>
            <span className={`status-badge ${signedIn ? 'on' : deviceCode ? 'warn' : 'off'} dot`}>
              {deviceCode ? 'Validation en attente' : signedIn ? 'Connecte a ChatGPT' : 'Non connecte'}
            </span>
          </dd>
        </dl>

        {deviceAuth ? (
          <>
            <div className="device-box">
              <div className="device-code">{deviceAuth.userCode}</div>
              <p className="device-hint">
                Entre ce code sur la page de verification OpenAI, connecte-toi avec ton compte ChatGPT.
              </p>
            </div>
            <div className="actions">
              <button className="btn btn-primary" onClick={openVerifyPage} disabled={busy !== null}>
                Ouvrir la page de verification
              </button>
              <button className="btn btn-secondary" onClick={handleCancelFlow} disabled={busy !== null}>
                Annuler
              </button>
            </div>
          </>
        ) : (
          <>
            {signedInAuth ? (
              <dl className="row">
                <dt>Compte</dt>
                <dd>{signedInAuth.email ?? 'inconnu'}</dd>
              </dl>
            ) : null}
            {signedInAuth?.expiresAt ? (
              <dl className="row">
                <dt>Expiration token</dt>
                <dd>{new Date(signedInAuth.expiresAt).toLocaleString('fr-FR')}</dd>
              </dl>
            ) : null}
            <div className="actions">
              {signedIn ? (
                <button className="btn btn-secondary" onClick={handleLogout} disabled={busy !== null}>
                  {busy === 'logout' ? 'Deconnexion...' : 'Se deconnecter'}
                </button>
              ) : (
                <button className="btn btn-primary" onClick={handleLogin} disabled={busy !== null}>
                  {busy === 'login' ? 'Demarrage...' : 'Se connecter avec ChatGPT'}
                </button>
              )}
              <button className="btn btn-primary" onClick={handleTest} disabled={busy !== null || !signedIn}>
                {busy === 'test' ? 'Test en cours...' : 'Tester la connexion'}
              </button>
            </div>
          </>
        )}

        {message ? <div className={`msg ${message.kind === 'ok' ? 'msg-ok' : 'msg-err'}`}>{message.text}</div> : null}
      </div>

      <div className="card">
        <h2>Laya AI (optionnel)</h2>
        <p className="hint">
          Serveur Laya auto-heberge pour les decisions du routeur (System 1). Sans endpoint, chaque
          decision bascule automatiquement sur le modele de chat.
        </p>
        <div className="laya-row">
          <input
            type="url"
            value={layaEndpoint}
            placeholder="http://localhost:8000"
            aria-label="Endpoint du serveur Laya"
            onChange={(e) => setLayaEndpoint(e.target.value)}
          />
          <button className="btn btn-secondary" onClick={handleSaveLaya} disabled={layaBusy !== null}>
            {layaBusy === 'save' ? 'Enregistrement...' : 'Enregistrer'}
          </button>
          <button className="btn btn-primary" onClick={handleTestLaya} disabled={layaBusy !== null}>
            {layaBusy === 'test' ? 'Test en cours...' : 'Tester'}
          </button>
        </div>
        {layaMessage ? <div className={`msg ${layaMessage.kind === 'ok' ? 'msg-ok' : 'msg-err'}`}>{layaMessage.text}</div> : null}
      </div>

      <div className="card">
        <h2>Configuration</h2>
        <dl className="row">
          <dt>Issuer</dt>
          <dd><code>{OPENAI_CONFIG.issuerUrl}</code></dd>
        </dl>
        <dl className="row">
          <dt>Backend IA</dt>
          <dd><code>{OPENAI_CONFIG.apiUrl}</code></dd>
        </dl>
        <dl className="row">
          <dt>Modele prefere</dt>
          <dd><code>{OPENAI_CONFIG.preferredModel}</code></dd>
        </dl>
      </div>
    </div>
  )
}