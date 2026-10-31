import { AUTH_POLL_ALARM } from '../shared/config'
import type { LoginState, RuntimeMessage, RuntimeResponse } from '../shared/types'
import { cancelFlow, login, logout, poll, status } from './auth'
import { answerPageQuestion, listModels, selectModel } from './openai'

async function handle(message: RuntimeMessage): Promise<RuntimeResponse<unknown>> {
  switch (message.type) {
    case 'AUTH:LOGIN':
      return { ok: true, data: (await login()) as LoginState }
    case 'AUTH:POLL':
      return { ok: true, data: (await poll()) as LoginState }
    case 'AUTH:STATUS':
      return { ok: true, data: (await status()) as LoginState }
    case 'AUTH:CANCEL_FLOW':
      return { ok: true, data: (await cancelFlow()) as LoginState }
    case 'AUTH:LOGOUT':
      return { ok: true, data: (await logout()) as LoginState }
    case 'AUTH:OPEN_VERIFY': {
      await chrome.tabs.create({ url: message.payload.url })
      return { ok: true, data: null }
    }
    case 'PAGE:ASK': {
      const { question, page } = message.payload
      const result = await answerPageQuestion(question, page)
      return { ok: true, data: result }
    }
    case 'MODELS:LIST':
      return { ok: true, data: await listModels() }
    case 'MODELS:SELECT':
      return { ok: true, data: await selectModel(message.payload.model) }
    default:
      return { ok: false, error: `Message inconnu : ${(message as { type: string }).type}` }
  }
}

export function registerBackgroundListener(): void {
  // Routage des messages depuis popup/options/content.
  chrome.runtime.onMessage.addListener((message: RuntimeMessage): Promise<RuntimeResponse<unknown>> => {
    return handle(message).catch((err: unknown) => ({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }))
  })

  // Polling du device-auth meme quand aucune UI n'est ouverte.
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === AUTH_POLL_ALARM) {
      void poll().catch(() => undefined)
    }
  })
}

registerBackgroundListener()