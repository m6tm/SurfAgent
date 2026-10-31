import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import cssText from './content.css?inline'
import { FloatingAssistant } from './FloatingAssistant'

const HOST_ID = 'upwork-audit-ai-host'
const STYLE_ID = 'upwork-audit-ai-style'

function buildHost(): ShadowRoot {
  let host = document.getElementById(HOST_ID)
  if (!host) {
    host = document.createElement('div')
    host.id = HOST_ID
    document.documentElement.appendChild(host)
  }

  let shadow = host.shadowRoot
  if (!shadow) shadow = host.attachShadow({ mode: 'open' })

  if (!shadow.getElementById(STYLE_ID)) {
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = cssText
    shadow.appendChild(style)
  }

  if (!shadow.getElementById('uaai-root')) {
    const rootEl = document.createElement('div')
    rootEl.id = 'uaai-root'
    shadow.appendChild(rootEl)
  }

  return shadow
}

function App() {
  return <FloatingAssistant />
}

let rootInstance: Root | null = null

function mount() {
  const shadow = buildHost()
  const rootEl = shadow.getElementById('uaai-root')!
  if (!rootInstance) {
    rootInstance = createRoot(rootEl)
    rootInstance.render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  }
}

mount()
