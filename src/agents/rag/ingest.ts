/**
 * Ingestion RAG : decoupage et indexation des contenus
 * (pages visitees, conversations, memoire agent).
 */
import type { PageContext } from '../../shared/types'
import type { ChunkSource } from './store'
import { RagStore } from './store'

const CHUNK_SIZE = 900
const CHUNK_OVERLAP = 150

/** Decoupe un texte en chunks par paragraphes, avec chevauchement. */
export function chunkText(text: string): string[] {
  const normalized = text.replace(/\s+\n/g, '\n').trim()
  if (!normalized) return []

  const paragraphs = normalized.split(/\n{2,}/)
  const chunks: string[] = []
  let current = ''

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph
    if (candidate.length > CHUNK_SIZE && current) {
      chunks.push(current)
      // Chevauchement : on garde la fin du chunk precedent.
      current = current.slice(Math.max(0, current.length - CHUNK_OVERLAP)) + '\n\n' + paragraph
    } else {
      current = candidate
    }
  }
  if (current.trim()) chunks.push(current.trim())

  // Chunks trop longs (paragraphe unique geant) : coupe brutale.
  return chunks.flatMap((chunk) => {
    if (chunk.length <= CHUNK_SIZE * 1.5) return [chunk]
    const parts: string[] = []
    for (let i = 0; i < chunk.length; i += CHUNK_SIZE) {
      parts.push(chunk.slice(i, i + CHUNK_SIZE))
    }
    return parts
  })
}

/** Indexe le contenu d'une page (titre + texte) en plusieurs chunks. */
export async function ingestPage(store: RagStore, page: PageContext): Promise<number> {
  const text = `# ${page.title}\nURL: ${page.url}\n\n${page.text}`.trim()
  const chunks = chunkText(text)
  for (const chunk of chunks) {
    await store.add(chunk, { kind: 'page', url: page.url, title: page.title })
  }
  return chunks.length
}

/** Indexe un tour de conversation (question + reponse finale). */
export async function ingestConversation(
  store: RagStore,
  question: string,
  answer: string,
  page?: PageContext | null,
): Promise<number> {
  const text = `Question : ${question}\n\nReponse : ${answer}`.trim()
  const source: { kind: ChunkSource; url?: string; title?: string } = { kind: 'conversation' }
  if (page) {
    source.url = page.url
    source.title = page.title
  }
  await store.add(text, source)
  return 1
}

/** Ecrit une note en memoire persistante de l'agent. */
export async function ingestMemory(store: RagStore, note: string): Promise<number> {
  const chunks = chunkText(note)
  for (const chunk of chunks) {
    await store.add(chunk, { kind: 'memory' })
  }
  return chunks.length
}
