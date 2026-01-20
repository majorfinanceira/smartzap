/**
 * AI Embeddings - Multi-Provider Factory
 *
 * Gera embeddings vetoriais para RAG usando o Vercel AI SDK.
 * Suporta múltiplos providers: Google, OpenAI, Voyage, Cohere.
 *
 * O usuário escolhe o provider na config do agente.
 * Default: Google gemini-embedding-001 (768 dimensões, $0.025/1M tokens)
 */

import { embed, embedMany } from 'ai'
import type { EmbeddingModel } from 'ai'

// =============================================================================
// Types
// =============================================================================

export type EmbeddingProvider = 'google' | 'openai' | 'voyage' | 'cohere'

export interface EmbeddingConfig {
  provider: EmbeddingProvider
  model: string
  dimensions: number
  apiKey: string
}

// Provider info para UI de seleção
export interface EmbeddingProviderInfo {
  id: EmbeddingProvider
  name: string
  models: Array<{
    id: string
    name: string
    dimensions: number
    pricePerMillion: number
  }>
}

// =============================================================================
// Provider Configurations (para UI)
// =============================================================================

export const EMBEDDING_PROVIDERS: EmbeddingProviderInfo[] = [
  {
    id: 'google',
    name: 'Google',
    models: [
      { id: 'gemini-embedding-001', name: 'Gemini Embedding 001', dimensions: 768, pricePerMillion: 0.025 },
      { id: 'text-embedding-004', name: 'Text Embedding 004', dimensions: 768, pricePerMillion: 0.025 },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    models: [
      { id: 'text-embedding-3-large', name: 'Text Embedding 3 Large', dimensions: 3072, pricePerMillion: 0.13 },
      { id: 'text-embedding-3-small', name: 'Text Embedding 3 Small', dimensions: 1536, pricePerMillion: 0.02 },
    ],
  },
  {
    id: 'voyage',
    name: 'Voyage AI',
    models: [
      { id: 'voyage-3.5', name: 'Voyage 3.5', dimensions: 1024, pricePerMillion: 0.06 },
      { id: 'voyage-3.5-lite', name: 'Voyage 3.5 Lite', dimensions: 512, pricePerMillion: 0.02 },
    ],
  },
  {
    id: 'cohere',
    name: 'Cohere',
    models: [
      { id: 'embed-multilingual-v3.0', name: 'Embed Multilingual v3', dimensions: 1024, pricePerMillion: 0.1 },
      { id: 'embed-english-v3.0', name: 'Embed English v3', dimensions: 1024, pricePerMillion: 0.1 },
    ],
  },
]

// =============================================================================
// Default Configuration
// =============================================================================

export const DEFAULT_EMBEDDING_CONFIG: Omit<EmbeddingConfig, 'apiKey'> = {
  provider: 'google',
  model: 'gemini-embedding-001',
  dimensions: 768,
}

// =============================================================================
// Provider Factory
// =============================================================================

/**
 * Cria o modelo de embedding apropriado baseado no provider configurado
 */
async function getEmbeddingModel(config: EmbeddingConfig): Promise<EmbeddingModel<string>> {
  switch (config.provider) {
    case 'google': {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
      const google = createGoogleGenerativeAI({ apiKey: config.apiKey })
      return google.textEmbeddingModel(config.model)
    }

    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai')
      const openai = createOpenAI({ apiKey: config.apiKey })
      return openai.textEmbeddingModel(config.model)
    }

    case 'voyage': {
      // Voyage usa um provider community - precisa instalar: npm install voyage-ai-provider
      const { createVoyage } = await import('voyage-ai-provider')
      const voyage = createVoyage({ apiKey: config.apiKey })
      return voyage.textEmbeddingModel(config.model)
    }

    case 'cohere': {
      const { createCohere } = await import('@ai-sdk/cohere')
      const cohere = createCohere({ apiKey: config.apiKey })
      return cohere.textEmbeddingModel(config.model)
    }

    default:
      throw new Error(`Unsupported embedding provider: ${config.provider}`)
  }
}

/**
 * Retorna opções específicas do provider para otimização
 * - Google: outputDimensionality e taskType (RETRIEVAL_QUERY vs RETRIEVAL_DOCUMENT)
 * - Voyage: inputType (query vs document) e outputDimension
 */
function getProviderOptions(
  config: EmbeddingConfig,
  taskType: 'query' | 'document'
): Record<string, unknown> {
  switch (config.provider) {
    case 'google':
      return {
        google: {
          outputDimensionality: config.dimensions,
          taskType: taskType === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
        },
      }

    case 'voyage':
      return {
        voyage: {
          inputType: taskType,
          outputDimension: config.dimensions,
        },
      }

    case 'cohere':
      return {
        cohere: {
          inputType: taskType === 'query' ? 'search_query' : 'search_document',
        },
      }

    default:
      return {}
  }
}

// =============================================================================
// Embedding Functions
// =============================================================================

/**
 * Gera embedding para um único texto
 *
 * @param text - Texto para gerar embedding
 * @param config - Configuração do provider
 * @param taskType - 'query' para buscas, 'document' para indexação
 */
export async function generateEmbedding(
  text: string,
  config: EmbeddingConfig,
  taskType: 'query' | 'document' = 'query'
): Promise<number[]> {
  const model = await getEmbeddingModel(config)

  const { embedding } = await embed({
    model,
    value: text,
    experimental_telemetry: { isEnabled: false },
    ...getProviderOptions(config, taskType),
  })

  return embedding
}

/**
 * Gera embeddings para múltiplos textos (batch)
 * Mais eficiente que chamar generateEmbedding em loop
 *
 * @param texts - Array de textos
 * @param config - Configuração do provider
 * @param taskType - 'query' para buscas, 'document' para indexação
 */
export async function generateEmbeddings(
  texts: string[],
  config: EmbeddingConfig,
  taskType: 'query' | 'document' = 'document'
): Promise<number[][]> {
  const model = await getEmbeddingModel(config)

  const { embeddings } = await embedMany({
    model,
    values: texts,
    experimental_telemetry: { isEnabled: false },
    ...getProviderOptions(config, taskType),
  })

  return embeddings
}

// =============================================================================
// Chunking
// =============================================================================

const DEFAULT_CHUNK_SIZE = 1000
const DEFAULT_CHUNK_OVERLAP = 200
const MIN_CHUNK_LENGTH = 50

export interface ChunkingOptions {
  /** Tamanho máximo de cada chunk em caracteres (default: 1000) */
  chunkSize?: number
  /** Sobreposição entre chunks em caracteres (default: 200) */
  chunkOverlap?: number
  /** Tamanho mínimo de chunk para ser incluído (default: 50) */
  minChunkLength?: number
}

/**
 * Divide texto em chunks para indexação
 *
 * Usa chunking simples por caracteres com overlap.
 * Para casos mais avançados, considere semantic chunking ou RecursiveCharacterTextSplitter.
 */
export function chunkText(text: string, options: ChunkingOptions = {}): string[] {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE
  const chunkOverlap = options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP
  const minChunkLength = options.minChunkLength ?? MIN_CHUNK_LENGTH

  // Normaliza whitespace
  const normalizedText = text.replace(/\s+/g, ' ').trim()

  if (normalizedText.length <= chunkSize) {
    return normalizedText.length >= minChunkLength ? [normalizedText] : []
  }

  const chunks: string[] = []
  let start = 0

  while (start < normalizedText.length) {
    let end = Math.min(start + chunkSize, normalizedText.length)

    // Tenta terminar em um limite de palavra ou frase
    if (end < normalizedText.length) {
      // Procura por quebra natural (., !, ?, \n) nos últimos 100 caracteres
      const searchStart = Math.max(end - 100, start)
      const lastSentenceEnd = Math.max(
        normalizedText.lastIndexOf('. ', end),
        normalizedText.lastIndexOf('! ', end),
        normalizedText.lastIndexOf('? ', end),
        normalizedText.lastIndexOf('\n', end)
      )

      if (lastSentenceEnd > searchStart) {
        end = lastSentenceEnd + 1
      } else {
        // Se não encontrou quebra de frase, tenta quebra de palavra
        const lastSpace = normalizedText.lastIndexOf(' ', end)
        if (lastSpace > searchStart) {
          end = lastSpace
        }
      }
    }

    const chunk = normalizedText.slice(start, end).trim()

    if (chunk.length >= minChunkLength) {
      chunks.push(chunk)
    }

    // Move start considerando overlap
    start = end - chunkOverlap
    if (start < 0) start = 0

    // Evita loop infinito
    if (start >= normalizedText.length - chunkOverlap) {
      break
    }
  }

  return chunks
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Converte embedding para formato pgvector
 */
export function toPgVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}

/**
 * Valida se config de embedding é válida
 */
export function validateEmbeddingConfig(config: Partial<EmbeddingConfig>): string | null {
  if (!config.provider) {
    return 'Provider de embedding não configurado'
  }

  if (!config.model) {
    return 'Modelo de embedding não configurado'
  }

  if (!config.dimensions || config.dimensions <= 0) {
    return 'Dimensões de embedding inválidas'
  }

  if (!config.apiKey) {
    return 'API key não configurada'
  }

  const provider = EMBEDDING_PROVIDERS.find((p) => p.id === config.provider)
  if (!provider) {
    return `Provider "${config.provider}" não suportado`
  }

  const model = provider.models.find((m) => m.id === config.model)
  if (!model) {
    return `Modelo "${config.model}" não encontrado para provider "${config.provider}"`
  }

  return null
}

/**
 * Obtém dimensões padrão para um modelo
 */
export function getModelDimensions(provider: EmbeddingProvider, model: string): number | null {
  const providerInfo = EMBEDDING_PROVIDERS.find((p) => p.id === provider)
  const modelInfo = providerInfo?.models.find((m) => m.id === model)
  return modelInfo?.dimensions ?? null
}
