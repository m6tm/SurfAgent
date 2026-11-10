/**
 * Adaptateur ChatModel LangChain branche sur le backend Codex (compte ChatGPT).
 * Permet a LangGraph d'utiliser le meme canal que le reste de l'extension,
 * sans provider OpenAI officiel.
 */
import type { BaseMessage } from '@langchain/core/messages'
import { SimpleChatModel } from '@langchain/core/language_models/chat_models'
import { codexCompleteRaw } from './codexApi'

export interface CodexChatModelOptions {
  /** Instructions systeme passees au backend Codex. */
  instructions?: string
  /** Modele impose (sinon resolution automatique via le catalogue du compte). */
  model?: string
}

/** Convertit le role d'un BaseMessage en role compris par l'API Responses. */
function toCodexRole(type: string): 'user' | 'assistant' {
  return type === 'ai' ? 'assistant' : 'user'
}

export class CodexChatModel extends SimpleChatModel {
  static lc_name() {
    return 'CodexChatModel'
  }

  lc_serializable = false

  readonly instructions: string
  readonly model?: string

  constructor(options: CodexChatModelOptions = {}) {
    super({})
    this.instructions = options.instructions ?? 'Tu es un assistant utile. Reponds en francais.'
    this.model = options.model
  }

  _llmType(): string {
    return 'codex-chatgpt'
  }

  /** Appel non streamant : le SSE est reassemble en interne. */
  async _call(messages: BaseMessage[]): Promise<string> {
    // Le contenu textuel de chaque message est concatene ; les tool calls
    // eventuels sont serialises en texte (le backend Codex de l'extension
    // ne gere pas les tool_calls nativement).
    const input = messages
      .filter((message) => {
        const text = typeof message.content === 'string' ? message.content.trim() : ''
        return text.length > 0
      })
      .map((message) => ({
        role: toCodexRole(message.getType()),
        content:
          typeof message.content === 'string'
            ? message.content
            : JSON.stringify(message.content),
      }))

    if (input.length === 0) {
      throw new Error('Aucun message a envoyer au modele.')
    }
    return codexCompleteRaw(input, this.instructions, this.model)
  }
}
