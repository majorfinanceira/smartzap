/**
 * Setup Save Environment Variables API
 * 
 * POST: Save all env vars to Vercel and trigger redeploy
 */

import { NextRequest, NextResponse } from 'next/server'
import { setEnvVars, redeployLatest, getDeploymentStatus } from '@/lib/vercel-api'
import { randomBytes } from 'node:crypto'

export const runtime = 'nodejs'

function generateKey(prefix: string): string {
  // 32 bytes ~= 43 chars base64url
  return `${prefix}${randomBytes(32).toString('base64url')}`
}

function ensureInternalKeys(envVars: Record<string, any>): { generated: string[] } {
  const generated: string[] = []

  // Importante: o Wizard NÃO envia essas chaves no payload.
  // Se já existirem no ambiente atual (Vercel), preservamos para não rotacionar em cada execução.
  const existingAdmin = (process.env.SMARTZAP_ADMIN_KEY || '').trim()
  const existingApi = (process.env.SMARTZAP_API_KEY || '').trim()

  const adminKey = typeof envVars.SMARTZAP_ADMIN_KEY === 'string' ? envVars.SMARTZAP_ADMIN_KEY.trim() : ''
  const apiKey = typeof envVars.SMARTZAP_API_KEY === 'string' ? envVars.SMARTZAP_API_KEY.trim() : ''

  if (!adminKey && existingAdmin) envVars.SMARTZAP_ADMIN_KEY = existingAdmin
  if (!apiKey && existingApi) envVars.SMARTZAP_API_KEY = existingApi

  const finalAdmin = (typeof envVars.SMARTZAP_ADMIN_KEY === 'string' ? envVars.SMARTZAP_ADMIN_KEY.trim() : '')
  const finalApi = (typeof envVars.SMARTZAP_API_KEY === 'string' ? envVars.SMARTZAP_API_KEY.trim() : '')

  // Se nenhuma foi informada, geramos as duas.
  if (!finalAdmin && !finalApi) {
    envVars.SMARTZAP_ADMIN_KEY = generateKey('szap_admin_')
    envVars.SMARTZAP_API_KEY = generateKey('szap_')
    generated.push('SMARTZAP_ADMIN_KEY', 'SMARTZAP_API_KEY')
    return { generated }
  }

  // Se só uma existir, garantimos pelo menos a ADMIN (mais forte).
  if (!finalAdmin) {
    envVars.SMARTZAP_ADMIN_KEY = generateKey('szap_admin_')
    generated.push('SMARTZAP_ADMIN_KEY')
  }

  // API_KEY é opcional; só geramos se realmente ausente.
  if (!finalApi) {
    envVars.SMARTZAP_API_KEY = generateKey('szap_')
    generated.push('SMARTZAP_API_KEY')
  }

  return { generated }
}

export interface SetupEnvVars {
  // Auth
  MASTER_PASSWORD: string

  // Security (recommended)
  SMARTZAP_API_KEY?: string
  SMARTZAP_ADMIN_KEY?: string

  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: string
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: string
  SUPABASE_SECRET_KEY: string

  // QStash (required)
  QSTASH_TOKEN: string

  // QStash signing keys (optional / advanced)
  QSTASH_CURRENT_SIGNING_KEY?: string
  QSTASH_NEXT_SIGNING_KEY?: string

  // Stats (optional)
  UPSTASH_EMAIL?: string
  UPSTASH_API_KEY?: string
  UPSTASH_CONSOLE_URL?: string

  // Upstash Redis (optional/recommended)
  UPSTASH_REDIS_REST_URL?: string
  UPSTASH_REDIS_REST_TOKEN?: string
  WHATSAPP_STATUS_DEDUPE_TTL_SECONDS?: string

  // WhatsApp
  WHATSAPP_TOKEN?: string
  WHATSAPP_PHONE_ID?: string
  WHATSAPP_BUSINESS_ACCOUNT_ID?: string

  // Vercel (save for future use)
  VERCEL_TOKEN: string
}

export async function POST(request: NextRequest) {
  console.log('=== SAVE-ENV START ===')

  try {
    const body = await request.json()
    console.log('Request body keys:', Object.keys(body))

    const { token, projectId, teamId, envVars } = body as {
      token: string
      projectId: string
      teamId?: string
      envVars: SetupEnvVars
    }

    console.log('Token present:', !!token)
    console.log('ProjectId:', projectId)
    console.log('TeamId:', teamId)
    console.log('EnvVars keys:', Object.keys(envVars || {}))

    if (!token || !projectId || !envVars) {
      console.log('Missing data - token:', !!token, 'projectId:', !!projectId, 'envVars:', !!envVars)
      return NextResponse.json(
        { error: 'Dados incompletos' },
        { status: 400 }
      )
    }

    // Validate required fields
    const requiredFields: (keyof SetupEnvVars)[] = [
      'MASTER_PASSWORD',
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      'SUPABASE_SECRET_KEY',
      'QSTASH_TOKEN',
      'QSTASH_CURRENT_SIGNING_KEY',
    ]

    const missingFields = requiredFields.filter(field => !envVars[field])
    console.log('Missing fields:', missingFields)

    if (missingFields.length > 0) {
      return NextResponse.json(
        { error: `Campos obrigatórios: ${missingFields.join(', ')}` },
        { status: 400 }
      )
    }

    // WhatsApp é opcional: se o usuário preencheu algum campo, exigimos todos.
    const hasAnyWhatsapp = !!(envVars.WHATSAPP_TOKEN || envVars.WHATSAPP_PHONE_ID || envVars.WHATSAPP_BUSINESS_ACCOUNT_ID)
    if (hasAnyWhatsapp) {
      const missingWhatsapp: string[] = []
      if (!envVars.WHATSAPP_TOKEN) missingWhatsapp.push('WHATSAPP_TOKEN')
      if (!envVars.WHATSAPP_PHONE_ID) missingWhatsapp.push('WHATSAPP_PHONE_ID')
      if (!envVars.WHATSAPP_BUSINESS_ACCOUNT_ID) missingWhatsapp.push('WHATSAPP_BUSINESS_ACCOUNT_ID')
      if (missingWhatsapp.length > 0) {
        return NextResponse.json(
          { error: `Para configurar WhatsApp, preencha: ${missingWhatsapp.join(', ')}` },
          { status: 400 }
        )
      }
    }

    // Garante chaves internas (reconciliação, rotas protegidas, etc.)
    const { generated } = ensureInternalKeys(envVars as any)
    if (generated.length > 0) {
      console.log('[save-env] Generated internal keys:', generated)
    }

    // Prepare env vars array
    const envVarsToSave = Object.entries(envVars)
      .filter(([_, value]) => value) // Only non-empty values
      .map(([key, value]) => ({ key, value: value as string }))

    // Add the Vercel token itself for future use
    envVarsToSave.push({ key: 'VERCEL_TOKEN', value: token })

    console.log('Env vars to save count:', envVarsToSave.length)
    console.log('Env var keys to save:', envVarsToSave.map(e => e.key))

    // Save all env vars
    console.log('Calling setEnvVars...')
    const saveResult = await setEnvVars(token, projectId, envVarsToSave, teamId)
    console.log('setEnvVars result:', JSON.stringify(saveResult, null, 2))

    if (!saveResult.success) {
      console.log('Save failed:', saveResult.error)
      return NextResponse.json(
        { error: saveResult.error || 'Erro ao salvar variáveis' },
        { status: 500 }
      )
    }

    // Trigger redeploy
    console.log('Calling redeployLatest...')
    const redeployResult = await redeployLatest(token, projectId, teamId)

    console.log('Redeploy result:', JSON.stringify(redeployResult, null, 2))

    if (!redeployResult.success || !redeployResult.data) {
      console.log('Redeploy failed or no data:', redeployResult.error)
      return NextResponse.json(
        {
          success: true,
          warning: redeployResult.error || 'Variáveis salvas, mas redeploy falhou. Faça manualmente.',
          saved: saveResult.data?.saved || 0,
          redeployError: redeployResult.error,
        }
      )
    }

    console.log('Deployment data:', JSON.stringify(redeployResult.data, null, 2))

    const response = {
      success: true,
      saved: saveResult.data?.saved || 0,
      deployment: {
        id: redeployResult.data.uid || redeployResult.data.id,
        url: redeployResult.data.url,
        state: redeployResult.data.state || redeployResult.data.readyState,
      }
    }

    console.log('=== SAVE-ENV SUCCESS ===', JSON.stringify(response, null, 2))
    return NextResponse.json(response)

  } catch (error) {
    console.error('=== SAVE-ENV ERROR ===', error)
    return NextResponse.json(
      { error: 'Erro ao salvar configuração' },
      { status: 500 }
    )
  }
}

/**
 * GET: Check deployment status
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const token = searchParams.get('token')
    const deploymentId = searchParams.get('deploymentId')
    const teamId = searchParams.get('teamId')

    if (!token || !deploymentId) {
      return NextResponse.json(
        { error: 'Token e deploymentId são obrigatórios' },
        { status: 400 }
      )
    }

    const result = await getDeploymentStatus(token, deploymentId, teamId || undefined)

    if (!result.success || !result.data) {
      return NextResponse.json(
        { error: result.error },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      deployment: {
        id: result.data.uid,
        url: result.data.url,
        state: result.data.readyState || result.data.state,
      }
    })

  } catch (error) {
    console.error('Deployment status error:', error)
    return NextResponse.json(
      { error: 'Erro ao verificar status' },
      { status: 500 }
    )
  }
}
