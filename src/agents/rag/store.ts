/**
 * Base vectorielle IndexedDB pour le RAG.
 * Stocke des chunks (texte + metadonnees + vecteur) et fait la recherche
 * par similarite cosinus en local. Compatible avec l'usage LangChain via
 * une methode invoke(query) -> Document[] (retriever maison).
 */
import { Document } from '@langchain/core/documents'
import type { EmbeddingsProvider } from './embeddings'

const DB_NAME = 'uaai-rag'
const DB_VERSION = 1
const STORE_CHUNKS = 'chunks'

export type ChunkSource = 'page' | 'conversation' | 'memory'

export interface StoredChunk {
  id?: number
  content: string
  source: { kind: ChunkSource; url?: string; title?: string }
  /** Date d'indexation (epoch ms). */
  indexedAt: number
  /** Vecteur produit par l'EmbeddingsProvider (JSON serialise par IndexedDB). */
  vector: number[]
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        db.createObjectStore(STORE_CHUNKS, { keyPath: 'id', autoIncrement: true })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB indisponible.'))
  })
}

function txRequest<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CHUNKS, mode)
    const request = run(tx.objectStore(STORE_CHUNKS))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Transaction IndexedDB echouee.'))
  })
}

function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length)
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export class RagStore {
  private constructor(
    private readonly db: IDBDatabase,
    private readonly embeddings: EmbeddingsProvider,
  ) {}

  static async create(embeddings: EmbeddingsProvider): Promise<RagStore> {
    return new RagStore(await openDb(), embeddings)
  }

  /** Indexe un chunk (embedding calcule ici). */
  async add(content: string, source: StoredChunk['source']): Promise<void> {
    const vector = await this.embeddings.embed(content)
    const chunk: StoredChunk = {
      content,
      source,
      indexedAt: Date.now(),
      vector,
    }
    await txRequest(this.db, 'readwrite', (store) => store.add(chunk) as IDBRequest<IDBValidKey>)
  }

  /** Recherche les chunks les plus proches de la requete. */
  async similaritySearch(query: string, k = 4): Promise<Document[]> {
    const queryVector = await this.embeddings.embed(query)
    const chunks = await txRequest<StoredChunk[]>(this.db, 'readonly', (store) => store.getAll() as IDBRequest<StoredChunk[]>)

    return chunks
      .map((chunk) => ({
        chunk,
        score: cosineSimilarity(queryVector, chunk.vector ?? []),
      }))
      .filter((entry) => entry.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((entry) => new Document({ pageContent: entry.chunk.content, metadata: { ...entry.chunk.source, score: entry.score } }))
  }

  /** Nombre total de chunks indexes. */
  async count(): Promise<number> {
    return txRequest<number>(this.db, 'readonly', (store) => store.count())
  }

  /** Purge complete (debug). */
  async clear(): Promise<void> {
    await txRequest(this.db, 'readwrite', (store) => store.clear() as IDBRequest<undefined>)
  }

  close(): void {
    this.db.close()
  }
}
