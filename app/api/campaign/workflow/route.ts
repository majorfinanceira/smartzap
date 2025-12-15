import { serve } from '@upstash/workflow/nextjs'
import { campaignDb, templateDb } from '@/lib/supabase-db'
import { supabase } from '@/lib/supabase'
import { CampaignStatus, ContactStatus } from '@/types'
import { getUserFriendlyMessageForMetaError, normalizeMetaErrorTextForStorage } from '@/lib/whatsapp-errors'
import { buildMetaTemplatePayload, precheckContactForTemplate } from '@/lib/whatsapp/template-contract'
import { emitWorkflowTrace, maskPhone, timePhase } from '@/lib/workflow-trace'
import { createRateLimiter } from '@/lib/rate-limiter'
import { recordStableBatch, recordThroughputExceeded, getAdaptiveThrottleConfigWithSource, getAdaptiveThrottleState } from '@/lib/whatsapp-adaptive-throttle'
import { normalizePhoneNumber } from '@/lib/phone-formatter'
import { getActiveSuppressionsByPhone } from '@/lib/phone-suppressions'
import { maybeAutoSuppressByFailure } from '@/lib/auto-suppression'
import { createCampaignProgressBroadcaster, broadcastCampaignPhase } from '@/lib/realtime-broadcast-server'
import { createHash } from 'crypto'

function hashConfig(input: unknown): string {
  // Observação: o objetivo é agrupar configs; não precisamos de criptografia forte aqui.
  // JSON.stringify é estável o suficiente porque este objeto tem chaves fixas.
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 16)
}

interface Contact {
  contactId: string
  phone: string
  name: string
  custom_fields?: Record<string, unknown>
  email?: string
}

interface CampaignWorkflowInput {
  campaignId: string
  traceId?: string
  templateName: string
  contacts: Contact[]
  templateVariables?: { header: string[], body: string[], buttons?: Record<string, string> }  // Meta API structure
  templateSnapshot?: {
    name: string
    language?: string
    parameter_format?: 'positional' | 'named'
    spec_hash?: string | null
    fetched_at?: string | null
    components?: any
  }
  phoneNumberId: string
  accessToken: string
  isResend?: boolean
}

async function claimPendingForSend(
  campaignId: string,
  identifiers: { contactId: string; phone: string },
  traceId?: string
): Promise<string | null> {
  const now = new Date().toISOString()
  const query = supabase
    .from('campaign_contacts')
    .update({ status: 'sending', sending_at: now, trace_id: traceId || null })
    .eq('campaign_id', campaignId)
    .eq('status', 'pending')
    .eq('contact_id', identifiers.contactId)
    .select('id')

  const { data, error } = await query

  if (error) {
    console.warn(
      `[Workflow] Falha ao claimar contato ${identifiers.phone} (seguindo sem enviar):`,
      error
    )
    return null
  }
  const claimed = Array.isArray(data) && data.length > 0
  return claimed ? now : null
}

async function bulkClaimPendingForSend(
  campaignId: string,
  contacts: Array<{ contactId: string }>,
  traceId?: string
): Promise<{ claimedAt: string | null; claimedIds: Set<string> }> {
  const ids = Array.from(
    new Set(
      (contacts || [])
        .map((c) => String(c.contactId || '').trim())
        .filter(Boolean)
    )
  )

  if (ids.length === 0) return { claimedAt: null, claimedIds: new Set() }

  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('campaign_contacts')
    .update({ status: 'sending', sending_at: now, trace_id: traceId || null })
    .eq('campaign_id', campaignId)
    .eq('status', 'pending')
    .in('contact_id', ids)
    .select('contact_id')

  if (error) {
    console.warn('[Workflow] Falha no bulk claim pending->sending (seguindo sem enviar):', error)
    return { claimedAt: null, claimedIds: new Set() }
  }

  const claimedIds = new Set<string>((data || []).map((r: any) => String(r.contact_id)))
  return { claimedAt: claimedIds.size > 0 ? now : null, claimedIds }
}

/**
 * Build template body parameters
 * {{1}} = contact name (dynamic per contact)
 * {{2}}, {{3}}, ... = static values from templateVariables
 */
function buildBodyParameters(contactName: string, templateVariables: string[] = []): Array<{ type: string; text: string }> {
  // First parameter is always the contact name
  const parameters = [{ type: 'text', text: contactName || 'Cliente' }]

  // Add static variables for {{2}}, {{3}}, etc.
  for (const value of templateVariables) {
    parameters.push({ type: 'text', text: value || '' })
  }

  return parameters
}

// Atualiza status do contato no banco (Supabase)
async function updateContactStatus(
  campaignId: string,
  identifiers: { contactId: string; phone: string },
  status: 'sent' | 'failed' | 'skipped',
  opts?: {
    messageId?: string
    error?: string
    errorCode?: number
    errorTitle?: string
    errorDetails?: string
    errorFbtraceId?: string
    errorSubcode?: number
    errorHref?: string
    skipCode?: string
    skipReason?: string
    traceId?: string
  }
) {
  try {
    const now = new Date().toISOString()
    const update: any = {
      status,
    }

    // Correlation id for tracing across dispatch/workflow/webhook
    if (opts?.traceId) {
      update.trace_id = opts.traceId
    }

    if (status === 'sent') {
      update.sent_at = now
      update.message_id = opts?.messageId || null
      update.error = null
      update.skip_code = null
      update.skip_reason = null
      update.skipped_at = null
    }

    if (status === 'failed') {
      update.failed_at = now
      update.error = opts?.error || null

      // Colunas próprias (quando temos contexto estruturado)
      if (typeof opts?.errorCode === 'number') update.failure_code = opts.errorCode
      if (typeof opts?.errorTitle === 'string') update.failure_title = normalizeMetaErrorTextForStorage(opts.errorTitle, 200)
      if (typeof opts?.errorDetails === 'string') update.failure_details = normalizeMetaErrorTextForStorage(opts.errorDetails, 800)
      if (typeof opts?.errorFbtraceId === 'string') update.failure_fbtrace_id = normalizeMetaErrorTextForStorage(opts.errorFbtraceId, 200)
      if (typeof opts?.errorSubcode === 'number') update.failure_subcode = opts.errorSubcode
      if (typeof opts?.errorHref === 'string') update.failure_href = normalizeMetaErrorTextForStorage(opts.errorHref, 400)

      // failure_reason é usado pela UI e por queries; mantemos alinhado com `error`.
      if (typeof opts?.error === 'string' && opts.error.trim()) {
        update.failure_reason = opts.error
      }
    }

    if (status === 'skipped') {
      update.skipped_at = now
      update.skip_code = opts?.skipCode || null
      update.skip_reason = opts?.skipReason || opts?.error || null
      update.error = null
      update.message_id = null
    }

    const query = supabase
      .from('campaign_contacts')
      .update(update)
      .eq('campaign_id', campaignId)
      .eq('contact_id', identifiers.contactId)

    await query
  } catch (e) {
    console.error(`Failed to update contact status: ${identifiers.phone}`, e)
  }
}

// Upstash Workflow - Durable background processing
// Each step is a separate HTTP request, bypasses Vercel 10s timeout
export const { POST } = serve<CampaignWorkflowInput>(
  async (context) => {
    const { campaignId, templateName, contacts, templateVariables, phoneNumberId, accessToken, templateSnapshot, traceId: incomingTraceId } = context.requestPayload

    const traceId = (incomingTraceId && String(incomingTraceId).trim().length > 0)
      ? String(incomingTraceId).trim()
      : `wf_${campaignId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

    await emitWorkflowTrace({
      traceId,
      campaignId,
      step: 'workflow',
      phase: 'start',
      ok: true,
      extra: {
        contacts: contacts?.length || 0,
        hasTemplateSnapshot: Boolean(templateSnapshot),
        isResend: Boolean((context.requestPayload as any)?.isResend),
      },
    })

    // HARDENING: workflow é estritamente baseado em contact_id.
    // Se vier algum contato sem contactId, é bug no dispatch/resend e devemos falhar cedo.
    const missingContactIds = (contacts || []).filter((c) => !c.contactId || String(c.contactId).trim().length === 0)
    if (missingContactIds.length > 0) {
      const sample = missingContactIds.slice(0, 10).map((c) => ({ phone: c.phone, name: c.name || '' }))
      throw new Error(
        `[Workflow] Payload inválido: ${missingContactIds.length} contato(s) sem contactId. Exemplo: ${JSON.stringify(sample)}`
      )
    }

    // Step 1: Mark campaign as SENDING in Supabase
    await context.run('init-campaign', async () => {
      const nowIso = new Date().toISOString()
      const existing = await campaignDb.getById(campaignId)
      const startedAt = (existing as any)?.startedAt || nowIso

      await campaignDb.updateStatus(campaignId, {
        status: CampaignStatus.SENDING,
        startedAt,
        completedAt: null,
      })

      console.log(`📊 Campaign ${campaignId} started with ${contacts.length} contacts (traceId=${traceId})`)
      console.log(`📝 Template variables: ${JSON.stringify(templateVariables || [])}`)
    })

    // Step 2: Process contacts in smaller batches
    // Each batch is a separate step = separate HTTP request = bypasses 10s limit
    // Observação: cada contato faz múltiplas operações (DB + fetch Meta).
    // Para bater metas agressivas (ex.: “enviar em 1 min”), batch size precisa ser ajustável.
    // Mantemos um default conservador (10) e permitimos tuning via settings/env.
    const cfgForBatching = await getAdaptiveThrottleConfigWithSource().catch(() => null)
    const rawBatchSize = Number(cfgForBatching?.config?.batchSize ?? process.env.WHATSAPP_WORKFLOW_BATCH_SIZE ?? '10')
    const BATCH_SIZE = Number.isFinite(rawBatchSize)
      ? Math.max(1, Math.min(200, Math.floor(rawBatchSize)))
      : 10
    const batches: Contact[][] = []

    for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
      batches.push(contacts.slice(i, i + BATCH_SIZE))
    }

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex]

      await context.run(`send-batch-${batchIndex}`, async () => {
        const step = `send-batch-${batchIndex}`

        let batchOk = true
        let batchError: string | null = null

        await emitWorkflowTrace({
          traceId,
          campaignId,
          step,
          batchIndex,
          phase: 'batch_start',
          ok: true,
          extra: { batchSize: batch.length, batches: batches.length },
        })

        let sentCount = 0
        let failedCount = 0
        let skippedCount = 0
        let firstDispatchAtInBatch: string | null = null
        let lastSentAtInBatch: string | null = null
        let metaTimeMs = 0
        let dbTimeMs = 0

        // Adaptive throttle (global throughput) — state compartilhado via settings.
        // Ajuda a "pisar no acelerador" sem ficar batendo em 130429 o tempo todo.
        const adaptiveCfg = await getAdaptiveThrottleConfigWithSource().catch(() => null)
        const adaptiveConfig = adaptiveCfg?.config || null
        const adaptiveEnabled = Boolean(adaptiveConfig?.enabled)
        let sawThroughput429 = false
        let limiter: ReturnType<typeof createRateLimiter> | null = null

        let targetMpsForBatch: number | null = null
        const floorDelayMs = Number(adaptiveConfig?.sendFloorDelayMs ?? process.env.WHATSAPP_SEND_FLOOR_DELAY_MS ?? '0')

        const rawConcurrency = Number(adaptiveConfig?.sendConcurrency ?? process.env.WHATSAPP_SEND_CONCURRENCY ?? '1')
        const concurrency = Number.isFinite(rawConcurrency)
          ? Math.max(1, Math.min(50, Math.floor(rawConcurrency)))
          : 1

        // Broadcast efêmero de progresso (UI em tempo real) — best-effort.
        // DB continua sendo a fonte da verdade; isto só melhora UX.
        const progress = createCampaignProgressBroadcaster({
          campaignId,
          traceId,
          batchIndex,
          flushIntervalMs: 250,
        })

        try {
          // Sinaliza início do batch para a UI (sem depender de Postgres changes)
          try {
            await broadcastCampaignPhase(campaignId, {
              traceId,
              batchIndex,
              phase: 'batch_start',
            })
          } catch {
            // best-effort
          }

          const template: any = templateSnapshot || (await templateDb.getByName(templateName))
          if (!template) throw new Error(`Template ${templateName} não encontrado no banco local. Sincronize Templates.`)

          // Check pause status once per batch (trade-off: no DB hit per contact)
          const { data: campaignStatusAtBatchStart } = await supabase
            .from('campaigns')
            .select('status')
            .eq('id', campaignId)
            .single()

          if (campaignStatusAtBatchStart?.status === CampaignStatus.PAUSED) {
            console.log(`⏸️ Campaign ${campaignId} is paused, skipping batch ${batchIndex}`)
            return
          }

          if (adaptiveEnabled) {
            const state = await getAdaptiveThrottleState(phoneNumberId)
            limiter = createRateLimiter(state.targetMps)
            targetMpsForBatch = state.targetMps

            await emitWorkflowTrace({
              traceId,
              campaignId,
              step,
              batchIndex,
              phase: 'throttle_state',
              ok: true,
              extra: {
                enabled: true,
                targetMps: state.targetMps,
                cooldownUntil: state.cooldownUntil || null,
              },
            })
          }

          await emitWorkflowTrace({
            traceId,
            campaignId,
            step,
            batchIndex,
            phase: 'batch_config',
            ok: true,
            extra: {
              concurrency,
              batchSize: BATCH_SIZE,
              adaptiveEnabled,
              floorDelayMs,
              turboConfigSource: adaptiveCfg?.source || null,
              turboRawPresent: adaptiveCfg?.rawPresent ?? null,
              batchingConfigSource: cfgForBatching?.source || null,
              batchingRawPresent: cfgForBatching?.rawPresent ?? null,
            },
          })

          // =====================================================================
          // Checagens globais por batch (opt-out + supressões)
          // =====================================================================
          const optOutContactIds = new Set<string>()
          try {
            const ids = Array.from(new Set(batch.map(c => String(c.contactId || '').trim()).filter(Boolean)))
            if (ids.length > 0) {
              const { data: rows, error } = await supabase
                .from('contacts')
                .select('id, status')
                .in('id', ids)

              if (error) throw error
              for (const r of (rows || []) as any[]) {
                if (String(r?.status) === ContactStatus.OPT_OUT) {
                  optOutContactIds.add(String(r.id))
                }
              }
            }
          } catch (e) {
            console.warn('[Workflow] Falha ao carregar contacts.status (best-effort):', e)
          }

          let suppressionsByPhone = new Map<string, { phone: string; reason: string | null; source: string | null }>()
          try {
            const phones = Array.from(new Set(batch.map(c => normalizePhoneNumber(String(c.phone || '').trim())).filter(Boolean)))
            const active = await getActiveSuppressionsByPhone(phones)
            suppressionsByPhone = new Map(
              Array.from(active.entries()).map(([phone, row]) => [phone, { phone, reason: row.reason, source: row.source }])
            )
          } catch (e) {
            console.warn('[Workflow] Falha ao carregar phone_suppressions (best-effort):', e)
          }

          // =====================================================================
          // Bulk claim (pending -> sending) para remover round-trips por contato.
          // A partir daqui, só processamos contatos que foram realmente claimados.
          // =====================================================================
          const claimT0 = Date.now()
          const { claimedAt, claimedIds } = await bulkClaimPendingForSend(
            campaignId,
            batch.map((c) => ({ contactId: String(c.contactId) })),
            traceId
          )
          dbTimeMs += Date.now() - claimT0

          if (claimedAt && !firstDispatchAtInBatch) firstDispatchAtInBatch = claimedAt

          await emitWorkflowTrace({
            traceId,
            campaignId,
            step,
            batchIndex,
            phase: 'db_claim_pending_bulk',
            ok: true,
            ms: Date.now() - claimT0,
            extra: {
              requested: batch.length,
              claimed: claimedIds.size,
            },
          })

          if (claimedIds.size === 0) {
            console.log(`↩️ Idempotência: nenhum contato estava pending no batch ${batchIndex}, pulando.`)
            return
          }

          type ContactWriteOpts = {
            // Timestamp ISO do início do processamento do contato (mantém utilidade de sending_at sem round-trip por contato)
            sendingAt?: string
            messageId?: string
            error?: string
            errorCode?: number
            errorTitle?: string
            errorDetails?: string
            errorFbtraceId?: string
            errorSubcode?: number
            errorHref?: string
            skipCode?: string
            skipReason?: string
            traceId?: string
          }

          type PendingWriteOp = {
            contact: Contact
            status: 'sent' | 'failed' | 'skipped'
            opts?: ContactWriteOpts
          }

          const writeOps: PendingWriteOp[] = []

          const pushWriteOp = (op: PendingWriteOp) => {
            writeOps.push(op)
          }

          const processContact = async (contact: Contact) => {
            // Timestamp do início do processamento (precisa existir mesmo se cair no catch)
            const sendingAtIso = new Date().toISOString()

            try {
              const phoneMasked = maskPhone(contact.phone)

              // Só processa se foi claimado agora (idempotência + retry safe)
              if (!claimedIds.has(String(contact.contactId))) {
                return
              }

              if (limiter) {
                await limiter.acquire()
              }

              // Marca o início do processamento deste contato.
              // Persistimos via bulk upsert para manter a utilidade de `sending_at`
              // sem round-trip por contato.

            // Contrato Ouro: pré-check/guard-rail por contato (documented-only)
            const precheck = precheckContactForTemplate(
              {
                phone: contact.phone,
                name: contact.name,
                email: contact.email,
                custom_fields: contact.custom_fields,
                contactId: contact.contactId || null,
              },
              template as any,
              templateVariables as any
            )

            if (!precheck.ok) {
              pushWriteOp({
                contact,
                status: 'skipped',
                opts: {
                  sendingAt: sendingAtIso,
                  skipCode: precheck.skipCode,
                  skipReason: precheck.reason,
                  traceId,
                },
              })

              await emitWorkflowTrace({
                traceId,
                campaignId,
                step,
                batchIndex,
                contactId: contact.contactId,
                phoneMasked,
                phase: 'precheck_skip',
                ok: true,
                extra: { skipCode: precheck.skipCode, reason: precheck.reason },
              })
              skippedCount++
              progress.bump({ skipped: 1 })
              console.log(`⏭️ Skipped ${contact.phone}: ${precheck.reason}`)
              return
            }

            // Opt-out e supressão global (defensivo: também roda aqui, mesmo que o dispatch tenha filtrado)
            if (optOutContactIds.has(String(contact.contactId))) {
              pushWriteOp({
                contact,
                status: 'skipped',
                opts: {
                  sendingAt: sendingAtIso,
                  skipCode: 'OPT_OUT',
                  skipReason: 'Contato opt-out (não quer receber mensagens).',
                  traceId,
                },
              })

              await emitWorkflowTrace({
                traceId,
                campaignId,
                step,
                batchIndex,
                contactId: contact.contactId,
                phoneMasked,
                phase: 'optout_skip',
                ok: true,
              })

              skippedCount++
              progress.bump({ skipped: 1 })
              console.log(`⏭️ Skipped (opt-out) ${contact.phone}`)
              return
            }

            const suppression = suppressionsByPhone.get(precheck.normalizedPhone)
            if (suppression) {
              pushWriteOp({
                contact,
                status: 'skipped',
                opts: {
                  sendingAt: sendingAtIso,
                  skipCode: 'SUPPRESSED',
                  skipReason: `Telefone suprimido globalmente${suppression.reason ? `: ${suppression.reason}` : ''}`,
                  traceId,
                },
              })

              await emitWorkflowTrace({
                traceId,
                campaignId,
                step,
                batchIndex,
                contactId: contact.contactId,
                phoneMasked,
                phase: 'suppression_skip',
                ok: true,
                extra: { source: suppression.source, reason: suppression.reason },
              })

              skippedCount++
              progress.bump({ skipped: 1 })
              console.log(`⏭️ Skipped (suppressed) ${contact.phone}`)
              return
            }

            // Claim foi feito em bulk no início do batch.

            const whatsappPayload: any = buildMetaTemplatePayload({
              to: precheck.normalizedPhone,
              templateName,
              language: (template as any).language || 'pt_BR',
              parameterFormat: (template as any).parameter_format || (template as any).parameterFormat || 'positional',
              values: precheck.values,
            })

            if (process.env.DEBUG_META_PAYLOAD === '1') {
              console.log('--- META API PAYLOAD (CONTRACT) ---', JSON.stringify(whatsappPayload, null, 2))
            }

            const metaStart = Date.now()

            // Timeout defensivo para não ficar "preso" sem meta_send_ok/meta_send_fail.
            // Ajustável via env; default bem conservador (60s).
            const metaTimeoutMs = Number(process.env.META_FETCH_TIMEOUT_MS || '60000')
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), metaTimeoutMs)

            let response: Response
            let data: any
            try {
              await emitWorkflowTrace({
                traceId,
                campaignId,
                step,
                batchIndex,
                contactId: contact.contactId,
                phoneMasked,
                phase: 'meta_request_start',
                ok: true,
                extra: { timeoutMs: metaTimeoutMs },
              })

              response = await fetch(
                `https://graph.facebook.com/v24.0/${phoneNumberId}/messages`,
                {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify(whatsappPayload),
                  signal: controller.signal,
                }
              )

              data = await response.json()
            } finally {
              clearTimeout(timeout)
            }

            const metaMs = Date.now() - metaStart
            metaTimeMs += metaMs

            if (response.ok && data.messages?.[0]?.id) {
              const messageId = data.messages[0].id

              // Status será persistido em bulk ao final do batch.
              pushWriteOp({
                contact,
                status: 'sent',
                opts: { sendingAt: sendingAtIso, messageId, traceId },
              })

              // Métrica operacional: quando foi o último "sent" (envio/dispatch), sem depender de delivery.
              lastSentAtInBatch = new Date().toISOString()

              await emitWorkflowTrace({
                traceId,
                campaignId,
                step,
                batchIndex,
                contactId: contact.contactId,
                phoneMasked,
                phase: 'meta_send_ok',
                ok: true,
                ms: metaMs,
                extra: { messageId },
              })

              sentCount++
              progress.bump({ sent: 1 })
              console.log(`✅ Sent to ${contact.phone}`)
            } else {
              // Extract error code and translate to Portuguese
              const errorCode = data.error?.code || 0
              const metaTitle = data.error?.error_user_title || data.error?.type || ''
              const metaMessage = data.error?.error_user_msg || data.error?.message || 'Unknown error'
              const metaDetails = data.error?.error_data?.details || ''
              const metaFbtraceId = data.error?.fbtrace_id || ''
              const metaSubcode = typeof data.error?.error_subcode === 'number' ? data.error.error_subcode : undefined
              const metaHref = data.error?.href || ''

              const translatedError = getUserFriendlyMessageForMetaError({
                code: errorCode,
                title: metaTitle,
                message: metaMessage,
                details: metaDetails,
              })

              const errorWithCode = `(#${errorCode}) ${translatedError}`

              // Feedback loop: 130429 = throughput estourado.
              // Reduzimos o alvo e aplicamos um cooldown para não continuar batendo no limite.
              if (adaptiveEnabled && errorCode === 130429 && !sawThroughput429) {
                // Set flag BEFORE awaiting, para evitar múltiplas reduções concorrentes no mesmo batch.
                sawThroughput429 = true
                const update = await recordThroughputExceeded(phoneNumberId)
                if (limiter) {
                  try {
                    limiter.updateRate(update.next.targetMps)
                  } catch {
                    // best-effort
                  }
                }
                await emitWorkflowTrace({
                  traceId,
                  campaignId,
                  step,
                  batchIndex,
                  contactId: contact.contactId,
                  phoneMasked,
                  phase: 'throttle_decrease',
                  ok: true,
                  extra: {
                    errorCode,
                    previousMps: update.previous.targetMps,
                    nextMps: update.next.targetMps,
                    cooldownUntil: update.next.cooldownUntil || null,
                  },
                })
              }

              await emitWorkflowTrace({
                traceId,
                campaignId,
                step,
                batchIndex,
                contactId: contact.contactId,
                phoneMasked,
                phase: 'meta_send_fail',
                ok: false,
                ms: metaMs,
                extra: {
                  status: response.status,
                  errorCode,
                  errorType: data.error?.type,
                  errorSubcode: data.error?.error_subcode,
                  fbtrace_id: data.error?.fbtrace_id,
                },
              })

              // Status será persistido em bulk ao final do batch.
              pushWriteOp({
                contact,
                status: 'failed',
                opts: {
                  sendingAt: sendingAtIso,
                  error: errorWithCode,
                  errorCode,
                  errorTitle: metaTitle || undefined,
                  errorDetails: metaDetails || metaMessage || undefined,
                  errorFbtraceId: metaFbtraceId || undefined,
                  errorSubcode: metaSubcode,
                  errorHref: metaHref || undefined,
                  traceId,
                },
              })

              // Auto-supressão agressiva (cross-campaign) — best-effort
              // Importante: não deve interromper o workflow; serve para proteger qualidade da conta.
              try {
                const result = await maybeAutoSuppressByFailure({
                  phone: contact.phone,
                  failureCode: errorCode,
                  failureTitle: metaTitle || null,
                  failureDetails: (metaDetails || metaMessage) ?? null,
                  failureFbtraceId: metaFbtraceId || null,
                  failureSubcode: typeof metaSubcode === 'number' ? metaSubcode : null,
                  failureHref: metaHref || null,
                  campaignId,
                })
                if (result.suppressed) {
                  await emitWorkflowTrace({
                    traceId,
                    campaignId,
                    step,
                    batchIndex,
                    contactId: contact.contactId,
                    phoneMasked,
                    phase: 'auto_suppressed',
                    ok: true,
                    extra: {
                      failureCode: errorCode,
                      recentCount: result.recentCount ?? null,
                      expiresAt: result.expiresAt ?? null,
                    },
                  })
                }
              } catch (e) {
                console.warn('[Workflow] Falha ao aplicar auto-supressão (best-effort):', e)
              }

              failedCount++
              progress.bump({ failed: 1 })
              console.log(`❌ Failed ${contact.phone}: ${errorWithCode}`)
            }

            // Delay mínimo opcional (deixa desligado por padrão).
            // Observação: com limiter ativo, esse delay não é necessário para throughput,
            // mas pode ser útil para aliviar CPU/logs em bursts.
            if (floorDelayMs > 0) {
              await new Promise(resolve => setTimeout(resolve, floorDelayMs))
            }

            } catch (error) {
              // Update contact status in Supabase
              const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido'
              // Neste ponto, contactId é obrigatório (validado no início)
              const phoneMasked = maskPhone(contact.phone)

              await emitWorkflowTrace({
                traceId,
                campaignId,
                step: `send-batch-${batchIndex}`,
                batchIndex,
                contactId: contact.contactId,
                phoneMasked,
                phase: 'contact_exception',
                ok: false,
                extra: { error: errorMsg },
              })

              pushWriteOp({
                contact,
                status: 'failed',
                opts: {
                  sendingAt: sendingAtIso,
                  error: errorMsg,
                  errorTitle: 'Contact exception',
                  errorDetails: errorMsg,
                  traceId,
                },
              })
              failedCount++
              progress.bump({ failed: 1 })
              console.error(`❌ Error sending to ${contact.phone}:`, error)
            }
          }

          // Pool bounded: N workers que puxam o próximo contato.
          // Default concurrency=1 mantém o comportamento atual (sequencial).
          let nextIndex = 0
          const workerCount = Math.min(concurrency, batch.length)

          const workers = Array.from({ length: workerCount }, () =>
            (async () => {
              while (true) {
                const idx = nextIndex
                nextIndex += 1
                if (idx >= batch.length) return
                await processContact(batch[idx])
              }
            })()
          )

          await Promise.allSettled(workers)

          // Garante que qualquer delta pendente seja publicado antes de finalizar o batch.
          try {
            await progress.flush()
          } catch {
            // best-effort
          }

          // =====================================================================
          // Persistência bulk dos resultados do batch (reduz DB overhead)
          // =====================================================================
          if (writeOps.length > 0) {
            const upsertRows = writeOps.map((op) => {
              const cid = String(op.contact.contactId)
              const base: any = {
                campaign_id: campaignId,
                contact_id: cid,
                trace_id: traceId,
                status: op.status,
                sending_at: op.opts?.sendingAt || null,
              }

              // Reset campos (idempotente) conforme status final
              if (op.status === 'sent') {
                const now = new Date().toISOString()
                base.sent_at = now
                base.failed_at = null
                base.skipped_at = null
                base.message_id = op.opts?.messageId || null
                base.error = null
                base.skip_code = null
                base.skip_reason = null
                base.failure_code = null
                base.failure_reason = null
                base.failure_title = null
                base.failure_details = null
                base.failure_fbtrace_id = null
                base.failure_subcode = null
                base.failure_href = null
              } else if (op.status === 'skipped') {
                const now = new Date().toISOString()
                base.skipped_at = now
                base.sent_at = null
                base.failed_at = null
                base.message_id = null
                base.error = null
                base.skip_code = op.opts?.skipCode || null
                base.skip_reason = op.opts?.skipReason || op.opts?.error || null
                base.failure_code = null
                base.failure_reason = null
                base.failure_title = null
                base.failure_details = null
                base.failure_fbtrace_id = null
                base.failure_subcode = null
                base.failure_href = null
              } else if (op.status === 'failed') {
                const now = new Date().toISOString()
                base.failed_at = now
                base.sent_at = null
                base.skipped_at = null
                base.message_id = null
                base.error = op.opts?.error || null

                const errorCode = op.opts?.errorCode
                if (typeof errorCode === 'number') base.failure_code = errorCode
                const title = op.opts?.errorTitle
                const details = op.opts?.errorDetails
                const fbtrace = op.opts?.errorFbtraceId
                const subcode = op.opts?.errorSubcode
                const href = op.opts?.errorHref

                if (typeof title === 'string') base.failure_title = normalizeMetaErrorTextForStorage(title, 200)
                if (typeof details === 'string') base.failure_details = normalizeMetaErrorTextForStorage(details, 800)
                if (typeof fbtrace === 'string') base.failure_fbtrace_id = normalizeMetaErrorTextForStorage(fbtrace, 200)
                if (typeof subcode === 'number') base.failure_subcode = subcode
                if (typeof href === 'string') base.failure_href = normalizeMetaErrorTextForStorage(href, 400)
                if (typeof op.opts?.error === 'string' && String(op.opts?.error).trim()) {
                  base.failure_reason = op.opts?.error
                }

                base.skip_code = null
                base.skip_reason = null
              }

              return base
            })

            const t0 = Date.now()
            const { error: bulkErr } = await supabase
              .from('campaign_contacts')
              .upsert(upsertRows, { onConflict: 'campaign_id,contact_id' })
            dbTimeMs += Date.now() - t0

            if (bulkErr) {
              console.warn('[Workflow] Bulk upsert campaign_contacts falhou; fallback por contato:', bulkErr)
              await emitWorkflowTrace({
                traceId,
                campaignId,
                step,
                batchIndex,
                phase: 'db_bulk_upsert_contacts',
                ok: false,
                ms: Date.now() - t0,
                extra: { error: bulkErr.message, rows: upsertRows.length },
              })

              // Fallback seguro (mais lento, mas preserva consistência)
              const fb0 = Date.now()
              for (const op of writeOps) {
                try {
                  await updateContactStatus(
                    campaignId,
                    { contactId: String(op.contact.contactId), phone: op.contact.phone },
                    op.status,
                    op.opts as any
                  )
                } catch {
                  // best-effort
                }
              }
              dbTimeMs += Date.now() - fb0
            } else {
              await emitWorkflowTrace({
                traceId,
                campaignId,
                step,
                batchIndex,
                phase: 'db_bulk_upsert_contacts',
                ok: true,
                ms: Date.now() - t0,
                extra: { rows: upsertRows.length },
              })
            }
          }

        } catch (err) {
          batchOk = false
          batchError = err instanceof Error ? err.message : String(err)
          throw err
        } finally {
          // Sinaliza fim do batch e faz flush final
          try {
            await progress.flush({ phase: 'batch_end' })
          } catch {
            // best-effort
          }
          try {
            await broadcastCampaignPhase(campaignId, {
              traceId,
              batchIndex,
              phase: 'batch_end',
            })
          } catch {
            // best-effort
          }
          try {
            await progress.stop()
          } catch {
            // best-effort
          }

          if (limiter) {
            try {
              limiter.stop()
            } catch {
              // best-effort
            }
          }

          // Se o batch foi estável (sem 130429), podemos aumentar um pouco o alvo.
          // Fazemos isso no finally para não perder a chance em batches com early return.
          if (adaptiveEnabled && !sawThroughput429) {
            try {
              const update = await recordStableBatch(phoneNumberId)
              if (update.changed) {
                await emitWorkflowTrace({
                  traceId,
                  campaignId,
                  step,
                  batchIndex,
                  phase: 'throttle_increase',
                  ok: true,
                  extra: {
                    previousMps: update.previous.targetMps,
                    nextMps: update.next.targetMps,
                  },
                })
              }
            } catch (e) {
              await emitWorkflowTrace({
                traceId,
                campaignId,
                step,
                batchIndex,
                phase: 'throttle_increase',
                ok: false,
                extra: {
                  error: e instanceof Error ? e.message : String(e),
                },
              })
            }
          }

          // Sempre emitimos batch_end (mesmo com erro) para fechar o passo no trace.
          await emitWorkflowTrace({
            traceId,
            campaignId,
            step,
            batchIndex,
            phase: 'batch_end',
            ok: batchOk,
            extra: {
              sentCount,
              failedCount,
              skippedCount,
              metaTimeMs,
              dbTimeMs,
              error: batchError,
              sawThroughput429,
            },
          })

          // Persistência best-effort para baselines (não pode quebrar o envio).
          try {
            const { error: batchMetricsErr } = await supabase
              .from('campaign_batch_metrics')
              .insert({
                campaign_id: campaignId,
                trace_id: traceId,
                batch_index: batchIndex,
                configured_batch_size: BATCH_SIZE,
                batch_size: batch.length,
                concurrency,
                adaptive_enabled: adaptiveEnabled,
                target_mps: targetMpsForBatch,
                floor_delay_ms: Number.isFinite(floorDelayMs) ? floorDelayMs : null,
                sent_count: sentCount,
                failed_count: failedCount,
                skipped_count: skippedCount,
                meta_requests: sentCount + failedCount,
                meta_time_ms: metaTimeMs,
                db_time_ms: dbTimeMs,
                saw_throughput_429: sawThroughput429,
                batch_ok: batchOk,
                error: batchError,
              })

            if (batchMetricsErr) throw batchMetricsErr
          } catch (e) {
            console.warn(
              '[metrics] failed to insert campaign_batch_metrics',
              JSON.stringify({
                campaignId,
                traceId,
                batchIndex,
                error: e instanceof Error ? e.message : String(e),
              })
            )

            // Também emitimos no trace para aparecer no monitor.
            try {
              await emitWorkflowTrace({
                traceId,
                campaignId,
                step,
                batchIndex,
                phase: 'metrics_batch_insert',
                ok: false,
                extra: { error: e instanceof Error ? e.message : String(e) },
              })
            } catch {
              // best-effort
            }
          }
        }

        // Update stats in Supabase (source of truth)
        // Supabase Realtime will propagate changes to frontend
        await timePhase(
          'db_update_campaign_counters',
          { traceId, campaignId, step, batchIndex },
          async () => {
            const t0 = Date.now()
            const campaign = await campaignDb.getById(campaignId)
            if (campaign) {
              // Importante: `campaigns.last_sent_at` também é mantido por trigger (0007)
              // baseado em `campaign_contacts.sent_at`. Como usamos bulk upsert, `sent_at`
              // pode ser persistido *depois* do último meta_send_ok.
              // Portanto, NUNCA devemos sobrescrever `last_sent_at` com um valor menor.
              const safeLastSentAt = (() => {
                const existing = (campaign as any).lastSentAt || null
                const candidate = lastSentAtInBatch || null
                if (!candidate) return existing
                if (!existing) return candidate
                const a = Date.parse(existing)
                const b = Date.parse(candidate)
                if (!Number.isFinite(a) || !Number.isFinite(b)) return existing || candidate
                return (b > a) ? candidate : existing
              })()

              await campaignDb.updateStatus(campaignId, {
                sent: campaign.sent + sentCount,
                failed: campaign.failed + failedCount,
                skipped: (campaign as any).skipped + skippedCount,
                // Início do disparo: quando o primeiro contato foi claimado como "sending".
                // Guardamos só se ainda não existe no registro.
                firstDispatchAt: (campaign as any).firstDispatchAt || firstDispatchAtInBatch || null,
                // Atualiza somente quando houve pelo menos 1 envio com sucesso neste batch.
                // Importante: isso mede o tempo de disparo (sent), não entrega.
                lastSentAt: safeLastSentAt,
              })
            }
            dbTimeMs += Date.now() - t0
          }
        )

        console.log(`📦 Batch ${batchIndex + 1}/${batches.length}: ${sentCount} sent, ${failedCount} failed, ${skippedCount} skipped`)
      })
    }

    // Step 3: Mark campaign as completed
    await context.run('complete-campaign', async () => {
      const campaign = await campaignDb.getById(campaignId)

      let finalStatus = CampaignStatus.COMPLETED
      if (campaign && (campaign.failed + (campaign as any).skipped) === campaign.recipients && campaign.recipients > 0) {
        finalStatus = CampaignStatus.FAILED
      }

      await campaignDb.updateStatus(campaignId, {
        status: finalStatus,
        completedAt: new Date().toISOString()
      })

      console.log(`🎉 Campaign ${campaignId} completed!`)

      await emitWorkflowTrace({
        traceId,
        campaignId,
        step: 'complete-campaign',
        phase: 'complete',
        ok: true,
        extra: { finalStatus },
      })

      // Broadcast best-effort: força reconciliação imediata na UI.
      try {
        await broadcastCampaignPhase(campaignId, {
          traceId,
          batchIndex: -1,
          phase: 'complete',
        })
      } catch {
        // best-effort
      }

      // Persistência best-effort do "run" (baseline / evolução).
      try {
        const adaptiveCfg = await getAdaptiveThrottleConfigWithSource().catch(() => null)
        const adaptiveConfig = adaptiveCfg?.config || null
        const rawConcurrency = Number(adaptiveConfig?.sendConcurrency ?? process.env.WHATSAPP_SEND_CONCURRENCY ?? '1')
        const concurrency = Number.isFinite(rawConcurrency)
          ? Math.max(1, Math.min(50, Math.floor(rawConcurrency)))
          : 1
        const rawBatchSize = Number(adaptiveConfig?.batchSize ?? process.env.WHATSAPP_WORKFLOW_BATCH_SIZE ?? '10')
        const configuredBatchSize = Number.isFinite(rawBatchSize)
          ? Math.max(1, Math.min(200, Math.floor(rawBatchSize)))
          : 10

        // Agrega batches (se a tabela existir)
        let sumMetaTimeMs = 0
        let sumDbTimeMs = 0
        let sumMetaRequests = 0
        let sumProcessed = 0
        let any429 = false

        try {
          const { data: rows } = await supabase
            .from('campaign_batch_metrics')
            .select('meta_time_ms,db_time_ms,meta_requests,sent_count,failed_count,skipped_count,saw_throughput_429')
            .eq('campaign_id', campaignId)
            .eq('trace_id', traceId)

          for (const r of rows || []) {
            sumMetaTimeMs += Number(r.meta_time_ms || 0)
            sumDbTimeMs += Number(r.db_time_ms || 0)
            sumMetaRequests += Number(r.meta_requests || 0)
            const processed = Number(r.sent_count || 0) + Number(r.failed_count || 0) + Number(r.skipped_count || 0)
            sumProcessed += processed
            if (r.saw_throughput_429) any429 = true
          }
        } catch {
          // best-effort
        }

        const firstDispatchAt = (campaign as any)?.firstDispatchAt
        const lastSentAt = (campaign as any)?.lastSentAt

        const dispatchDurationMs = (firstDispatchAt && lastSentAt)
          ? Math.max(0, Date.parse(lastSentAt) - Date.parse(firstDispatchAt))
          : null

        const sentTotal = (campaign as any)?.sent ?? null
        const failedTotal = (campaign as any)?.failed ?? null
        const skippedTotal = (campaign as any)?.skipped ?? null

        const throughputMps = (dispatchDurationMs && dispatchDurationMs > 0 && typeof sentTotal === 'number')
          ? (sentTotal / (dispatchDurationMs / 1000))
          : null

        const metaAvgMs = sumMetaRequests > 0 ? (sumMetaTimeMs / sumMetaRequests) : null
        const dbAvgMs = sumProcessed > 0 ? (sumDbTimeMs / sumProcessed) : null

        const configSnapshot = {
          adaptive: adaptiveConfig
            ? {
              enabled: Boolean((adaptiveConfig as any).enabled),
              sendConcurrency: Number((adaptiveConfig as any).sendConcurrency),
              batchSize: Number((adaptiveConfig as any).batchSize),
              startMps: Number((adaptiveConfig as any).startMps),
              maxMps: Number((adaptiveConfig as any).maxMps),
              minMps: Number((adaptiveConfig as any).minMps),
              cooldownSec: Number((adaptiveConfig as any).cooldownSec),
              minIncreaseGapSec: Number((adaptiveConfig as any).minIncreaseGapSec),
              sendFloorDelayMs: Number((adaptiveConfig as any).sendFloorDelayMs),
            }
            : null,
          effective: {
            configuredBatchSize,
            concurrency,
          },
        }

        const configHash = hashConfig(configSnapshot)

        const { error: runMetricsErr } = await supabase
          .from('campaign_run_metrics')
          .upsert(
            {
              campaign_id: campaignId,
              trace_id: traceId,
              template_name: templateName,
              recipients: contacts?.length || null,
              sent_total: sentTotal,
              failed_total: failedTotal,
              skipped_total: skippedTotal,
              first_dispatch_at: firstDispatchAt || null,
              last_sent_at: lastSentAt || null,
              dispatch_duration_ms: dispatchDurationMs,
              throughput_mps: throughputMps,
              meta_avg_ms: metaAvgMs,
              db_avg_ms: dbAvgMs,
              saw_throughput_429: any429,
              config: configSnapshot,
              config_hash: configHash,
            },
            { onConflict: 'campaign_id,trace_id' }
          )

        if (runMetricsErr) throw runMetricsErr
      } catch (e) {
        console.warn(
          '[metrics] failed to upsert campaign_run_metrics',
          JSON.stringify({
            campaignId,
            traceId,
            error: e instanceof Error ? e.message : String(e),
          })
        )

        // Também emitimos no trace para aparecer no monitor.
        try {
          await emitWorkflowTrace({
            traceId,
            campaignId,
            step: 'complete-campaign',
            phase: 'metrics_run_upsert',
            ok: false,
            extra: { error: e instanceof Error ? e.message : String(e) },
          })
        } catch {
          // best-effort
        }
      }
    })
  },
  {
    // IMPORTANT:
    // Em preview/dev, NUNCA aponte baseUrl para o domínio de produção.
    // O baseUrl é usado pelo Upstash Workflow para chamar os próximos passos.
    // Se ele apontar para produção, o workflow começa no preview mas continua
    // executando passos em outro deployment (clássico: "turbo não muda nada" e
    // métricas não aparecem no lugar esperado).
    baseUrl: (() => {
      const vercelEnv = (process.env.VERCEL_ENV || '').trim() // 'production' | 'preview' | 'development'
      const deploymentUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.trim()}` : undefined
      const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.trim()}`
        : undefined
      const explicitAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || undefined

      if (vercelEnv && vercelEnv !== 'production') {
        return deploymentUrl
      }

      return explicitAppUrl || productionUrl || deploymentUrl
    })(),
    retries: 3,
  }
)
