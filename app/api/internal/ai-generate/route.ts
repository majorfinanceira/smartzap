/**
 * Internal AI Generate Endpoint
 *
 * Este endpoint é chamado via context.call() pelo Upstash Workflow.
 * Tem maxDuration de 60s para permitir processamento de IA mais longo.
 *
 * NÃO deve ser chamado diretamente - use o workflow!
 */

import { type NextRequest, NextResponse } from 'next/server'
import { processChatAgent } from '@/lib/ai/agents/chat-agent'
import type { AIAgent, InboxConversation, InboxMessage } from '@/types'

// Permite até 60 segundos de execução (requer Vercel Pro)
export const maxDuration = 60

// Desabilita cache
export const dynamic = 'force-dynamic'

// =============================================================================
// Types
// =============================================================================

interface AIGenerateRequest {
  agent: AIAgent
  conversation: InboxConversation
  messages: InboxMessage[]
}

interface AIGenerateResponse {
  success: boolean
  message?: string
  sentiment?: 'positive' | 'neutral' | 'negative' | 'frustrated'
  shouldHandoff?: boolean
  handoffReason?: string
  handoffSummary?: string
  sources?: Array<{ title: string; content: string }>
  logId?: string
  error?: string
}

// =============================================================================
// POST Handler
// =============================================================================

export async function POST(req: NextRequest): Promise<NextResponse<AIGenerateResponse>> {
  const startTime = Date.now()

  try {
    // Valida API key interna (proteção básica)
    const authHeader = req.headers.get('authorization')
    const expectedKey = process.env.SMARTZAP_API_KEY

    if (!expectedKey || authHeader !== `Bearer ${expectedKey}`) {
      console.error('[ai-generate] Unauthorized request')
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Parse request body
    const body = (await req.json()) as AIGenerateRequest
    const { agent, conversation, messages } = body

    // Validação básica
    if (!agent || !conversation || !messages) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: agent, conversation, messages' },
        { status: 400 }
      )
    }

    console.log(
      `[ai-generate] Processing: agent=${agent.name}, conversation=${conversation.id}, messages=${messages.length}`
    )

    // Processa com IA
    const result = await processChatAgent({
      agent,
      conversation,
      messages,
    })

    const elapsed = Date.now() - startTime
    console.log(`[ai-generate] Completed in ${elapsed}ms, success=${result.success}`)

    // Retorna resultado
    return NextResponse.json({
      success: result.success,
      message: result.response?.message,
      sentiment: result.response?.sentiment,
      shouldHandoff: result.response?.shouldHandoff,
      handoffReason: result.response?.handoffReason,
      handoffSummary: result.response?.handoffSummary,
      sources: result.response?.sources,
      logId: result.logId,
      error: result.error,
    })
  } catch (error) {
    const elapsed = Date.now() - startTime
    console.error(`[ai-generate] Error after ${elapsed}ms:`, error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    )
  }
}
