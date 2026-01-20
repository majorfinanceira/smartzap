/**
 * Support Agent V2 - RAG com pgvector
 *
 * Usa RAG próprio com Supabase pgvector em vez do Google File Search.
 * Isso permite usar `messages[]` normalmente (o File Search só funcionava com `prompt` string).
 *
 * Fluxo:
 * 1. Se tem knowledge base, busca contexto relevante via pgvector
 * 2. Injeta contexto no system prompt
 * 3. Usa generateText com messages[] + respond tool
 */

import { z } from 'zod'
import { getSupabaseAdmin } from '@/lib/supabase'
import type { AIAgent, InboxConversation, InboxMessage } from '@/types'

// NOTE: AI dependencies are imported DYNAMICALLY inside processSupportAgentV2
// This is required because static imports can cause issues when called from
// background contexts (like debounced webhook handlers)

// =============================================================================
// Types
// =============================================================================

export interface SupportAgentConfig {
  agent: AIAgent
  conversation: InboxConversation
  messages: InboxMessage[]
}

export interface SupportAgentResult {
  success: boolean
  response?: SupportResponse
  error?: string
  latencyMs: number
  logId?: string
}

// =============================================================================
// Response Schema
// =============================================================================

const supportResponseSchema = z.object({
  message: z.string().describe('A resposta para enviar ao usuário'),
  sentiment: z
    .enum(['positive', 'neutral', 'negative', 'frustrated'])
    .describe('Sentimento detectado na mensagem do usuário'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('Nível de confiança na resposta (0 = incerto, 1 = certo)'),
  shouldHandoff: z
    .boolean()
    .describe('Se deve transferir para um atendente humano'),
  handoffReason: z
    .string()
    .optional()
    .describe('Motivo da transferência para humano'),
  handoffSummary: z
    .string()
    .optional()
    .describe('Resumo da conversa para o atendente'),
  sources: z
    .array(
      z.object({
        title: z.string(),
        content: z.string(),
      })
    )
    .optional()
    .describe('Fontes utilizadas para gerar a resposta'),
})

export type SupportResponse = z.infer<typeof supportResponseSchema>

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_MODEL_ID = 'gemini-2.5-flash'
const DEFAULT_TEMPERATURE = 0.7
const DEFAULT_MAX_TOKENS = 2048

// =============================================================================
// Helpers
// =============================================================================

function convertToAIMessages(
  messages: InboxMessage[]
): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages
    .filter((m) => m.message_type !== 'internal_note')
    .map((m) => ({
      role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.content,
    }))
}


async function persistAILog(data: {
  conversationId: string
  agentId: string
  messageIds: string[]
  input: string
  output: SupportResponse | null
  latencyMs: number
  error: string | null
  modelUsed: string
}): Promise<string | undefined> {
  try {
    const supabase = getSupabaseAdmin()
    if (!supabase) {
      console.error('[support-agent] Supabase admin client not available')
      return undefined
    }
    const { data: log, error } = await supabase
      .from('ai_agent_logs')
      .insert({
        conversation_id: data.conversationId,
        ai_agent_id: data.agentId,
        input_message: data.input,
        output_message: data.output?.message || null,
        response_time_ms: data.latencyMs,
        model_used: data.modelUsed,
        tokens_used: null,
        sources_used: data.output?.sources || null,
        error_message: data.error,
        metadata: {
          messageIds: data.messageIds,
          sentiment: data.output?.sentiment,
          confidence: data.output?.confidence,
          shouldHandoff: data.output?.shouldHandoff,
          handoffReason: data.output?.handoffReason,
        },
      })
      .select('id')
      .single()

    if (error) {
      console.error('[support-agent] Failed to persist log:', error)
      return undefined
    }
    return log?.id
  } catch (err) {
    console.error('[support-agent] Log error:', err)
    return undefined
  }
}

// =============================================================================
// Main Function
// =============================================================================

export async function processSupportAgentV2(
  config: SupportAgentConfig
): Promise<SupportAgentResult> {
  const { agent, conversation, messages } = config
  const startTime = Date.now()

  // Dynamic imports - required for background execution context
  const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
  const { generateText, tool } = await import('ai')
  const { withDevTools } = await import('@/lib/ai/devtools')
  const {
    findRelevantContent,
    hasIndexedContent,
    buildEmbeddingConfigFromAgent,
    buildRerankConfigFromAgent,
  } = await import('@/lib/ai/rag-store')

  // Get API key from database only (never use env vars for multi-tenant SaaS)
  const supabase = getSupabaseAdmin()
  if (!supabase) {
    return {
      success: false,
      error: 'Database connection not available',
      latencyMs: Date.now() - startTime,
    }
  }

  const { data: geminiSetting } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'gemini_api_key')
    .maybeSingle()

  const apiKey = geminiSetting?.value
  if (!apiKey) {
    return {
      success: false,
      error: 'API key não configurada. Configure em Configurações > IA.',
      latencyMs: Date.now() - startTime,
    }
  }

  // Setup
  const lastUserMessage = messages.filter((m) => m.direction === 'inbound').slice(-1)[0]
  const inputText = lastUserMessage?.content || ''
  const messageIds = messages.map((m) => m.id)
  const aiMessages = convertToAIMessages(messages.slice(-10))

  const google = createGoogleGenerativeAI({ apiKey })
  const modelId = agent.model || DEFAULT_MODEL_ID
  const baseModel = google(modelId)
  const model = await withDevTools(baseModel, { name: `agente:${agent.name}` })

  // Check if agent has indexed content in pgvector
  const hasKnowledgeBase = await hasIndexedContent(agent.id)

  console.log(`[support-agent] Processing: model=${modelId}, hasKnowledgeBase=${hasKnowledgeBase}`)
  console.log(`[support-agent] Total messages received: ${messages.length}`)
  console.log(`[support-agent] Last user message: "${inputText.slice(0, 100)}..."`)

  let response: SupportResponse | undefined
  let error: string | null = null
  let sources: Array<{ title: string; content: string }> | undefined

  try {
    // Build system prompt - inject RAG context if available
    let systemPrompt = agent.system_prompt

    if (hasKnowledgeBase) {
      // =======================================================================
      // WITH KNOWLEDGE BASE: Search pgvector for relevant context
      // =======================================================================
      console.log(`[support-agent] Searching knowledge base for: "${inputText.slice(0, 100)}..."`)

      const ragStartTime = Date.now()

      // Build embedding config from agent settings
      const embeddingConfig = buildEmbeddingConfigFromAgent(agent, apiKey)

      // Build rerank config if enabled
      const rerankConfig = await buildRerankConfigFromAgent(agent)

      // Search for relevant content
      const relevantContent = await findRelevantContent({
        agentId: agent.id,
        query: inputText,
        embeddingConfig,
        rerankConfig,
        topK: agent.rag_max_results || 5,
        threshold: agent.rag_similarity_threshold || 0.5,
      })

      console.log(`[support-agent] RAG search completed in ${Date.now() - ragStartTime}ms`)
      console.log(`[support-agent] Found ${relevantContent.length} relevant chunks`)

      if (relevantContent.length > 0) {
        // Inject context into system prompt
        const contextText = relevantContent
          .map((r, i) => `[Fonte ${i + 1}]: ${r.content}`)
          .join('\n\n')

        systemPrompt = `${agent.system_prompt}

---
CONTEXTO DA BASE DE CONHECIMENTO (use estas informações para responder):
${contextText}
---

IMPORTANTE: Se a pergunta do usuário puder ser respondida usando o contexto acima, use-o. Se não encontrar a informação no contexto, responda com base no seu conhecimento geral, mas indique quando não tiver certeza.`

        // Track sources for logging
        sources = relevantContent.map((r, i) => ({
          title: `Fonte ${i + 1}`,
          content: r.content.slice(0, 200) + '...',
        }))

        console.log(`[support-agent] Injected ${relevantContent.length} sources into system prompt`)
      } else {
        console.log(`[support-agent] No relevant content found, using base system prompt`)
      }
    }

    // =======================================================================
    // GENERATE RESPONSE: Always use messages[] with respond tool
    // =======================================================================
    console.log(`[support-agent] Generating response with respond tool`)

    const respondTool = tool({
      description: 'Envia uma resposta estruturada ao usuário.',
      inputSchema: supportResponseSchema,
      execute: async (params) => {
        response = {
          ...params,
          sources: sources || params.sources,
        }
        return params
      },
    })

    await generateText({
      model,
      system: systemPrompt,
      messages: aiMessages,
      tools: { respond: respondTool },
      toolChoice: 'required',
      temperature: agent.temperature ?? DEFAULT_TEMPERATURE,
      maxOutputTokens: agent.max_tokens ?? DEFAULT_MAX_TOKENS,
    })

    if (!response) {
      throw new Error('No response generated')
    }

    console.log(`[support-agent] Response generated: "${response.message.slice(0, 100)}..."`)

  } catch (err) {
    error = err instanceof Error ? err.message : 'Unknown error'
    console.error('[support-agent] Error:', error)
  }

  const latencyMs = Date.now() - startTime

  // Success case
  if (response) {
    const logId = await persistAILog({
      conversationId: conversation.id,
      agentId: agent.id,
      messageIds,
      input: inputText,
      output: response,
      latencyMs,
      error: null,
      modelUsed: modelId,
    })

    return { success: true, response, latencyMs, logId }
  }

  // Error case - auto handoff
  const handoffResponse: SupportResponse = {
    message: 'Desculpe, estou com dificuldades técnicas. Vou transferir você para um atendente.',
    sentiment: 'neutral',
    confidence: 0,
    shouldHandoff: true,
    handoffReason: `Erro técnico: ${error}`,
    handoffSummary: `Erro durante processamento. Última mensagem: "${inputText.slice(0, 200)}"`,
  }

  const logId = await persistAILog({
    conversationId: conversation.id,
    agentId: agent.id,
    messageIds,
    input: inputText,
    output: handoffResponse,
    latencyMs,
    error,
    modelUsed: modelId,
  })

  return {
    success: false,
    response: handoffResponse,
    error: error || 'Unknown error',
    latencyMs,
    logId,
  }
}
