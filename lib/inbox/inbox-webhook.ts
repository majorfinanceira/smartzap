/**
 * T046-T048: Inbox Webhook Integration
 * Handles inbox-related webhook events:
 * - T046: Persist inbound messages to inbox_messages
 * - T047: Trigger AI processing when mode = 'bot'
 * - T048: Update delivery status in inbox_messages
 */

import { getSupabaseAdmin } from '@/lib/supabase'
import { normalizePhoneNumber } from '@/lib/phone-formatter'
import { inboxDb } from './inbox-db'
import {
  scheduleWithDebounce,
  cancelDebounce,
  processChatAgent,
} from '@/lib/ai/agents/chat-agent'
import { sendWhatsAppMessage } from '@/lib/whatsapp-send'
import type {
  ConversationMode,
  InboxConversation,
  InboxMessage,
  AIAgent,
} from '@/types'

// =============================================================================
// Types
// =============================================================================

export interface InboundMessagePayload {
  /** WhatsApp message ID */
  messageId: string
  /** Sender phone number (raw format from webhook) */
  from: string
  /** Message type (text, image, interactive, etc) */
  type: string
  /** Text content (extracted from various message formats) */
  text: string
  /** Raw message timestamp from Meta */
  timestamp?: string
  /** Media URL if applicable */
  mediaUrl?: string | null
  /** Phone number ID that received the message */
  phoneNumberId?: string
}

export interface StatusUpdatePayload {
  /** WhatsApp message ID */
  messageId: string
  /** Status (sent, delivered, read, failed) */
  status: 'sent' | 'delivered' | 'read' | 'failed'
  /** Timestamp from webhook */
  timestamp?: string
  /** Error details if failed */
  errors?: Array<{ code: number; title: string; message?: string }>
}

// =============================================================================
// Inbound Message Handler (T046)
// =============================================================================

/**
 * Process an inbound message and persist to inbox
 * Creates conversation if needed, adds message, triggers AI if mode=bot
 */
export async function handleInboundMessage(
  payload: InboundMessagePayload
): Promise<{
  conversationId: string
  messageId: string
  triggeredAI: boolean
}> {
  // Note: We use inboxDb which uses getSupabaseAdmin() internally
  const normalizedPhone = normalizePhoneNumber(payload.from)

  // 1. Get or create conversation
  let conversation = await inboxDb.findConversationByPhone(normalizedPhone)

  if (!conversation) {
    // Create new conversation
    const contactId = await findContactId(normalizedPhone)
    conversation = await inboxDb.createConversation({
      phone: normalizedPhone,
      contact_id: contactId || undefined,
      mode: 'bot', // Default to bot mode for new conversations
    })
  } else if (conversation.status === 'closed') {
    // Reopen closed conversation on new inbound message
    await inboxDb.updateConversation(conversation.id, { status: 'open' })
  }

  // 2. Create inbox message
  const message = await inboxDb.createMessage({
    conversation_id: conversation.id,
    direction: 'inbound',
    content: payload.text || `[${payload.type}]`,
    message_type: mapMessageType(payload.type),
    whatsapp_message_id: payload.messageId || undefined,
    media_url: payload.mediaUrl || undefined,
    delivery_status: 'delivered', // Inbound messages are already delivered
    payload: {
      raw_type: payload.type,
      timestamp: payload.timestamp,
      phone_number_id: payload.phoneNumberId,
    },
  })

  // 3. Trigger AI processing if mode is 'bot' and automation is not paused (T066)
  let triggeredAI = false
  if (conversation.mode === 'bot') {
    // T066: Check if automation is paused
    if (isAutomationPaused(conversation.automation_paused_until)) {
      console.log(
        `[Inbox] Automation paused until ${conversation.automation_paused_until}, skipping AI processing`
      )
    } else {
      triggeredAI = await triggerAIProcessing(conversation, message)
    }
  }

  return {
    conversationId: conversation.id,
    messageId: message.id,
    triggeredAI,
  }
}

// =============================================================================
// AI Processing Trigger (T047)
// =============================================================================

/**
 * Trigger AI agent processing with debounce
 * Uses scheduleWithDebounce to wait for message bursts
 */
async function triggerAIProcessing(
  conversation: InboxConversation,
  message: InboxMessage
): Promise<boolean> {
  // Get the AI agent assigned to this conversation (or default)
  const agent = await getAIAgentForConversation(conversation.id)
  if (!agent) {
    console.log('[Inbox] No AI agent configured, skipping AI processing')
    return false
  }

  // Check if agent is active
  if (!agent.is_active) {
    console.log('[Inbox] AI agent is not active, skipping')
    return false
  }

  // Schedule with debounce (default 5s = 5000ms)
  const debounceMs = agent.debounce_ms || 5000
  const debounceSec = debounceMs / 1000

  console.log(
    `[Inbox] Scheduling AI response for conversation ${conversation.id} with ${debounceSec}s debounce`
  )

  // Don't await - let it run in background
  scheduleWithDebounce(conversation.id, message.id, debounceSec).then(
    async (accumulatedMessageIds) => {
      try {
        await processAIResponse(conversation, agent, accumulatedMessageIds)
      } catch (error) {
        console.error('[Inbox] AI processing failed:', error)
      }
    }
  )

  return true
}

/**
 * Process AI response after debounce
 * IMPORTANT: This runs in BACKGROUND after debounce, so we must NOT use
 * createClient() which calls cookies() - it hangs outside request context.
 * Use getSupabaseAdmin() or inboxDb (which uses admin internally) instead.
 */
async function processAIResponse(
  conversation: InboxConversation,
  agent: AIAgent,
  messageIds: string[]
): Promise<void> {
  // Refresh conversation state (might have changed during debounce)
  const currentConversation = await inboxDb.getConversation(conversation.id)
  if (!currentConversation) {
    console.log('[Inbox] Conversation deleted during debounce, aborting AI processing')
    return
  }

  // Check if mode changed during debounce
  if (currentConversation.mode !== 'bot') {
    console.log('[Inbox] Conversation mode changed to human, aborting AI processing')
    return
  }

  // T066: Check if automation was paused during debounce
  if (isAutomationPaused(currentConversation.automation_paused_until)) {
    console.log(
      `[Inbox] Automation paused during debounce until ${currentConversation.automation_paused_until}, aborting AI processing`
    )
    return
  }

  // Get recent messages for context
  const { messages } = await inboxDb.listMessages(conversation.id, { limit: 20 })

  // Process with support agent V2 (AI SDK v6 patterns)
  const result = await processChatAgent({
    agent,
    conversation: currentConversation,
    messages,
  })

  if (result.success && result.response) {
    // Send response via WhatsApp
    const sendResult = await sendWhatsAppMessage({
      to: conversation.phone,
      type: 'text',
      text: result.response.message,
    })

    if (sendResult.success && sendResult.messageId) {
      // Create outbound message in inbox
      await inboxDb.createMessage({
        conversation_id: conversation.id,
        direction: 'outbound',
        content: result.response.message,
        message_type: 'text',
        whatsapp_message_id: sendResult.messageId,
        delivery_status: 'sent',
        ai_response_id: result.logId || null,
        ai_sentiment: result.response.sentiment,
        ai_sources: result.response.sources || null,
      })
    }

    // Handle handoff if needed
    if (result.response.shouldHandoff) {
      await handleAIHandoff(
        currentConversation,
        result.response.handoffReason,
        result.response.handoffSummary
      )
    }
  } else if (result.response) {
    // Error but we have a fallback response (auto-handoff)
    const sendResult = await sendWhatsAppMessage({
      to: conversation.phone,
      type: 'text',
      text: result.response.message,
    })

    if (sendResult.success && sendResult.messageId) {
      await inboxDb.createMessage({
        conversation_id: conversation.id,
        direction: 'outbound',
        content: result.response.message,
        message_type: 'text',
        whatsapp_message_id: sendResult.messageId,
        delivery_status: 'sent',
        ai_response_id: result.logId || null,
      })
    }

    // Auto-handoff on error
    await handleAIHandoff(
      currentConversation,
      result.response.handoffReason || result.error,
      result.response.handoffSummary
    )
  }
}

/**
 * Handle AI handoff to human
 * Switches conversation mode and creates internal note
 */
async function handleAIHandoff(
  conversation: InboxConversation,
  reason?: string,
  summary?: string
): Promise<void> {
  console.log(
    `[Inbox] AI handoff for conversation ${conversation.id}: ${reason}`
  )

  // Switch to human mode
  await inboxDb.updateConversation(conversation.id, { mode: 'human' })

  // Cancel any pending debounce
  cancelDebounce(conversation.id)

  // Create internal note about handoff
  await inboxDb.createMessage({
    conversation_id: conversation.id,
    direction: 'outbound',
    content: `🤖 **Transferência para atendente**\n\n${reason ? `**Motivo:** ${reason}\n` : ''}${summary ? `**Resumo:** ${summary}` : ''}`,
    message_type: 'internal_note',
    delivery_status: 'delivered',
    payload: {
      type: 'ai_handoff',
      reason,
      summary,
      timestamp: new Date().toISOString(),
    },
  })
}

// =============================================================================
// Delivery Status Handler (T048)
// =============================================================================

/**
 * Update message delivery status in inbox
 */
export async function handleDeliveryStatus(
  payload: StatusUpdatePayload
): Promise<boolean> {
  const supabase = getSupabaseAdmin()
  if (!supabase) {
    console.error('[Inbox] Supabase admin client not available')
    return false
  }

  // Find message by WhatsApp message ID
  const { data: message, error } = await supabase
    .from('inbox_messages')
    .select('id, conversation_id, delivery_status')
    .eq('whatsapp_message_id', payload.messageId)
    .single()

  if (error || !message) {
    // Message not found in inbox - might be from campaigns
    return false
  }

  // Update delivery status
  const updates: Record<string, unknown> = {
    delivery_status: payload.status,
  }

  // Add timestamp fields
  if (payload.status === 'delivered') {
    updates.delivered_at = payload.timestamp || new Date().toISOString()
  } else if (payload.status === 'read') {
    updates.read_at = payload.timestamp || new Date().toISOString()
  } else if (payload.status === 'failed') {
    updates.failed_at = payload.timestamp || new Date().toISOString()
    if (payload.errors?.[0]) {
      updates.failure_reason = `[${payload.errors[0].code}] ${payload.errors[0].title}`
    }
  }

  const { error: updateError } = await supabase
    .from('inbox_messages')
    .update(updates)
    .eq('id', message.id)

  if (updateError) {
    console.error('[Inbox] Failed to update delivery status:', updateError)
    return false
  }

  return true
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Find contact ID by phone number
 */
async function findContactId(phone: string): Promise<string | null> {
  const supabase = getSupabaseAdmin()
  if (!supabase) {
    console.error('[Inbox] Supabase admin client not available')
    return null
  }

  const { data } = await supabase
    .from('contacts')
    .select('id')
    .eq('phone', phone)
    .single()

  return data?.id || null
}

/**
 * Check if AI agents are globally enabled
 * Returns true if enabled (default), false if disabled
 */
async function isAIAgentsGloballyEnabled(): Promise<boolean> {
  const supabase = getSupabaseAdmin()
  if (!supabase) return true // Default to enabled if no supabase

  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'ai_agents_global_enabled')
    .single()

  if (error || !data) return true // Default to enabled
  return data.value !== 'false'
}

/**
 * Get AI agent for conversation
 * First checks global toggle, then conversation assignment, then default agent
 */
async function getAIAgentForConversation(
  conversationId: string
): Promise<AIAgent | null> {
  const supabase = getSupabaseAdmin()
  if (!supabase) {
    console.error('[Inbox] Supabase admin client not available')
    return null
  }

  // Check global toggle first
  const isEnabled = await isAIAgentsGloballyEnabled()
  if (!isEnabled) {
    console.log('[Inbox] AI agents globally disabled, skipping')
    return null
  }

  // Check if conversation has an assigned agent
  const { data: conversation } = await supabase
    .from('inbox_conversations')
    .select('ai_agent_id')
    .eq('id', conversationId)
    .single()

  if (conversation?.ai_agent_id) {
    const { data: agent } = await supabase
      .from('ai_agents')
      .select('*')
      .eq('id', conversation.ai_agent_id)
      .single()

    return agent as AIAgent | null
  }

  // Fall back to default active agent
  const { data: defaultAgent } = await supabase
    .from('ai_agents')
    .select('*')
    .eq('is_active', true)
    .eq('is_default', true)
    .single()

  return defaultAgent as AIAgent | null
}

/**
 * Map WhatsApp message types to inbox message types
 */
function mapMessageType(waType: string): InboxMessage['message_type'] {
  const typeMap: Record<string, InboxMessage['message_type']> = {
    text: 'text',
    image: 'image',
    audio: 'audio',
    video: 'video',
    document: 'document',
    template: 'template',
    interactive: 'interactive',
    button: 'interactive',
    location: 'text',
    contacts: 'text',
    sticker: 'image',
  }

  return typeMap[waType] || 'text'
}

/**
 * T066: Check if automation is paused for a conversation
 * Returns true if pause timestamp exists and is in the future
 */
function isAutomationPaused(pausedUntil: string | null | undefined): boolean {
  if (!pausedUntil) return false
  const pauseTime = new Date(pausedUntil).getTime()
  const now = Date.now()
  return pauseTime > now
}
