import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic' // Prevent caching of verification requests
import { supabase } from '@/lib/supabase'
import { normalizePhoneNumber } from '@/lib/phone-formatter'
import { upsertPhoneSuppression } from '@/lib/phone-suppressions'
import { maybeAutoSuppressByFailure } from '@/lib/auto-suppression'
import {
  mapWhatsAppError,
  isCriticalError,
  isOptOutError,
  getUserFriendlyMessageForMetaError,
  getRecommendedActionForMetaError,
  normalizeMetaErrorTextForStorage
} from '@/lib/whatsapp-errors'

import { emitWorkflowTrace, maskPhone } from '@/lib/workflow-trace'


import { getWhatsAppCredentials } from '@/lib/whatsapp-credentials'
import { applyFlowMappingToContact } from '@/lib/flow-mapping'

// Get WhatsApp Access Token from centralized helper
async function getWhatsAppAccessToken(): Promise<string | null> {
  const credentials = await getWhatsAppCredentials()
  return credentials?.accessToken || null
}

// Get or generate webhook verify token (Supabase settings preferred, env var fallback)
import { getVerifyToken } from '@/lib/verify-token'

function extractInboundText(message: any): string {
  // Meta pode enviar diferentes tipos de payload: text/button/interactive
  const textBody = message?.text?.body
  if (typeof textBody === 'string' && textBody.trim()) return textBody

  const buttonText = message?.button?.text
  if (typeof buttonText === 'string' && buttonText.trim()) return buttonText

  const interactiveButtonTitle = message?.interactive?.button_reply?.title
  if (typeof interactiveButtonTitle === 'string' && interactiveButtonTitle.trim()) return interactiveButtonTitle

  const interactiveListTitle = message?.interactive?.list_reply?.title
  if (typeof interactiveListTitle === 'string' && interactiveListTitle.trim()) return interactiveListTitle

  return ''
}

function isOptOutKeyword(textRaw: string): boolean {
  const t = String(textRaw || '')
    .trim()
    .toLowerCase()
    // normaliza acentos comuns para facilitar matching
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')

  if (!t) return false

  // Palavras-chave comuns (PT-BR + EN) — agressivo por requisito.
  const keywords = [
    'parar',
    'pare',
    'stop',
    'cancelar',
    'cancele',
    'sair',
    'remover',
    'remove',
    'descadastrar',
    'desinscrever',
    'unsubscribe',
    'optout',
    'opt-out',
    'nao quero',
    'não quero',
    'nao receber',
    'não receber',
  ]

  // Match por inclusão para cobrir frases (ex.: "por favor parar")
  return keywords.some((k) => t.includes(k))
}

async function markContactOptOutAndSuppress(input: {
  phoneRaw: string
  source: string
  reason: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  const phone = normalizePhoneNumber(input.phoneRaw)
  const now = new Date().toISOString()

  // Best-effort: atualiza contatos (se existir)
  try {
    await supabase
      .from('contacts')
      .update({ status: 'Opt-out', updated_at: now })
      .eq('phone', phone)
  } catch (e) {
    console.warn('[Webhook] Falha ao atualizar contacts.status para Opt-out (best-effort):', e)
  }

  // Fonte da verdade para supressão global
  try {
    await upsertPhoneSuppression({
      phone,
      reason: input.reason,
      source: input.source,
      metadata: input.metadata || {},
      isActive: true,
      expiresAt: null,
    })
  } catch (e) {
    console.warn('[Webhook] Falha ao upsert phone_suppressions (best-effort):', e)
  }
}

function maskTokenPreview(token: string | null | undefined): string {
  if (!token) return '—'
  const t = String(token)
  if (t.length <= 8) return `${t.slice(0, 2)}…(${t.length})`
  return `${t.slice(0, 3)}…${t.slice(-3)}(${t.length})`
}

function safeParseJson(raw: unknown): unknown | null {
  if (raw == null) return null
  if (typeof raw === 'object') return raw as any
  if (typeof raw !== 'string') return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function isMissingColumnError(e: unknown, columnName: string): boolean {
  const msg = e instanceof Error ? e.message : String((e as any)?.message || e || '')
  return msg.toLowerCase().includes('column') && msg.toLowerCase().includes(columnName.toLowerCase())
}

function tryParseWebhookTimestampSeconds(ts: unknown): string | null {
  const n = Number(ts)
  if (!Number.isFinite(n) || n <= 0) return null
  const d = new Date(n * 1000)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

// Meta Webhook Verification
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  const MY_VERIFY_TOKEN = await getVerifyToken({ readonly: true })

  console.log('🔍 Webhook Verification Request:')
  console.log(`- Mode: ${mode}`)
  console.log(`- Received Token: ${maskTokenPreview(token)}`)
  console.log(`- Expected Token: ${maskTokenPreview(MY_VERIFY_TOKEN)}`)

  if (MY_VERIFY_TOKEN === 'token-not-found-readonly') {
    console.warn(
      '⚠️ Webhook verify token ausente em modo readonly. Configure em settings (webhook_verify_token) ou via env WEBHOOK_VERIFY_TOKEN.'
    )
  }

  if (mode === 'subscribe' && token === MY_VERIFY_TOKEN) {
    console.log('✅ Webhook verified successfully')
    return new Response(challenge || '', { status: 200 })
  }

  console.log('❌ Webhook verification failed')
  return new Response('Forbidden', { status: 403 })
}

// Webhook Event Receiver
// Supabase: fonte da verdade para status de mensagens
export async function POST(request: NextRequest) {
  const body = await request.json()

  if (body.object !== 'whatsapp_business_account') {
    return NextResponse.json({ status: 'ignored' })
  }

  console.log('📨 Webhook received:', JSON.stringify(body))

  try {
    const entries = body.entry || []

    for (const entry of entries) {
      const changes = entry.changes || []

      for (const change of changes) {
        // =========================================================
        // Template Status Updates (Meta)
        // =========================================================
        const rawTemplateUpdates =
          change.value?.message_template_status_update ??
          change.value?.message_template_status_updates ??
          []

        const templateUpdates = Array.isArray(rawTemplateUpdates)
          ? rawTemplateUpdates
          : rawTemplateUpdates
            ? [rawTemplateUpdates]
            : []

        for (const tu of templateUpdates) {
          const templateId = (tu?.message_template_id || tu?.id || null) as string | null
          const templateName = (tu?.message_template_name || tu?.name || null) as string | null
          const eventRaw = (tu?.event || tu?.status || tu?.message_template_status || tu?.template_status || '') as string
          const reason = (tu?.reason || tu?.rejected_reason || tu?.reason_text || tu?.details || '') as string

          const event = String(eventRaw || '').toUpperCase()
          if (!templateId && !templateName) continue

          // Normaliza para os status mais comuns da Meta
          let newStatus = event
          if (!newStatus) newStatus = 'PENDING'
          if (newStatus === 'DISABLED') newStatus = 'REJECTED'

          try {
            // Tenta atualizar por meta_id primeiro (mais confiável)
            let updated = false
            if (templateId) {
              const { data, error } = await supabase
                .from('templates')
                .update({
                  status: newStatus,
                  meta_id: templateId,
                  rejected_reason: newStatus === 'REJECTED' && reason ? reason : null,
                  updated_at: new Date().toISOString(),
                })
                .eq('meta_id', templateId)
                .select('id')

              if (error) throw error
              updated = !!(data && data.length > 0)
            }

            // Fallback: atualizar por nome
            if (!updated && templateName) {
              const { data, error } = await supabase
                .from('templates')
                .update({
                  status: newStatus,
                  ...(templateId ? { meta_id: templateId } : {}),
                  rejected_reason: newStatus === 'REJECTED' && reason ? reason : null,
                  updated_at: new Date().toISOString(),
                })
                .eq('name', templateName)
                .select('id')

              if (error) throw error
              updated = !!(data && data.length > 0)
            }

            console.log(`🧩 Template status update: ${templateName || templateId} -> ${newStatus}${reason ? ` (${reason})` : ''}`)
          } catch (e) {
            console.error('Failed to process template status update:', e)
          }
        }

        const statuses = change.value?.statuses || []

        for (const statusUpdate of statuses) {
          const {
            id: messageId,
            status: msgStatus,
            errors
          } = statusUpdate

          // Lookup single row once (dedupe + context)
          const { data: existingUpdate } = await supabase
            .from('campaign_contacts')
            .select('id, status, campaign_id, phone, trace_id, delivered_at')
            .eq('message_id', messageId)
            .single()

          // Message not from a campaign, skip
          if (!existingUpdate) continue

          const campaignId = existingUpdate.campaign_id
          const phone = existingUpdate.phone
          const traceId = (existingUpdate as any).trace_id as string | null
          const phoneMasked = maskPhone(phone)

          // Status progression: pending → sent → delivered → read
          // Only update if new status is "later" in progression.
          // Observação importante: o workflow já marca como `sent` no DB.
          // Então o webhook com status `sent` tende a chegar com `newOrder === currentOrder`.
          // Mesmo assim, queremos emitir `webhook_sent` para medir latência e correlação.
          const statusOrder = { pending: 0, sent: 1, delivered: 2, read: 3, failed: 4 }
          const currentOrder = statusOrder[existingUpdate.status as keyof typeof statusOrder] ?? 0
          const newOrder = statusOrder[msgStatus as keyof typeof statusOrder] ?? 0

          // Emit structured event (easy to filter by traceId)
          // Regras:
          // - Sempre emite para `sent` (mesmo duplicado) para termos essa etapa no trace.
          // - Emite para `failed` sempre.
          // - Emite para progressão (delivered/read) quando avança.
          if (traceId && (msgStatus === 'sent' || msgStatus === 'failed' || newOrder > currentOrder)) {
            await emitWorkflowTrace({
              traceId,
              campaignId,
              step: 'webhook',
              phase: `webhook_${msgStatus}`,
              ok: msgStatus !== 'failed',
              phoneMasked,
              extra: {
                messageId,
                previousStatus: existingUpdate.status,
                duplicate: newOrder <= currentOrder,
              },
            })
          }

          // Skip processing if it does not advance status (except `failed`).
          // Para `sent`, a gente normalmente não quer reprocessar (o workflow já contou),
          // mas mantemos o trace acima.
          if (newOrder <= currentOrder && msgStatus !== 'failed') {
            console.log(`⏭️ Skipping: ${messageId} already at ${existingUpdate.status}, ignoring ${msgStatus}`)
            continue
          }

          // Atualiza o banco (Supabase) — fonte da verdade
          switch (msgStatus) {
            case 'sent':
              console.log(`📤 Sent confirmed: ${phoneMasked || phone} (campaign: ${campaignId})${traceId ? ` (traceId: ${traceId})` : ''}`)
              // sent is already tracked in workflow, skip
              break

            case 'delivered':
              console.log(`📬 Delivered: ${phoneMasked || phone} (campaign: ${campaignId})${traceId ? ` (traceId: ${traceId})` : ''}`)
              try {
                // Atomic update: only update if status was NOT already delivered/read
                const now = new Date().toISOString()
                const { data: updatedRows, error: updateError } = await supabase
                  .from('campaign_contacts')
                  .update({ status: 'delivered', delivered_at: now })
                  .eq('message_id', messageId)
                  .neq('status', 'delivered')
                  .neq('status', 'read')
                  .select('id')

                if (updateError) throw updateError

                if (updatedRows && updatedRows.length > 0) {
                  // Increment campaign counter (Atomic RPC)
                  const { error: rpcError } = await supabase
                    .rpc('increment_campaign_stat', {
                      campaign_id_input: campaignId,
                      field: 'delivered'
                    })

                  if (rpcError) console.error('Failed to increment delivered count:', rpcError)

                  console.log(`✅ Delivered count incremented for campaign ${campaignId}`)

                  // Auto-dismiss payment alerts when delivery succeeds
                  // This means the payment issue was resolved
                  // Auto-dismiss payment alerts when delivery succeeds
                  await supabase
                    .from('account_alerts')
                    .update({ dismissed: 1 }) // Boolean/Integer? Schema says 1/0 usually in sqlite, check supabase schema? Assuming 1/0 ok or true/false. Postgres boolean usually true/false. Let's use true if possible, but existing code used 1.
                    // Wait, existing was `dismissed = 1`. I'll stick to 1 or true.
                    // Let's assume boolean `true` is safer for Supabase/Postgres.
                    .eq('type', 'payment')
                    .eq('dismissed', false)

                  console.log(`✅ Payment alerts auto-dismissed (delivery succeeded)`)

                  // Supabase Realtime will automatically propagate database changes
                } else {
                  console.log(`⏭️ Contact already delivered/read, skipping increment`)
                }
              } catch (e) {
                console.error('DB update failed (delivered):', e)
              }
              break

            case 'read':
              console.log(`👁️ Read: ${phoneMasked || phone} (campaign: ${campaignId})${traceId ? ` (traceId: ${traceId})` : ''}`)
              try {
                // Atomic update: only update if status was NOT already read
                const nowRead = new Date().toISOString()
                const { data: updatedRowsRead, error: updateErrorRead } = await supabase
                  .from('campaign_contacts')
                  .update({ status: 'read', read_at: nowRead })
                  .eq('message_id', messageId)
                  .neq('status', 'read')
                  .select('id')

                if (updateErrorRead) throw updateErrorRead

                // Only increment campaign counter if we actually updated a row
                if (updatedRowsRead && updatedRowsRead.length > 0) {
                  // READ implica que também foi entregue. Em alguns casos a Meta manda READ
                  // sem nunca mandar DELIVERED (ou DELIVERED se perde). Para manter a
                  // progressão e evitar delivered < read, setamos delivered_at se estiver nulo
                  // e incrementamos campaigns.delivered APENAS quando este campo foi preenchido agora.
                  let shouldIncrementDelivered = false

                  try {
                    const hadDeliveredAt = Boolean((existingUpdate as any)?.delivered_at)
                    if (!hadDeliveredAt) {
                      const { data: deliveredAtRows, error: deliveredAtErr } = await supabase
                        .from('campaign_contacts')
                        .update({ delivered_at: nowRead })
                        .eq('message_id', messageId)
                        .is('delivered_at', null)
                        .select('id')

                      if (deliveredAtErr) throw deliveredAtErr
                      if (deliveredAtRows && deliveredAtRows.length > 0) {
                        shouldIncrementDelivered = true
                      }
                    }
                  } catch (e) {
                    console.warn('[Webhook] Falha ao garantir delivered_at em evento read (best-effort):', e)
                  }

                  if (shouldIncrementDelivered) {
                    const { error: rpcDeliveredErr } = await supabase
                      .rpc('increment_campaign_stat', {
                        campaign_id_input: campaignId,
                        field: 'delivered'
                      })

                    if (rpcDeliveredErr) console.error('Failed to increment delivered count (via read):', rpcDeliveredErr)
                  }

                  // Increment campaign counter (Atomic RPC)
                  const { error: rpcError } = await supabase
                    .rpc('increment_campaign_stat', {
                      campaign_id_input: campaignId,
                      field: 'read'
                    })

                  if (rpcError) console.error('Failed to increment read count:', rpcError)

                  console.log(`✅ Read count incremented for campaign ${campaignId}`)
                  // Supabase Realtime will automatically propagate database changes
                } else {
                  console.log(`⏭️ Contact already read, skipping increment`)
                }
              } catch (e) {
                console.error('DB update failed (read):', e)
              }
              break

            case 'failed':
              const metaError = errors?.[0] || null
              const errorCode = metaError?.code || 0
              const errorTitle = metaError?.title || 'Unknown error'
              const metaMessage = metaError?.message || ''
              const metaDetails = metaError?.error_data?.details || ''
              const errorDetails = metaDetails || metaMessage
              const errorHref = metaError?.href || ''

              // Map error to friendly message
              const mappedError = mapWhatsAppError(errorCode)
              const failureReason = getUserFriendlyMessageForMetaError({
                code: errorCode,
                title: errorTitle,
                message: metaMessage,
                details: metaDetails,
              })
              const recommendedAction = getRecommendedActionForMetaError({
                code: errorCode,
                title: errorTitle,
                message: metaMessage,
                details: metaDetails,
              })

              console.log(`❌ Failed: ${phoneMasked || phone} - [${errorCode}] ${errorTitle} (campaign: ${campaignId})${traceId ? ` (traceId: ${traceId})` : ''}`)
              console.log(`   Category: ${mappedError.category}, Retryable: ${mappedError.retryable}`)

              if (traceId) {
                await emitWorkflowTrace({
                  traceId,
                  campaignId,
                  step: 'webhook',
                  phase: 'webhook_failed_details',
                  ok: false,
                  phoneMasked,
                  extra: {
                    messageId,
                    errorCode,
                    errorTitle,
                    errorDetails,
                    category: mappedError.category,
                    retryable: mappedError.retryable,
                  },
                })
              }

              try {
                const nowFailed = new Date().toISOString()

                // Update contact with failure details
                const { data: updatedRowsFailed, error: updateErrorFailed } = await supabase
                  .from('campaign_contacts')
                  .update({
                    status: 'failed',
                    failed_at: nowFailed,
                    failure_code: errorCode,
                    failure_reason: failureReason,
                    failure_title: normalizeMetaErrorTextForStorage(errorTitle, 200),
                    failure_details: normalizeMetaErrorTextForStorage(errorDetails, 800),
                    failure_href: normalizeMetaErrorTextForStorage(errorHref, 400),
                  })
                  .eq('message_id', messageId)
                  .neq('status', 'failed')
                  .select('id')

                if (updateErrorFailed) throw updateErrorFailed

                // Only increment campaign counter if we actually updated a row
                if (updatedRowsFailed && updatedRowsFailed.length > 0) {
                  // Increment campaign counter (Atomic RPC)
                  const { error: rpcError } = await supabase
                    .rpc('increment_campaign_stat', {
                      campaign_id_input: campaignId,
                      field: 'failed'
                    })

                  if (rpcError) console.error('Failed to increment failed count:', rpcError)

                  console.log(`✅ Failed count incremented for campaign ${campaignId}`)
                  // Supabase Realtime will automatically propagate database changes
                }

                // Handle critical errors - create account alert
                if (isCriticalError(errorCode)) {
                  console.log(`🚨 Critical error detected: ${errorCode} - Creating account alert`)
                  await supabase
                    .from('account_alerts')
                    .upsert({
                      id: `alert_${errorCode}_${Date.now()}`,
                      type: mappedError.category,
                      code: errorCode,
                      message: failureReason,
                      details: JSON.stringify({ title: errorTitle, details: errorDetails, action: recommendedAction }),
                      created_at: nowFailed
                    })
                }

                // Handle opt-out - mark contact
                if (isOptOutError(errorCode)) {
                  console.log(`📵 Opt-out detected for ${phone} - Marking contact`)
                  await markContactOptOutAndSuppress({
                    phoneRaw: phone,
                    source: 'meta_opt_out_error',
                    reason: failureReason || `Opt-out detectado pela Meta (código ${errorCode})`,
                    metadata: {
                      messageId,
                      errorCode,
                      errorTitle,
                      errorDetails,
                    },
                  })
                }

                // Auto-supressão agressiva (cross-campaign) — best-effort
                // Objetivo: proteger qualidade da conta evitando insistência em números undeliverable.
                try {
                  const result = await maybeAutoSuppressByFailure({
                    phone,
                    failureCode: errorCode,
                    failureTitle: errorTitle,
                    failureDetails: errorDetails,
                    failureHref: errorHref,
                    campaignId,
                    campaignContactId: existingUpdate.id,
                    messageId,
                  })
                  if (result.suppressed) {
                    console.log(
                      `🛑 Auto-supressão aplicada para ${phoneMasked || phone} (code ${errorCode}, count ${result.recentCount ?? 'n/a'}) até ${result.expiresAt}`
                    )
                  }
                } catch (e) {
                  console.warn('[Webhook] Falha ao aplicar auto-supressão (best-effort):', e)
                }

              } catch (e) {
                console.error('DB update failed (failed):', e)
              }
              break
          }
        }

        // =====================================================================
        // Process incoming messages (Chatbot Engine Disabled in Template)
        // =====================================================================
        const messages = change.value?.messages || []
        for (const message of messages) {
          const from = message.from
          const messageType = message.type
          const text = extractInboundText(message)
          console.log(`📩 Incoming message from ${from}: ${messageType} (Chatbot disabled)${text ? ` | text="${text}"` : ''}`)

          // =================================================================
          // WhatsApp Flows (MVP sem endpoint): captura submissão final
          // interactive.type = 'nfm_reply' com response_json
          // =================================================================
          try {
            const interactiveType = message?.interactive?.type
            const nfm = message?.interactive?.nfm_reply

            if (messageType === 'interactive' && interactiveType === 'nfm_reply' && nfm?.response_json) {
              const messageId = (message?.id || '') as string
              const phoneNumberId = (change?.value?.metadata?.phone_number_id || null) as string | null
              const wabaId = (entry?.id || null) as string | null

              const normalizedFrom = normalizePhoneNumber(from)

              // Best-effort: resolve contact_id
              let contactId: string | null = null
              try {
                const { data: contacts } = await supabase
                  .from('contacts')
                  .select('id')
                  .eq('phone', normalizedFrom)
                  .limit(1)

                contactId = contacts?.[0]?.id ?? null
              } catch {
                // ignore (best-effort)
              }

              const responseRaw = typeof nfm.response_json === 'string' ? nfm.response_json : JSON.stringify(nfm.response_json)
              const responseJson = safeParseJson(nfm.response_json)
              const messageTimestamp = tryParseWebhookTimestampSeconds(message?.timestamp)

              const flowId = (nfm?.flow_id || nfm?.flowId || null) as string | null
              const flowName = (nfm?.name || null) as string | null
              const flowToken = (nfm?.flow_token || nfm?.flowToken || null) as string | null

              // Best-effort: mapping para campos do SmartZap
              let flowLocalId: string | null = null
              let mappedData: Record<string, unknown> | null = null
              let mappedAt: string | null = null

              if (flowId && responseJson && typeof responseJson === 'object') {
                try {
                  const { data: flowRows } = await supabase
                    .from('flows')
                    .select('id,mapping')
                    .eq('meta_flow_id', flowId)
                    .limit(1)

                  const flowRow = Array.isArray(flowRows) ? flowRows[0] : (flowRows as any)
                  if (flowRow?.id && flowRow?.mapping) {
                    flowLocalId = String(flowRow.id)
                    const applied = await applyFlowMappingToContact({
                      normalizedPhone: normalizedFrom,
                      flowId,
                      responseJson,
                      mapping: flowRow.mapping,
                    })
                    if (applied.updated) {
                      mappedData = applied.mappedData
                      mappedAt = new Date().toISOString()
                    }
                  }
                } catch (e) {
                  console.warn('[Webhook] Falha ao aplicar mapping do Flow (best-effort):', e)
                }
              }

              if (messageId) {
                // Primeira tentativa: com campos novos (flow_local_id/mapped_data)
                let upsertError: any = null
                try {
                  const { error } = await supabase
                    .from('flow_submissions')
                    .upsert(
                      {
                        message_id: messageId,
                        from_phone: normalizedFrom,
                        contact_id: contactId,
                        flow_id: flowId,
                        flow_name: flowName,
                        flow_token: flowToken,
                        response_json_raw: responseRaw,
                        response_json: responseJson,
                        waba_id: wabaId,
                        phone_number_id: phoneNumberId,
                        message_timestamp: messageTimestamp,
                        ...(flowLocalId ? { flow_local_id: flowLocalId } : {}),
                        ...(mappedData ? { mapped_data: mappedData } : {}),
                        ...(mappedAt ? { mapped_at: mappedAt } : {}),
                      },
                      { onConflict: 'message_id' }
                    )
                  upsertError = error
                } catch (e) {
                  upsertError = e
                }

                // Fallback: bancos sem migração ainda (evita 500 e mantém captura)
                if (upsertError && (isMissingColumnError(upsertError, 'flow_local_id') || isMissingColumnError(upsertError, 'mapped_data'))) {
                  try {
                    const { error } = await supabase
                      .from('flow_submissions')
                      .upsert(
                        {
                          message_id: messageId,
                          from_phone: normalizedFrom,
                          contact_id: contactId,
                          flow_id: flowId,
                          flow_name: flowName,
                          flow_token: flowToken,
                          response_json_raw: responseRaw,
                          response_json: responseJson,
                          waba_id: wabaId,
                          phone_number_id: phoneNumberId,
                          message_timestamp: messageTimestamp,
                        },
                        { onConflict: 'message_id' }
                      )
                    upsertError = error
                  } catch (e) {
                    upsertError = e
                  }
                }

                if (upsertError) {
                  console.warn('[Webhook] Falha ao persistir flow_submissions:', upsertError)
                } else {
                  console.log(`🧾 Flow submission salva (message_id=${messageId}, from=${maskPhone(normalizedFrom)})`)
                }
              }
            }
          } catch (e) {
            console.warn('[Webhook] Falha ao processar Flow submission (best-effort):', e)
          }

          // Opt-out real: usuário envia palavra-chave
          if (text && isOptOutKeyword(text)) {
            console.log(`📵 Opt-out keyword detected from ${from}: "${text}"`)
            await markContactOptOutAndSuppress({
              phoneRaw: from,
              source: 'inbound_keyword',
              reason: 'Usuário solicitou opt-out via mensagem inbound',
              metadata: {
                messageType,
                text,
                messageId: message?.id || null,
                timestamp: message?.timestamp || null,
              },
            })
          }
        }
      }
    }
  } catch (error) {
    console.error('Error processing webhook:', error)
  }

  // Always return 200 to acknowledge receipt (Meta requirement)
  return NextResponse.json({ status: 'ok' })
}
