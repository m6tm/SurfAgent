import { useEffect, useState } from 'react'
import type { LoginState } from '../shared/types'
import { sendToBackground } from '../shared/messaging'
import { AUTH_POLL_INTERVAL_MS } from '../shared/config'
import './popup.css'

type Waiting = null | 'login' | 'logout'

export function App() {
  const [auth, setAuth] = useState<LoginState | null>(null)
  const [waiting, setWaiting] = useState<Waiting>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    sendToBackground<LoginState>({ type: 'AUTH:STATUS' })
      .then(setAuth)
      .catch(() => setAuth({ state: 'signedOut' }))
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

  async function handleLogin() {
    setWaiting('login')
    setMessage(null)
    try {
      const result = await sendToBackground<LoginState>({ type: 'AUTH:LOGIN' })
      setAuth(result)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setWaiting(null)
    }
  }

  async function handleLogout() {
    setWaiting('logout')
    setMessage(null)
    try {
      setAuth(await sendToBackground<LoginState>({ type: 'AUTH:LOGOUT' }))
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setWaiting(null)
    }
  }

  async function handleCancelFlow() {
    try {
      setAuth(await sendToBackground<LoginState>({ type: 'AUTH:CANCEL_FLOW' }))
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }

  async function openVerifyPage() {
    if (auth?.state !== 'deviceCode') return
    await sendToBackground<null>({ type: 'AUTH:OPEN_VERIFY', payload: { url: auth.verifyUrl } })
  }

  const signedInAuth = auth !== null && auth.state === 'signedIn' ? auth : null
  const deviceAuth = auth !== null && auth.state === 'deviceCode' ? auth : null
  const signedIn = signedInAuth !== null
  const deviceCode = deviceAuth !== null
  const loading = auth === null

  return (
    <div className="app">
      <div className="logo">
        <div className="logo-badge">AI</div>
        <div>
          <h1>ChatGPT Assistant</h1>
          <p>Assistant sur la page actuelle</p>
        </div>
      </div>

      <div className="card">
        {deviceCode ? (
          <>
            <div className="status">
              <span className="status-dot loading" />
              Validation du code en attente
            </div>
            <div className="device-box">
              <div className="device-code">{deviceAuth.userCode}</div>
              <p className="device-hint">
                Entre ce code sur la page de verification OpenAI, connecte-toi avec ton compte ChatGPT.
              </p>
            </div>
            <div className="buttons">
              <button className="btn btn-primary" onClick={openVerifyPage}>
                Ouvrir la page de verification
              </button>
              <button className="btn btn-ghost" onClick={handleCancelFlow}>
                Annuler
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="status">
              <span className={`status-dot ${signedIn ? 'on' : loading ? 'loading' : 'off'}`} />
              {signedIn
                ? `Connecte${signedInAuth.email ? ` : ${signedInAuth.email}` : ''}`
                : loading
                  ? 'Verification en cours...'
                  : 'Non connecte'}
            </div>

            <div className="buttons">
              {signedIn ? (
                <button className="btn btn-secondary" onClick={handleLogout} disabled={waiting !== null}>
                  {waiting === 'logout' ? 'Deconnexion...' : 'Se deconnecter'}
                </button>
              ) : (
                !loading && (
                  <button className="btn btn-primary" onClick={handleLogin} disabled={waiting !== null}>
                    {waiting === 'login' ? 'Demarrage...' : 'Se connecter avec ChatGPT'}
                  </button>
                )
              )}
            </div>
          </>
        )}

        {message ? <div className="msg msg-error">{message}</div> : null}

        {!signedIn && !deviceCode && !loading ? (
          <p className="hint">
            Connecte-toi avec ton compte ChatGPT pour utiliser l'assistant flottant sur n'importe quelle page web.
          </p>
        ) : null}

        <div className="actions">
          <button className="btn btn-ghost" onClick={() => chrome.runtime.openOptionsPage()}>
            Parametres
          </button>
        </div>
      </div>
    </div>
  )
}