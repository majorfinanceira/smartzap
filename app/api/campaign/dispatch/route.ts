import { NextRequest, NextResponse } from 'next/server'
import { Client } from '@upstash/workflow'
import { getWhatsAppCredentials } from '@/lib/whatsapp-credentials'
import { supabase } from '@/lib/supabase'
import { templateDb } from '@/lib/supabase-db'

import { precheckContactForTemplate } from '@/lib/whatsapp/template-contract'
import { normalizePhoneNumber } from '@/lib/phone-formatter'
import { getActiveSuppressionsByPhone } from '@/lib/phone-suppressions'

import { ContactStatus } from '@/types'

interface DispatchContact {
  contactId?: string
  contact_id?: string
  phone: string
  name: string
  email?: string
  custom_fields?: Record<string, unknown>
}

interface DispatchContactResolved {
  contactId: string
  phone: string
  name: string
  email?: string
  custom_fields?: Record<string, unknown>
}

// Ensure this route runs in Node.js (env access + better compatibility in dev)
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getRequestOrigin(request: NextRequest): string | null {
  // Em Vercel, esses headers existem e representam o domínio REAL do deployment.
  const proto = request.headers.get('x-forwarded-proto') || 'https'
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host')
  if (!host) return null
  return `${proto}://${host}`
}

function isMissingOnConflictConstraintError(err: any): boolean {
  const msg = String(err?.message || '').toLowerCase()
  // Postgres: "there is no unique or exclusion constraint matching the ON CONFLICT specification"
  return msg.includes('no unique') && msg.includes('on conflict')
}

function isUpsertDuplicateInputError(err: any): boolean {
  const msg = String(err?.message || '').toLowerCase()
  // Postgres: "ON CONFLICT DO UPDATE command cannot affect row a second time"
  return msg.includes('cannot affect row a second time')
}

function dedupeBy<T>(items: T[], keyFn: (x: T) => string): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const it of items) {
    const k = keyFn(it)
    if (!k) continue
    if (seen.has(k)) continue
    seen.add(k)
    out.push(it)
  }
  return out
}

// Generate simple ID
// Trigger campaign dispatch workflow
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { campaignId, templateName, whatsappCredentials, templateVariables, flowId } = body
  const trigger: 'schedule' | 'manual' | string | undefined = body?.trigger
  const scheduledAtFromJob: string | undefined = body?.scheduledAt
  let { contacts } = body

  // Carrega campanha cedo para:
  // - validar gatilho de agendamento (evitar job “fantasma” após cancelamento)
  // - obter template_variables quando necessário
  // - evitar queries duplicadas (template_spec_hash)
  const { data: campaignRow, error: campaignError } = await supabase
    .from('campaigns')
    .select('status, scheduled_date, template_variables, template_spec_hash')
    .eq('id', campaignId)
    .single()

  if (campaignError || !campaignRow) {
    console.error('[Dispatch] Campaign not found:', campaignError)
    return NextResponse.json({ error: 'Campanha não encontrada' }, { status: 404 })
  }

  // Se o job veio do scheduler, só pode rodar se ainda estiver agendada.
  // Isso evita iniciar campanha após o usuário cancelar (best-effort, já que o cancelamento do job pode falhar).
  if (trigger === 'schedule') {
    const isStillScheduled = String((campaignRow as any).status) === 'SCHEDULED'
    const scheduledDate = (campaignRow as any).scheduled_date as string | null

    if (!isStillScheduled || !scheduledDate) {
      return NextResponse.json(
        {
          status: 'ignored',
          message: 'Campanha não está mais agendada; ignorando disparo do scheduler.',
        },
        { status: 202 }
      )
    }

    // Verificação extra: se o job carregar scheduledAt, confirme se bate (tolerância de 60s)
    if (scheduledAtFromJob) {
      const jobMs = new Date(scheduledAtFromJob).getTime()
      const dbMs = new Date(scheduledDate).getTime()
      if (Number.isFinite(jobMs) && Number.isFinite(dbMs)) {
        const diff = Math.abs(jobMs - dbMs)
        if (diff > 60_000) {
          return NextResponse.json(
            {
              status: 'ignored',
              message: 'Job de agendamento não corresponde ao scheduledAt atual; ignorando (provável cancelamento/alteração).',
            },
            { status: 202 }
          )
        }
      }
    }
  }

  // Get template variables from campaign if not provided directly
  let resolvedTemplateVariables: any = templateVariables
  if (!resolvedTemplateVariables) {
    if ((campaignRow as any).template_variables != null) {
      // JSONB should already be a native JS object; keep a string fallback for safety.
      const tv = (campaignRow as any).template_variables
      if (typeof tv === 'string') {
        try {
          resolvedTemplateVariables = JSON.parse(tv)
        } catch {
          console.error('[Dispatch] Failed to parse template_variables string:', tv)
          resolvedTemplateVariables = undefined
        }
      } else {
        resolvedTemplateVariables = tv
      }
    }
    console.log('[Dispatch] Loaded template_variables from database:', resolvedTemplateVariables)
  }

  // Fetch template from local DB cache (source operacional). Documented-only: sem template, sem envio.
  const template = await templateDb.getByName(templateName)
  if (!template) {
    return NextResponse.json(
      { error: 'Template não encontrado no banco local. Sincronize Templates antes de disparar.' },
      { status: 400 }
    )
  }

  // Snapshot do template na campanha (fonte operacional por campanha)
  try {
    const snapshot = {
      name: template.name,
      language: template.language,
      parameter_format: (template as any).parameterFormat || 'positional',
      spec_hash: (template as any).specHash ?? null,
      fetched_at: (template as any).fetchedAt ?? null,
      components: (template as any).components || (template as any).content || [],
    }

    // Só setar snapshot se ainda não existir (evita drift/regravação em replays)
    if (!(campaignRow as any)?.template_spec_hash) {
      await supabase
        .from('campaigns')
        .update({
          template_snapshot: snapshot,
          template_spec_hash: snapshot.spec_hash,
          template_parameter_format: snapshot.parameter_format,
          template_fetched_at: snapshot.fetched_at,
          updated_at: new Date().toISOString(),
        })
        .eq('id', campaignId)
    }
  } catch (e) {
    console.warn('[Dispatch] Falha ao salvar snapshot do template na campanha (best-effort):', e)
  }

  // If no contacts provided, fetch from campaign_contacts (for cloned/scheduled campaigns)
  if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
    // First get campaign contacts with their contact_id
    const { data: existingContacts, error } = await supabase
      .from('campaign_contacts')
      .select('phone, name, email, contact_id, custom_fields')
      .eq('campaign_id', campaignId)

    if (error) {
      console.error('Failed to fetch existing contacts:', error)
      return NextResponse.json({ error: 'Failed to fetch contacts' }, { status: 500 })
    }

    if (!existingContacts || existingContacts.length === 0) {
      return NextResponse.json({ error: 'No contacts found for campaign' }, { status: 400 })
    }

    contacts = existingContacts.map(row => ({
      phone: row.phone as string,
      name: (row.name as string) || '',
      email: (row as any).email || undefined,
      contactId: (row as any).contact_id || undefined,
      // Snapshot Pattern: prefer campaign_contacts.custom_fields (works for temp_* and clones)
      custom_fields: (row as any).custom_fields || {}
    }))

    console.log(`[Dispatch] Loaded ${contacts.length} contacts from database for campaign ${campaignId}`)
  }

  // =====================
  // PRÉ-CHECK (Contrato Ouro)
  // =====================
  const nowIso = new Date().toISOString()
  const inputContacts = (contacts as DispatchContact[])

  // =====================================================================
  // HARDENING: garantir contactId (fonte de verdade do destinatário)
  // - Para campanhas novas, a UI deve sempre mandar contactId.
  // - Para campanhas antigas/clone, podemos resolver via phone (contacts.phone é UNIQUE).
  // =====================================================================

  // 1) Normaliza payload (resolve contactId/contact_id em um único campo)
  const normalizedInput: DispatchContact[] = inputContacts.map((c) => {
    const contactId = c.contactId || c.contact_id
    return { ...c, contactId, contact_id: undefined }
  })

  // Hardening extra: dedupe por contactId para evitar erro do Postgres:
  // "ON CONFLICT DO UPDATE command cannot affect row a second time"
  // quando o payload contém o mesmo contato repetido.
  const dedupedInput = dedupeBy(normalizedInput, (c) => String(c.contactId || ''))
  if (dedupedInput.length !== normalizedInput.length) {
    console.warn(
      `[Dispatch] Payload tinha ${normalizedInput.length - dedupedInput.length} contato(s) duplicado(s) por contactId; dedupe aplicado.`
    )
  }

  // 2) Tentar resolver contactId faltante via contacts.phone
  const missingId = dedupedInput.filter((c) => !c.contactId)
  if (missingId.length > 0) {
    const phoneCandidates = Array.from(
      new Set(
        missingId
          .flatMap((c) => {
            const raw = String(c.phone || '').trim()
            if (!raw) return []
            const normalized = normalizePhoneNumber(raw)
            return normalized && normalized !== raw ? [raw, normalized] : [raw]
          })
          .filter(Boolean)
      )
    )

    if (phoneCandidates.length > 0) {
      const { data: contactsByPhone, error: lookupError } = await supabase
        .from('contacts')
        .select('id, phone')
        .in('phone', phoneCandidates)

      if (lookupError) {
        console.error('[Dispatch] Falha ao resolver contactId via phone:', lookupError)
        return NextResponse.json(
          { error: 'Falha ao resolver contatos (contactId)', details: lookupError.message },
          { status: 500 }
        )
      }

      const idByPhone = new Map<string, string>()
      for (const row of (contactsByPhone || []) as any[]) {
        if (!row?.id || !row?.phone) continue
        idByPhone.set(String(row.phone), String(row.id))
      }

      for (const c of dedupedInput) {
        if (c.contactId) continue
        const raw = String(c.phone || '').trim()
        const normalized = raw ? normalizePhoneNumber(raw) : ''
        c.contactId = idByPhone.get(raw) || (normalized ? idByPhone.get(normalized) : undefined)
      }
    }
  }

  // 3) Se ainda houver contato sem ID, bloqueia para evitar dados inconsistentes.
  //    (Isso elimina definitivamente o caminho "sem contactId" no workflow.)
  const stillMissing = dedupedInput.filter((c) => !c.contactId)
  if (stillMissing.length > 0) {
    return NextResponse.json(
      {
        error: 'Alguns contatos não possuem contactId (não é possível disparar com segurança).',
        missing: stillMissing.map((c) => ({ phone: c.phone, name: c.name || '' })),
        action: 'Recarregue a lista de contatos e tente novamente. Se o contato foi removido, remova-o da campanha.'
      },
      { status: 400 }
    )
  }

  // =====================================================================
  // Checagens globais (antes do precheck): opt-out + supressões
  // =====================================================================
  const uniqueContactIds = Array.from(
    new Set(normalizedInput.map((c) => String(c.contactId || '').trim()).filter(Boolean))
  )

  const statusByContactId = new Map<string, string>()
  if (uniqueContactIds.length > 0) {
    const { data: contactRows, error: contactRowsError } = await supabase
      .from('contacts')
      .select('id, status')
      .in('id', uniqueContactIds)

    if (contactRowsError) {
      console.warn('[Dispatch] Falha ao carregar status dos contatos (best-effort):', contactRowsError)
    } else {
      for (const row of (contactRows || []) as any[]) {
        if (!row?.id) continue
        statusByContactId.set(String(row.id), String(row.status || ''))
      }
    }
  }

  const normalizedPhonesForSuppression = Array.from(
    new Set(normalizedInput.map((c) => normalizePhoneNumber(String(c.phone || '').trim())).filter(Boolean))
  )

  let suppressionsByPhone = new Map<string, { phone: string; reason: string | null; source: string | null }>()
  try {
    const active = await getActiveSuppressionsByPhone(normalizedPhonesForSuppression)
    suppressionsByPhone = new Map(
      Array.from(active.entries()).map(([phone, row]) => [phone, { phone, reason: row.reason, source: row.source }])
    )
  } catch (e) {
    console.warn('[Dispatch] Falha ao carregar phone_suppressions (best-effort):', e)
  }

  const validContacts: DispatchContactResolved[] = []
  const skippedContacts: Array<{ contact: DispatchContact; code: string; reason: string; normalizedPhone?: string }> = []

  for (const c of dedupedInput) {
    const contactId = c.contactId

    // Opt-out global (contacts.status)
    const contactStatus = contactId ? statusByContactId.get(String(contactId)) : null
    if (contactStatus === ContactStatus.OPT_OUT) {
      const normalizedPhone = normalizePhoneNumber(String(c.phone || '').trim())
      skippedContacts.push({
        contact: c,
        code: 'OPT_OUT',
        reason: 'Contato opt-out (não quer receber mensagens).',
        normalizedPhone,
      })
      continue
    }

    const precheck = precheckContactForTemplate(
      {
        phone: c.phone,
        name: c.name,
        email: c.email,
        custom_fields: c.custom_fields,
        contactId: contactId || null,
      },
      template as any,
      resolvedTemplateVariables
    )

    if (!precheck.ok) {
      skippedContacts.push({ contact: c, code: precheck.skipCode, reason: precheck.reason, normalizedPhone: precheck.normalizedPhone })
      continue
    }

    validContacts.push({
      phone: precheck.normalizedPhone,
      name: c.name,
      email: c.email,
      custom_fields: c.custom_fields,
      contactId: contactId as string,
    })
  }

  // Remover da fila qualquer número globalmente suprimido
  if (validContacts.length > 0 && suppressionsByPhone.size > 0) {
    const keep: DispatchContactResolved[] = []
    for (const v of validContacts) {
      const suppression = suppressionsByPhone.get(v.phone)
      if (!suppression) {
        keep.push(v)
        continue
      }

      // Encontrar o contato original para persistir snapshot como skipped
      const original = normalizedInput.find((c) => String(c.contactId) === String(v.contactId))
      const fallbackContact: DispatchContact = original || {
        phone: v.phone,
        name: v.name || '',
        email: v.email,
        custom_fields: v.custom_fields,
        contactId: v.contactId,
      }
      skippedContacts.push({
        contact: fallbackContact,
        code: 'SUPPRESSED',
        reason: `Telefone suprimido globalmente${suppression.reason ? `: ${suppression.reason}` : ''}`,
        normalizedPhone: v.phone,
      })
    }
    validContacts.length = 0
    validContacts.push(...keep)
  }

  // Persistir snapshot + status por contato (pending vs skipped)
  try {
    // HARDENING CRÍTICO:
    // Não sobrescrever linhas já processadas (sent/delivered/read/failed/sending).
    // Se uma chamada duplicada de dispatch/precheck rodar depois do envio,
    // um upsert "cego" pode resetar status e apagar message_id — e então o
    // webhook não consegue correlacionar delivery/read, parecendo que "parou".
    const candidateContactIds = Array.from(
      new Set(
        [...validContacts.map((c) => c.contactId), ...skippedContacts.map((s) => String(s.contact.contactId || ''))]
          .map((x) => String(x || '').trim())
          .filter(Boolean)
      )
    )

    const lockedContactIds = new Set<string>()
    try {
      if (candidateContactIds.length > 0) {
        const { data: existingRows, error: existingErr } = await supabase
          .from('campaign_contacts')
          .select('contact_id,status,message_id')
          .eq('campaign_id', campaignId)
          .in('contact_id', candidateContactIds)

        if (existingErr) throw existingErr

        for (const r of (existingRows || []) as any[]) {
          const cid = String(r?.contact_id || '').trim()
          if (!cid) continue
          const st = String(r?.status || '').toLowerCase()
          // "sending" também deve ser bloqueado para não quebrar um envio em andamento.
          if (st === 'sending' || st === 'sent' || st === 'delivered' || st === 'read' || st === 'failed') {
            lockedContactIds.add(cid)
            continue
          }
          // Segurança extra: se tiver message_id, jamais mexer.
          if (r?.message_id) {
            lockedContactIds.add(cid)
          }
        }
      }
    } catch (e) {
      // Se não conseguimos carregar estado existente, seguimos com o comportamento atual.
      // (Mas registramos para diagnóstico.)
      console.warn('[Dispatch] Falha ao carregar campaign_contacts existentes para lock (seguindo sem lock):', e)
      lockedContactIds.clear()
    }
    const rowsPending = validContacts
      .filter((c) => !lockedContactIds.has(String(c.contactId)))
      .map(c => ({
      campaign_id: campaignId,
      contact_id: c.contactId || null,
      phone: c.phone,
      name: c.name || '',
      email: c.email || null,
      custom_fields: c.custom_fields || {},
      status: 'pending',
      skipped_at: null,
      skip_code: null,
      skip_reason: null,
      error: null,
    }))

    const rowsSkipped = skippedContacts
      .filter(({ contact }) => !lockedContactIds.has(String(contact.contactId || '')))
      .map(({ contact, code, reason, normalizedPhone }) => ({
      campaign_id: campaignId,
      contact_id: contact.contactId || null,
      phone: normalizedPhone || contact.phone,
      name: contact.name || '',
      email: contact.email || null,
      custom_fields: contact.custom_fields || {},
      status: 'skipped',
      skipped_at: nowIso,
      skip_code: code,
      skip_reason: reason,
      // Compat + integridade: o schema tem CHECK que exige failure_reason OU error quando status='skipped'
      // (ver campaign_contacts_skipped_reason_check).
      failure_reason: reason,
      error: reason,
    }))

    // Monta todas as linhas e dedupe pela chave de idempotência.
    // Preferimos "pending" quando houver colisão (contato válido vence).
    const allRows = [...rowsSkipped, ...rowsPending]

    if (lockedContactIds.size > 0) {
      console.warn(
        `[Dispatch] Lock ativo: ${lockedContactIds.size} contato(s) já processado(s) e não serão sobrescritos no precheck.`
      )
    }

    const dedupedRows = dedupeBy(allRows, (r) => `${String(r.campaign_id)}::${String(r.contact_id)}`)
    if (allRows.length) {
      // Padrão atual: UNIQUE(campaign_id, contact_id)
      let tried = 'campaign_id, contact_id'
      let { error } = await supabase
        .from('campaign_contacts')
        .upsert(dedupedRows, { onConflict: tried })

      // Compat/legacy: alguns bancos antigos ainda podem ter UNIQUE(campaign_id, phone)
      if (error && isMissingOnConflictConstraintError(error)) {
        console.warn('[Dispatch] onConflict campaign_id,contact_id não existe. Tentando fallback campaign_id,phone (legacy).')
        tried = 'campaign_id, phone'
        ;({ error } = await supabase
          .from('campaign_contacts')
          .upsert(
            // para esse fallback, a chave vira (campaign_id, phone)
            dedupeBy(allRows, (r) => `${String(r.campaign_id)}::${String(r.phone)}`),
            { onConflict: tried }
          ))
      }

      if (error) {
        ;(error as any).__dispatch_on_conflict = tried
        throw error
      }
    }

    console.log(`[Dispatch] Pré-check: ${validContacts.length} válidos, ${skippedContacts.length} ignorados (skipped)`)

    // Reconciliar contadores da campanha com o que foi efetivamente persistido.
    // Motivo: contatos "skipped" no pré-check não passam pelo workflow, então
    // `campaigns.skipped` pode ficar 0 mesmo com linhas skipped em `campaign_contacts`.
    // Best-effort (não deve bloquear o disparo).
    try {
      const [{ count: totalCount, error: totalErr }, { count: skippedCount, error: skippedErr }] = await Promise.all([
        supabase
          .from('campaign_contacts')
          .select('id', { count: 'exact', head: true })
          .eq('campaign_id', campaignId),
        supabase
          .from('campaign_contacts')
          .select('id', { count: 'exact', head: true })
          .eq('campaign_id', campaignId)
          .eq('status', 'skipped'),
      ])

      if (totalErr) throw totalErr
      if (skippedErr) throw skippedErr

      const updateCampaign: Record<string, unknown> = { updated_at: nowIso }
      if (typeof totalCount === 'number') updateCampaign.total_recipients = totalCount
      if (typeof skippedCount === 'number') updateCampaign.skipped = skippedCount

      await supabase
        .from('campaigns')
        .update(updateCampaign)
        .eq('id', campaignId)
    } catch (e) {
      console.warn('[Dispatch] Falha ao reconciliar contadores da campanha (best-effort):', e)
    }
  } catch (error) {
    console.error('[Dispatch] Failed to persist pre-check results:', error)
    const details = error instanceof Error ? error.message : String(error)
    const tried = (error as any)?.__dispatch_on_conflict
    return NextResponse.json(
      {
        error: 'Falha ao salvar validação de contatos',
        details,
        hint: isMissingOnConflictConstraintError(error)
          ? 'O banco parece não ter a constraint UNIQUE esperada para o upsert. Verifique se a migration 0001 (UNIQUE(campaign_id, contact_id)) foi aplicada no Supabase; se não, aplique e tente novamente.'
          : isUpsertDuplicateInputError(error)
            ? 'O payload tinha contatos duplicados na mesma campanha. O backend tentou deduplicar, mas ainda ocorreu conflito; verifique se há contatos repetidos (mesmo contactId/phone) na seleção.'
            : undefined,
        onConflictTried: tried || 'campaign_id, contact_id',
      },
      { status: 500 }
    )
  }

  // Se não há ninguém válido, não faz sentido enfileirar workflow
  if (validContacts.length === 0) {
    return NextResponse.json(
      {
        status: 'skipped',
        count: 0,
        skipped: skippedContacts.length,
        message: 'Nenhum contato válido para envio (todos foram ignorados pela validação).',
      },
      { status: 202 }
    )
  }

  // Get credentials: Body (if valid) > DB (Supabase settings) > Env
  let phoneNumberId: string | undefined
  let accessToken: string | undefined

  // Try from body first (only if not masked)
  if (whatsappCredentials?.phoneNumberId &&
    whatsappCredentials?.accessToken &&
    !whatsappCredentials.accessToken.includes('***')) {
    phoneNumberId = whatsappCredentials.phoneNumberId
    accessToken = whatsappCredentials.accessToken
  }

  // Fallback to Centralized Helper (DB > Env)
  if (!phoneNumberId || !accessToken) {
    const credentials = await getWhatsAppCredentials()
    if (credentials) {
      phoneNumberId = credentials.phoneNumberId
      accessToken = credentials.accessToken
    }
  }



  if (!phoneNumberId || !accessToken) {
    return NextResponse.json(
      { error: 'Credenciais WhatsApp não configuradas. Configure em Configurações.' },
      { status: 401 }
    )
  }

  // =========================================================================
  // FLOW ENGINE DISPATCH (if flowId is provided)
  // =========================================================================

  // =========================================================================
  // FLOW ENGINE DISPATCH (Disabled in Template)
  // =========================================================================

  if (flowId) {
    console.log('[Dispatch] Flow Engine is disabled in this template. Using legacy workflow.')
    // Fallthrough to legacy workflow
  }

  // =========================================================================
  // LEGACY WORKFLOW DISPATCH (for template-based campaigns)
  // =========================================================================
  try {
    // Importante:
    // - Em preview/dev, precisamos disparar o workflow no MESMO origin do request.
    //   Caso contrário, acabamos chamando produção (versão/config diferente) e o usuário
    //   vê “turbo não muda nada” porque o envio real está rodando em outro deployment.
    // - Em produção, ainda faz sentido usar um domínio estável (quando configurado).
    const explicitAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || null
    const requestOrigin = getRequestOrigin(request)

    const vercelEnv = (process.env.VERCEL_ENV || '').trim() // 'production' | 'preview' | 'development'
    const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.trim()}`
      : null
    const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.trim()}` : null

    // Regra de ouro:
    // - preview/dev: sempre preferir o origin do request para garantir que o workflow
    //   rode no MESMO deployment que gerou a fila (evita chamar produção por engano).
    // - produção: pode usar um domínio estável (NEXT_PUBLIC_APP_URL), caso exista.
    const baseUrl = (vercelEnv === 'production')
      ? (explicitAppUrl || productionUrl || vercelUrl || requestOrigin || 'http://localhost:3000')
      : (requestOrigin || vercelUrl || explicitAppUrl || productionUrl || 'http://localhost:3000')

    const isLocalhost = baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')

    console.log(`[Dispatch] Triggering workflow at: ${baseUrl}/api/campaign/workflow`)
    console.log(`[Dispatch] baseUrl debug: ${JSON.stringify({ vercelEnv, hasExplicitAppUrl: Boolean(explicitAppUrl), hasRequestOrigin: Boolean(requestOrigin), productionUrl: productionUrl || null, vercelUrl: vercelUrl || null })}`)
    console.log(`[Dispatch] Template variables: ${JSON.stringify(resolvedTemplateVariables)}`)
    console.log(`[Dispatch] Is localhost: ${isLocalhost}`)

    const traceId = `cmp_${campaignId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    console.log(`[Dispatch] traceId: ${traceId}`)

    const workflowPayload = {
      campaignId,
      traceId,
      templateName,
      contacts: validContacts,
      templateVariables: resolvedTemplateVariables,
      templateSnapshot: {
        name: template.name,
        language: template.language,
        parameter_format: (template as any).parameterFormat || 'positional',
        spec_hash: (template as any).specHash ?? null,
        fetched_at: (template as any).fetchedAt ?? null,
        components: (template as any).components || (template as any).content || [],
      },
      phoneNumberId,
      accessToken,
    }

    if (isLocalhost) {
      // DEV: Call workflow endpoint directly (QStash can't reach localhost)
      console.log('[Dispatch] Localhost detected - calling workflow directly (bypassing QStash)')

      const response = await fetch(`${baseUrl}/api/campaign/workflow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workflowPayload),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Workflow failed with status ${response.status}`)
      }
    } else {
      // PROD: QStash is required
      if (!process.env.QSTASH_TOKEN) {
        return NextResponse.json(
          { error: 'Serviço de workflow não configurado. Configure QSTASH_TOKEN.' },
          { status: 503 }
        )
      }

      // PROD: Use QStash for reliable async execution
      const workflowClient = new Client({ token: process.env.QSTASH_TOKEN })
      await workflowClient.trigger({
        url: `${baseUrl}/api/campaign/workflow`,
        body: workflowPayload,
      })
    }

    return NextResponse.json({
      status: 'queued',
      count: validContacts.length,
      skipped: skippedContacts.length,
      traceId,
      message: `${validContacts.length} mensagens enfileiradas • ${skippedContacts.length} ignoradas por validação`
    }, { status: 202 })

  } catch (error) {
    console.error('Error triggering workflow:', error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      {
        error: 'Falha ao iniciar workflow da campanha',
        details: errorMessage,
        baseUrl: process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || 'not-set'
      },
      { status: 500 }
    )
  }
}
