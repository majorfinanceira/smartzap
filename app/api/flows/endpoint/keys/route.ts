/**
 * API para gerenciar chaves RSA do Flow Endpoint
 *
 * GET - Retorna chave publica atual (para configurar na Meta)
 * POST - Gera novo par de chaves
 * DELETE - Remove chaves configuradas
 */

import { NextResponse } from 'next/server'
import { settingsDb } from '@/lib/supabase-db'
import { isSupabaseConfigured } from '@/lib/supabase'
import {
  generateKeyPair,
  isValidPrivateKey,
} from '@/lib/whatsapp/flow-endpoint-crypto'

const PRIVATE_KEY_SETTING = 'whatsapp_flow_private_key'
const PUBLIC_KEY_SETTING = 'whatsapp_flow_public_key'

/**
 * GET - Retorna status das chaves e URL do endpoint
 */
export async function GET() {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: 'Supabase nao configurado' }, { status: 400 })
    }

    const [privateKey, publicKey] = await Promise.all([
      settingsDb.get(PRIVATE_KEY_SETTING),
      settingsDb.get(PUBLIC_KEY_SETTING),
    ])

    const hasPrivateKey = !!privateKey && isValidPrivateKey(privateKey)
    const hasPublicKey = !!publicKey

    return NextResponse.json({
      configured: hasPrivateKey && hasPublicKey,
      publicKey: hasPublicKey ? publicKey : null,
      endpointUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}/api/flows/endpoint`
        : process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}/api/flows/endpoint`
          : process.env.NEXT_PUBLIC_APP_URL
            ? `${process.env.NEXT_PUBLIC_APP_URL}/api/flows/endpoint`
            : null,
    })
  } catch (error) {
    console.error('[flow-endpoint-keys] GET error:', error)
    return NextResponse.json(
      { error: 'Erro ao verificar chaves' },
      { status: 500 }
    )
  }
}

/**
 * POST - Gera novo par de chaves para o endpoint de flows dinamicos
 *
 * NOTA: O endpoint whatsapp_business_encryption da Meta NAO esta disponivel
 * para Cloud API direto - apenas para BSPs. Por isso, geramos as chaves
 * localmente e confiamos que a Meta ira lidar com a criptografia quando
 * o flow for criado com endpoint_uri.
 *
 * Body opcional:
 * - privateKey: string (importar chave existente)
 * - publicKey: string (importar chave existente)
 */
export async function POST(request: Request) {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: 'Supabase nao configurado' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))

    let privateKey: string
    let publicKey: string

    // Se usuario forneceu chaves, usa elas
    if (body.privateKey && body.publicKey) {
      if (!isValidPrivateKey(body.privateKey)) {
        return NextResponse.json(
          { error: 'Chave privada invalida' },
          { status: 400 }
        )
      }
      privateKey = body.privateKey
      publicKey = body.publicKey
    } else {
      // Gera novo par de chaves
      const keyPair = generateKeyPair()
      privateKey = keyPair.privateKey
      publicKey = keyPair.publicKey
    }

    // Salva as chaves localmente
    await Promise.all([
      settingsDb.set(PRIVATE_KEY_SETTING, privateKey),
      settingsDb.set(PUBLIC_KEY_SETTING, publicKey),
    ])

    return NextResponse.json({
      success: true,
      message: 'Chaves geradas! O endpoint esta pronto para receber requests de flows dinamicos.',
    })
  } catch (error) {
    console.error('[flow-endpoint-keys] POST error:', error)
    return NextResponse.json(
      { error: 'Erro ao gerar chaves' },
      { status: 500 }
    )
  }
}

/**
 * DELETE - Remove chaves configuradas
 */
export async function DELETE() {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: 'Supabase nao configurado' }, { status: 400 })
    }

    await Promise.all([
      settingsDb.set(PRIVATE_KEY_SETTING, ''),
      settingsDb.set(PUBLIC_KEY_SETTING, ''),
    ])

    return NextResponse.json({
      success: true,
      message: 'Chaves removidas',
    })
  } catch (error) {
    console.error('[flow-endpoint-keys] DELETE error:', error)
    return NextResponse.json(
      { error: 'Erro ao remover chaves' },
      { status: 500 }
    )
  }
}
