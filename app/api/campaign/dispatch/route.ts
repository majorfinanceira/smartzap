import { NextRequest, NextResponse } from 'next/server'
import { Client } from '@upstash/workflow'
import { getWhatsAppCredentials } from '@/lib/whatsapp-credentials'
import { supabase } from '@/lib/supabase'
import { templateDb } from '@/lib/supabase-db'

import { precheckContactForTemplate } from '@/lib/whatsapp/template-contract'
import { normalizePhoneNumber } from '@/lib/phone-formatter'

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

// Generate simple ID
// Trigger campaign dispatch workflow
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { campaignId, templateName, whatsappCredentials, templateVariables, flowId } = body
  let { contacts } = body

  // Get template variables from campaign if not provided directly
  let resolvedTemplateVariables: any = templateVariables
  if (!resolvedTemplateVariables) {
    const { data: campaign, error } = await supabase
      .from('campaigns')
      .select('template_variables')
      .eq('id', campaignId)
      .single()

    if (campaign && (campaign as any).template_variables != null) {
      // JSONB should already be a native JS object; keep a string fallback for safety.
      const tv = (campaign as any).template_variables
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

    const { data: existing } = await supabase
      .from('campaigns')
      .select('template_spec_hash')
      .eq('id', campaignId)
      .single()

    // Só setar snapshot se ainda não existir (evita drift/regravação em replays)
    if (!(existing as any)?.template_spec_hash) {
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

  // 2) Tentar resolver contactId faltante via contacts.phone
  const missingId = normalizedInput.filter((c) => !c.contactId)
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

      for (const c of normalizedInput) {
        if (c.contactId) continue
        const raw = String(c.phone || '').trim()
        const normalized = raw ? normalizePhoneNumber(raw) : ''
        c.contactId = idByPhone.get(raw) || (normalized ? idByPhone.get(normalized) : undefined)
      }
    }
  }

  // 3) Se ainda houver contato sem ID, bloqueia para evitar dados inconsistentes.
  //    (Isso elimina definitivamente o caminho "sem contactId" no workflow.)
  const stillMissing = normalizedInput.filter((c) => !c.contactId)
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

  const validContacts: DispatchContactResolved[] = []
  const skippedContacts: Array<{ contact: DispatchContact; code: string; reason: string; normalizedPhone?: string }> = []

  for (const c of normalizedInput) {
    const contactId = c.contactId
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

  // Persistir snapshot + status por contato (pending vs skipped)
  try {
    const rowsPending = validContacts.map(c => ({
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

    const rowsSkipped = skippedContacts.map(({ contact, code, reason, normalizedPhone }) => ({
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
      error: null,
    }))

    const allRows = [...rowsPending, ...rowsSkipped]
    if (allRows.length) {
      const { error } = await supabase
        .from('campaign_contacts')
        .upsert(allRows, { onConflict: 'campaign_id, contact_id' })

      if (error) throw error
    }

    console.log(`[Dispatch] Pré-check: ${validContacts.length} válidos, ${skippedContacts.length} ignorados (skipped)`)
  } catch (error) {
    console.error('[Dispatch] Failed to persist pre-check results:', error)
    return NextResponse.json(
      { error: 'Falha ao salvar validação de contatos' },
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

  // Get credentials: Body (if valid) > Redis > Env
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
    // Priority: NEXT_PUBLIC_APP_URL > VERCEL_PROJECT_PRODUCTION_URL > VERCEL_URL > localhost
    // VERCEL_PROJECT_PRODUCTION_URL is auto-set by Vercel to the production domain (stable)
    // VERCEL_URL changes with each deployment (not ideal for QStash callbacks)
    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL?.trim())
      || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.trim()}` : null)
      || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.trim()}` : null)
      || 'http://localhost:3000'

    const isLocalhost = baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')

    console.log(`[Dispatch] Triggering workflow at: ${baseUrl}/api/campaign/workflow`)
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
