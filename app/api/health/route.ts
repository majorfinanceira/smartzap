import { NextResponse } from 'next/server'
import { getWhatsAppCredentials, getCredentialsSource } from '@/lib/whatsapp-credentials'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { redis } from '@/lib/redis'

// Build Vercel dashboard URL dynamically from environment
function getVercelDashboardUrl(): string | null {
  const vercelUrl = process.env.VERCEL_URL
  if (!vercelUrl) return null

  const cleanUrl = vercelUrl.replace('.vercel.app', '')
  const scopeMatch = cleanUrl.match(/-([a-z0-9]+-projects)$/) || cleanUrl.match(/-([a-z0-9-]+)$/)
  if (!scopeMatch) return null

  const scope = scopeMatch[1]
  const beforeScope = cleanUrl.replace(`-${scope}`, '')
  const lastHyphen = beforeScope.lastIndexOf('-')
  if (lastHyphen === -1) return null

  const possibleHash = beforeScope.substring(lastHyphen + 1)
  const projectName = beforeScope.substring(0, lastHyphen)

  if (!/^[a-z0-9]{7,12}$/.test(possibleHash)) {
    return null
  }

  return `https://vercel.com/${scope}/${projectName}`
}

interface HealthCheckResult {
  overall: 'healthy' | 'degraded' | 'unhealthy'
  services: {
    database: {
      status: 'ok' | 'error' | 'not_configured'
      provider: 'supabase' | 'none'
      latency?: number
      message?: string
    }
    redis: {
      status: 'ok' | 'error' | 'not_configured'
      latency?: number
      message?: string
    }
    qstash: {
      status: 'ok' | 'error' | 'not_configured'
      message?: string
    }
    whatsapp: {
      status: 'ok' | 'error' | 'not_configured'
      source?: 'db' | 'env' | 'none'
      phoneNumber?: string
      message?: string
    }
  }
  vercel?: {
    dashboardUrl: string | null
    storesUrl: string | null
    env: string
  }
  timestamp: string
}

export async function GET() {
  const dashboardUrl = getVercelDashboardUrl()

  const result: HealthCheckResult = {
    overall: 'healthy',
    services: {
      database: { status: 'not_configured', provider: 'none' },
      redis: { status: 'not_configured' },
      qstash: { status: 'not_configured' },
      whatsapp: { status: 'not_configured' },
    },
    vercel: {
      dashboardUrl,
      storesUrl: dashboardUrl ? `${dashboardUrl}/stores` : null,
      env: process.env.VERCEL_ENV || 'development',
    },
    timestamp: new Date().toISOString(),
  }

  // 1. Check Database (Supabase)
  if (isSupabaseConfigured()) {
    try {
      const start = Date.now()
      const { error } = await supabase.from('settings').select('key').limit(1)
      const latency = Date.now() - start

      if (error && !error.message.includes('does not exist')) {
        throw error
      }

      result.services.database = {
        status: 'ok',
        provider: 'supabase',
        latency,
        message: `Supabase connected (${latency}ms)`,
      }
    } catch (error) {
      result.services.database = {
        status: 'error',
        provider: 'supabase',
        message: error instanceof Error ? error.message : (error as any)?.message || 'Connection failed',
      }
      result.overall = 'unhealthy'
    }
  } else {
    result.services.database = {
      status: 'not_configured',
      provider: 'none',
      message: 'Supabase not configured',
    }
    result.overall = 'unhealthy'
  }

  // 2. Check Redis (Upstash)
  if (redis) {
    try {
      const start = Date.now()
      // `PING` é a verificação mais barata. Se não existir, faz um GET inocente.
      const maybePing = (redis as any).ping
      if (typeof maybePing === 'function') {
        await maybePing.call(redis)
      } else {
        await redis.get('__healthcheck__')
      }
      const latency = Date.now() - start

      result.services.redis = {
        status: 'ok',
        latency,
        message: `Redis conectado (${latency}ms)`,
      }
    } catch (error) {
      result.services.redis = {
        status: 'error',
        message: error instanceof Error ? error.message : (error as any)?.message || 'Connection failed',
      }
      result.overall = 'degraded'
    }
  } else {
    result.services.redis = {
      status: 'not_configured',
      message: 'Upstash Redis not configured',
    }
    result.overall = result.overall === 'healthy' ? 'degraded' : result.overall
  }

  // 3. Check QStash
  if (process.env.QSTASH_TOKEN) {
    result.services.qstash = {
      status: 'ok',
      message: 'Token configured',
    }
  } else {
    result.services.qstash = {
      status: 'not_configured',
      message: 'QSTASH_TOKEN not configured',
    }
    result.overall = 'degraded'
  }

  // 4. Check WhatsApp credentials
  try {
    const source = await getCredentialsSource()
    const credentials = await getWhatsAppCredentials()

    if (credentials) {
      // Test connection to Meta API
      const testUrl = `https://graph.facebook.com/v24.0/${credentials.phoneNumberId}?fields=display_phone_number`
      const response = await fetch(testUrl, {
        headers: { 'Authorization': `Bearer ${credentials.accessToken}` },
      })

      if (response.ok) {
        const data = await response.json()
        result.services.whatsapp = {
          status: 'ok',
          source,
          phoneNumber: data.display_phone_number,
          message: `Connected: ${data.display_phone_number}`,
        }
      } else {
        const error = await response.json()
        result.services.whatsapp = {
          status: 'error',
          source,
          message: error.error?.message || 'Token invalid or expired',
        }
        result.overall = 'degraded'
      }
    } else {
      result.services.whatsapp = {
        status: 'not_configured',
        source: 'none',
        message: 'WhatsApp credentials not configured',
      }
      result.overall = 'unhealthy'
    }
  } catch (error) {
    result.services.whatsapp = {
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
    }
    result.overall = 'degraded'
  }

  // Determine overall status
  const statuses = Object.values(result.services).map(s => s.status)
  if (statuses.every(s => s === 'ok')) {
    result.overall = 'healthy'
  } else if (statuses.some(s => s === 'error') || statuses.filter(s => s === 'not_configured').length > 1) {
    result.overall = 'unhealthy'
  } else {
    result.overall = 'degraded'
  }

  return NextResponse.json(result, {
    headers: {
      'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
    },
  })
}
