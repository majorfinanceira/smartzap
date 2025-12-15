import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const revalidate = 0

import { supabase } from '@/lib/supabase'
import { getWhatsAppCredentials } from '@/lib/whatsapp-credentials'
import {
  metaCreateFlow,
  metaGetFlowDetails,
  metaGetFlowPreview,
  metaPublishFlow,
  metaUpdateFlowMetadata,
  metaUploadFlowJsonAsset,
} from '@/lib/meta-flows-api'
import { MetaGraphApiError } from '@/lib/meta-flows-api'
import { generateFlowJsonFromFormSpec, normalizeFlowFormSpec, validateFlowFormSpec } from '@/lib/flow-form'
import { validateMetaFlowJson } from '@/lib/meta-flow-json-validator'

const PublishSchema = z
  .object({
    publish: z.boolean().optional().default(true),
    categories: z.array(z.string().min(1).max(60)).optional().default(['OTHER']),
    // Se true, tenta atualizar (asset) caso já exista meta_flow_id (DRAFT).
    updateIfExists: z.boolean().optional().default(true),
  })
  .strict()

function extractFlowJson(row: any): unknown {
  // Prioridade: flow_json persistido.
  if (row?.flow_json) return row.flow_json

  // Fallback: gerar a partir do spec.form.
  const form = row?.spec?.form
  const normalized = normalizeFlowFormSpec(form, row?.name || 'Flow')
  return generateFlowJsonFromFormSpec(normalized)
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  try {
    const input = PublishSchema.parse(await req.json().catch(() => ({})))

    const credentials = await getWhatsAppCredentials()
    if (!credentials?.accessToken || !credentials.businessAccountId) {
      return NextResponse.json(
        {
          error: 'WhatsApp não configurado. Defina Access Token e WABA ID nas Configurações.',
        },
        { status: 400 }
      )
    }

    // Busca o flow local
    const { data, error } = await supabase.from('flows').select('*').eq('id', id).limit(1)
    if (error) return NextResponse.json({ error: error.message || 'Falha ao buscar flow' }, { status: 500 })

    const row = Array.isArray(data) ? data[0] : (data as any)
    if (!row) return NextResponse.json({ error: 'Flow não encontrado' }, { status: 404 })

    let flowJson = extractFlowJson(row)

    // Validação “local” (rápida) para evitar publicar algo obviamente inválido.
    // A validação oficial é da Meta e vem em validation_errors.
    const formIssues = row?.spec?.form ? validateFlowFormSpec(normalizeFlowFormSpec(row.spec.form, row?.name || 'Flow')) : []
    if (formIssues.length > 0) {
      return NextResponse.json(
        {
          error: 'Ajustes necessários antes de publicar',
          issues: formIssues,
        },
        { status: 400 }
      )
    }

    // Validação do schema do Flow JSON (mais próximo do que a Meta espera) antes de chamar a Graph API.
    // Isso evita o "(100) Invalid parameter" sem contexto.
    let localValidation = validateMetaFlowJson(flowJson)

    // Se o flow_json persistido estiver legado/inválido, tentamos regenerar do spec.form automaticamente.
    if (!localValidation.isValid && row?.spec?.form) {
      const normalized = normalizeFlowFormSpec(row.spec.form, row?.name || 'Flow')
      const regenerated = generateFlowJsonFromFormSpec(normalized)
      const regeneratedValidation = validateMetaFlowJson(regenerated)

      if (regeneratedValidation.isValid) {
        flowJson = regenerated
        localValidation = regeneratedValidation
      }
    }

    if (!localValidation.isValid) {
      const now = new Date().toISOString()
      await supabase
        .from('flows')
        .update({
          updated_at: now,
          meta_last_checked_at: now,
          meta_validation_errors: { source: 'local', ...localValidation },
        })
        .eq('id', id)

      return NextResponse.json(
        {
          error: 'Flow JSON inválido para a Meta. Corrija os itens antes de publicar.',
          validation: localValidation,
        },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()

    let metaFlowId: string | null = typeof row?.meta_flow_id === 'string' && row.meta_flow_id.trim() ? row.meta_flow_id.trim() : null

    let validationErrors: unknown = null
    let metaStatus: string | null = null
    let previewUrl: string | null = null

    if (!metaFlowId) {
      // Criar na Meta (com publish opcional em um único request)
      const created = await metaCreateFlow({
        accessToken: credentials.accessToken,
        wabaId: credentials.businessAccountId,
        name: String(row?.name || 'Flow'),
        categories: input.categories.length > 0 ? input.categories : ['OTHER'],
        flowJson,
        publish: !!input.publish,
      })

      metaFlowId = created.id
      validationErrors = created.validation_errors ?? null

      // Atualiza detalhes (status etc.)
      const details = await metaGetFlowDetails({ accessToken: credentials.accessToken, flowId: metaFlowId })
      metaStatus = details.status || null

      // Preview
      const preview = await metaGetFlowPreview({ accessToken: credentials.accessToken, flowId: metaFlowId })
      previewUrl = typeof preview?.preview?.preview_url === 'string' ? preview.preview.preview_url : null
    } else {
      // Já existe: tentar atualizar (apenas se ainda for possível)
      let details = await metaGetFlowDetails({ accessToken: credentials.accessToken, flowId: metaFlowId })
      metaStatus = details.status || null

      // Se está publicado, não dá para modificar; nesse caso, orientamos clonar.
      if (metaStatus === 'PUBLISHED') {
        return NextResponse.json(
          {
            error:
              'Esse Flow já está PUBLISHED na Meta e não pode ser alterado. Crie um novo Flow (clone) ou remova o Meta Flow ID para publicar como novo.',
            metaFlowId,
            metaStatus,
          },
          { status: 409 }
        )
      }

      if (input.updateIfExists) {
        await metaUpdateFlowMetadata({
          accessToken: credentials.accessToken,
          flowId: metaFlowId,
          name: String(row?.name || 'Flow'),
          categories: input.categories.length > 0 ? input.categories : ['OTHER'],
        })

        const uploaded = await metaUploadFlowJsonAsset({
          accessToken: credentials.accessToken,
          flowId: metaFlowId,
          flowJson,
        })
        validationErrors = uploaded.validation_errors ?? null

        if (input.publish) {
          await metaPublishFlow({ accessToken: credentials.accessToken, flowId: metaFlowId })
        }

        details = await metaGetFlowDetails({ accessToken: credentials.accessToken, flowId: metaFlowId })
        metaStatus = details.status || null

        const preview = await metaGetFlowPreview({ accessToken: credentials.accessToken, flowId: metaFlowId })
        previewUrl = typeof preview?.preview?.preview_url === 'string' ? preview.preview.preview_url : null
      }
    }

    // Persistir no Supabase
    const update: Record<string, unknown> = {
      updated_at: now,
      meta_flow_id: metaFlowId,
      meta_status: metaStatus,
      meta_preview_url: previewUrl,
      meta_validation_errors: validationErrors,
      meta_last_checked_at: now,
      ...(metaStatus === 'PUBLISHED' ? { meta_published_at: now } : {}),
    }

    const { data: updated, error: updErr } = await supabase.from('flows').update(update).eq('id', id).select('*').limit(1)
    if (updErr) {
      return NextResponse.json(
        {
          error: updErr.message || 'Falha ao salvar status do Flow',
          metaFlowId,
          metaStatus,
          metaPreviewUrl: previewUrl,
          validationErrors,
        },
        { status: 500 }
      )
    }

    const updatedRow = Array.isArray(updated) ? updated[0] : (updated as any)

    return NextResponse.json({
      ok: true,
      metaFlowId,
      metaStatus,
      metaPreviewUrl: previewUrl,
      validationErrors,
      row: updatedRow,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Falha ao publicar Flow'

    // Em dev, devolvemos detalhes do erro da Graph API para facilitar debug (sem incluir token).
    if (process.env.NODE_ENV !== 'production' && error instanceof MetaGraphApiError) {
      return NextResponse.json(
        {
          error: msg,
          meta: {
            status: error.status,
            graphError: (error.data as any)?.error ?? error.data,
          },
        },
        { status: 400 }
      )
    }

    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
