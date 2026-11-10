/**
 * Provider d'embeddings pour le RAG.
 *
 * Implementation initiale : hashing deterministe local (zero reseau), inspire
 * du "feature hashing". Rapide et suffisant pour un corpus personnel de
 * pages/conversations. Interface pensée pour etre remplacee plus tard par un
 * vrai backend (API embeddings self-hosted, ONNX local, etc.).
 */

export interface EmbeddingsProvider {
  /** Dimension des vecteurs produits. */
  readonly dimensions: number
  /** Calcule l'embedding d'un texte. */
  embed(text: string): Promise<number[]>
}

const STOP_WORDS = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'ou', 'en', 'au', 'aux',
  'que', 'qui', 'quoi', 'dans', 'pour', 'par', 'sur', 'avec', 'sans', 'est', 'sont',
  'the', 'a', 'an', 'of', 'to', 'and', 'in', 'on', 'for', 'with', 'is', 'are', 'be',
])

/** Hash FNV-1a 32 bits, deterministe. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  // Force un entier non signe.
  return hash >>> 0
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token))
}

/**
 * Embedding par feature hashing :
 * - unigrammes (poids 1) + bigrammes (poids 0.5) hashes dans un vecteur fixe ;
 * - normalisation L2 pour la similarite cosinus.
 */
export class LocalHashEmbeddings implements EmbeddingsProvider {
  readonly dimensions: number

  constructor(dimensions = 512) {
    this.dimensions = dimensions
  }

  async embed(text: string): Promise<number[]> {
    const vector = new Array<number>(this.dimensions).fill(0)
    const tokens = tokenize(text)
    if (tokens.length === 0) return vector

    for (let i = 0; i < tokens.length; i++) {
      const uniIndex = fnv1a(tokens[i]) % this.dimensions
      vector[uniIndex] += 1
      if (i + 1 < tokens.length) {
        const biIndex = fnv1a(`${tokens[i]}_${tokens[i + 1]}`) % this.dimensions
        vector[biIndex] += 0.5
      }
    }

    // Normalisation L2.
    let norm = 0
    for (const value of vector) norm += value * value
    norm = Math.sqrt(norm)
    if (norm > 0) {
      for (let i = 0; i < vector.length; i++) vector[i] /= norm
    }
    return vector
  }
}
