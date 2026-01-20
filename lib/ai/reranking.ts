/**
 * AI Reranking - Opcional para melhorar precisão do RAG
 *
 * Reranking é uma etapa opcional que reordena os resultados da busca
 * por similaridade usando um modelo de reranking.
 *
 * Quando usar:
 * - Knowledge base grande (100+ documentos)
 * - Queries complexas ou ambíguas
 * - Alta precisão necessária
 *
 * Quando NÃO usar:
 * - Knowledge base pequena (poucos documentos)
 * - Queries simples e diretas
 * - Latência crítica (adiciona 200-500ms)
 *
 * Providers suportados: Cohere, Together.ai
 */

import { rerank } from 'ai'

// =============================================================================
// Types
// =============================================================================

export type RerankProvider = 'cohere' | 'together'

export interface RerankConfig {
  provider: RerankProvider
  model: string
  apiKey: string
  topK?: number
}

export interface RerankResult {
  content: string
  score: number
  originalIndex: number
  metadata?: Record<string, unknown>
}

// Provider info para UI
export interface RerankProviderInfo {
  id: RerankProvider
  name: string
  models: Array<{
    id: string
    name: string
    description: string
    pricePerMillion: number
  }>
}

// =============================================================================
// Provider Configurations (para UI)
// =============================================================================

export const RERANK_PROVIDERS: RerankProviderInfo[] = [
  {
    id: 'cohere',
    name: 'Cohere',
    models: [
      {
        id: 'rerank-v3.5',
        name: 'Rerank v3.5',
        description: 'Melhor qualidade, suporte multilíngue',
        pricePerMillion: 0.05,
      },
      {
        id: 'rerank-english-v3.0',
        name: 'Rerank English v3',
        description: 'Otimizado para inglês',
        pricePerMillion: 0.05,
      },
      {
        id: 'rerank-multilingual-v3.0',
        name: 'Rerank Multilingual v3',
        description: 'Suporte a múltiplos idiomas',
        pricePerMillion: 0.05,
      },
    ],
  },
  {
    id: 'together',
    name: 'Together.ai',
    models: [
      {
        id: 'Salesforce/Llama-Rank-v1',
        name: 'Llama Rank v1',
        description: 'Baseado no Llama, bom custo-benefício',
        pricePerMillion: 0.1,
      },
    ],
  },
]

// =============================================================================
// Provider Factory
// =============================================================================

/**
 * Cria o modelo de reranking apropriado baseado no provider configurado
 */
async function getRerankModel(config: RerankConfig) {
  switch (config.provider) {
    case 'cohere': {
      const { createCohere } = await import('@ai-sdk/cohere')
      const cohere = createCohere({ apiKey: config.apiKey })
      return cohere.rerank(config.model)
    }

    case 'together': {
      const { createTogetherAI } = await import('@ai-sdk/togetherai')
      const together = createTogetherAI({ apiKey: config.apiKey })
      return together.rerank(config.model)
    }

    default:
      throw new Error(`Unsupported rerank provider: ${config.provider}`)
  }
}

// =============================================================================
// Rerank Function
// =============================================================================

/**
 * Reordena documentos por relevância usando modelo de reranking
 *
 * @param query - Query do usuário
 * @param documents - Documentos retornados pela busca de similaridade
 * @param config - Configuração do provider de reranking
 * @returns Documentos reordenados por relevância
 */
export async function rerankDocuments(
  query: string,
  documents: Array<{ content: string; metadata?: Record<string, unknown> }>,
  config: RerankConfig
): Promise<RerankResult[]> {
  if (documents.length === 0) {
    return []
  }

  const model = await getRerankModel(config)
  const topK = config.topK ?? 5

  const { results } = await rerank({
    model,
    query,
    documents: documents.map((d) => d.content),
    topK: Math.min(topK, documents.length),
  })

  // Mapeia resultados de volta com metadados originais
  return results.map((r) => ({
    content: r.document,
    score: r.relevanceScore,
    originalIndex: r.index,
    metadata: documents[r.index]?.metadata,
  }))
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Valida se config de reranking é válida
 */
export function validateRerankConfig(config: Partial<RerankConfig>): string | null {
  if (!config.provider) {
    return 'Provider de reranking não configurado'
  }

  if (!config.model) {
    return 'Modelo de reranking não configurado'
  }

  if (!config.apiKey) {
    return 'API key de reranking não configurada'
  }

  const provider = RERANK_PROVIDERS.find((p) => p.id === config.provider)
  if (!provider) {
    return `Provider de reranking "${config.provider}" não suportado`
  }

  const model = provider.models.find((m) => m.id === config.model)
  if (!model) {
    return `Modelo "${config.model}" não encontrado para provider "${config.provider}"`
  }

  return null
}

/**
 * Verifica se reranking está habilitado e configurado corretamente
 */
export function isRerankEnabled(config: {
  rerank_enabled?: boolean
  rerank_provider?: string | null
  rerank_model?: string | null
}): boolean {
  return !!(
    config.rerank_enabled &&
    config.rerank_provider &&
    config.rerank_model
  )
}
