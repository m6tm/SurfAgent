import { AUTH_POLL_ALARM } from '../shared/config'
import type { AgentTurnResult, LoginState, PageContext, RuntimeMessage, RuntimeResponse } from '../shared/types'
import { cancelFlow, login, logout, poll, status } from './auth'
import { answerPageQuestion, listModels, selectModel } from './openai'
import { runAgentTurn } from '../agents/graph'
import { ingestPage } from '../agents/rag/ingest'
import { RagStore } from '../agents/rag/store'
import { LocalHashEmbeddings } from '../agents/rag/embeddings'

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
      const { question, page, files } = message.payload
      const result = await answerPageQuestion(question, page, files)
      return { ok: true, data: result }
    }
    case 'AGENTS:ASK': {
      const { question, page } = message.payload
      const state = await runAgentTurn(question, (page as PageContext | null) ?? null)
      return {
        ok: true,
        data: {
          mode: state.routing?.mode ?? null,
          routingSource: state.routing?.source ?? null,
          confidence: state.routing?.confidence ?? 0,
          answer: state.finalAnswer ?? '',
          todos: state.todos ?? [],
          warning: state.warning ?? null,
        } satisfies AgentTurnResult,
      }
    }
    case 'AGENTS:INGEST_PAGE': {
      const store = await RagStore.create(new LocalHashEmbeddings())
      const added = await ingestPage(store, message.payload.page)
      return { ok: true, data: { chunks: added } }
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
  chrome.runtime.onMessage.addListener((message: RuntimeMessage): Promise<RuntimeResponse<unknown>> => {
    return handle(message).catch((err: unknown) => ({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }))
  })

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === AUTH_POLL_ALARM) {
      void poll().catch(() => undefined)
    }
  })
}

registerBackgroundListener()