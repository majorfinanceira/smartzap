/**
 * API Route: Local Install - Write/Upsert .env.local
 *
 * Security:
 * - Only allowed when NODE_ENV !== 'production'
 * - Only allowed from localhost/127.0.0.1/::1
 *
 * Purpose:
 * - Enable local installation via the setup wizard without a Vercel token.
 * - Preserves existing .env.local content and only upserts allowed keys.
 */

import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

export const runtime = 'nodejs'

const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

const ALLOWED_KEYS = new Set([
  'MASTER_PASSWORD',
  // Security (recommended)
  'SMARTZAP_API_KEY',
  'SMARTZAP_ADMIN_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  // Alias compat: some setups use *_DEFAULT_KEY
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY',
  // Alias compat: Supabase dashboard often calls this ANON_KEY
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SECRET_KEY',
  // Alias compat: some setups use this name for the service role key
  'SUPABASE_SERVICE_ROLE_KEY',
  'QSTASH_TOKEN',
  'QSTASH_CURRENT_SIGNING_KEY',
  'QSTASH_NEXT_SIGNING_KEY',
  'UPSTASH_EMAIL',
  'UPSTASH_API_KEY',
  // Upstash Redis (optional/recommended)
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'WHATSAPP_STATUS_DEDUPE_TTL_SECONDS',
  'WHATSAPP_TOKEN',
  'WHATSAPP_PHONE_ID',
  'WHATSAPP_BUSINESS_ACCOUNT_ID',
  // Setup metadata (used for resume mode)
  'SETUP_COMPLETE',
  'SETUP_COMPANY_NAME',
  'SETUP_COMPANY_ADMIN',
  'SETUP_COMPANY_EMAIL',
  'SETUP_COMPANY_PHONE',
])

function ensureInternalKeys(envVars: Record<string, string>) {
  const adminKey = (envVars.SMARTZAP_ADMIN_KEY || '').trim()
  const apiKey = (envVars.SMARTZAP_API_KEY || '').trim()

  // Preserve from current process env (dev) if present
  const existingAdmin = (process.env.SMARTZAP_ADMIN_KEY || '').trim()
  const existingApi = (process.env.SMARTZAP_API_KEY || '').trim()
  if (!adminKey && existingAdmin) envVars.SMARTZAP_ADMIN_KEY = existingAdmin
  if (!apiKey && existingApi) envVars.SMARTZAP_API_KEY = existingApi

  const finalAdmin = (envVars.SMARTZAP_ADMIN_KEY || '').trim()
  const finalApi = (envVars.SMARTZAP_API_KEY || '').trim()

  if (!finalAdmin && !finalApi) {
    envVars.SMARTZAP_ADMIN_KEY = `szap_admin_${randomBytes(32).toString('base64url')}`
    envVars.SMARTZAP_API_KEY = `szap_${randomBytes(32).toString('base64url')}`
    return
  }

  if (!finalAdmin) {
    envVars.SMARTZAP_ADMIN_KEY = `szap_admin_${randomBytes(32).toString('base64url')}`
  }

  if (!finalApi) {
    envVars.SMARTZAP_API_KEY = `szap_${randomBytes(32).toString('base64url')}`
  }
}

function getEnvValueFromFile(content: string, key: string): string | null {
  // Supports: KEY=value, export KEY=value, spaces.
  const re = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*(.*)\\s*$`, 'm')
  const m = content.match(re)
  if (!m) return null
  const raw = (m[1] || '').trim()
  if (!raw) return ''
  // Remove surrounding quotes (simple .env parsing)
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1)
  }
  return raw
}

function getHostnameFromHeaders(request: NextRequest): string {
  const raw =
    request.headers.get('x-forwarded-host') ||
    request.headers.get('host') ||
    ''

  // raw examples: "localhost:3000", "127.0.0.1:3000"
  return raw.split(',')[0]?.trim().split(':')[0]?.toLowerCase() || ''
}

function assertLocalAccess(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return { ok: false as const, reason: 'forbidden_in_production' as const }
  }

  const hostname = request.nextUrl?.hostname?.toLowerCase?.() || getHostnameFromHeaders(request)
  if (!ALLOWED_HOSTS.has(hostname)) {
    return { ok: false as const, reason: 'forbidden_host' as const, hostname }
  }

  return { ok: true as const }
}

function pickAllowedEnvVars(envVars: unknown): Record<string, string> {
  if (!envVars || typeof envVars !== 'object') return {}

  const picked: Record<string, string> = {}
  let supabasePublishableDefault: string | undefined
  for (const [key, value] of Object.entries(envVars as Record<string, unknown>)) {
    if (!ALLOWED_KEYS.has(key)) continue
    if (typeof value !== 'string') continue

    // Normalize alias -> canonical key on write
    if (key === 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY') {
      supabasePublishableDefault = value
      continue
    }

    picked[key] = value
  }

  if (typeof supabasePublishableDefault === 'string' && !picked.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    picked.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = supabasePublishableDefault
  }

  return picked
}

function serializeEnvValue(value: string): string {
  // Keep empty as empty (KEY=)
  if (value === '') return ''

  const needsQuotes = /[\s#"'\n\r]/.test(value)
  if (!needsQuotes) return value

  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')

  return `"${escaped}"`
}

function upsertEnvFileContent(
  existing: string,
  entries: Record<string, string>
): string {
  const eol = existing.includes('\r\n') ? '\r\n' : '\n'
  const lines = existing.length ? existing.split(/\r?\n/) : []

  const aliasToCanonical: Record<string, string> = {
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  }

  const hasRawKeyInFile = new Set<string>()
  for (const line of lines) {
    const match = line.match(/^(\s*(?:export\s+)?)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)
    if (!match) continue
    hasRawKeyInFile.add(match[2])
  }

  const remaining = new Set(Object.keys(entries))

  let canonicalWrittenFromAlias = false

  const updatedLines = lines.map((line) => {
    // Supports: KEY=..., export KEY=..., leading spaces
    const match = line.match(/^(\s*(?:export\s+)?)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)
    if (!match) return line

    const prefix = match[1] ?? ''
    const key = match[2]

    const canonicalKey = aliasToCanonical[key] ?? key

    // If the file has an alias key, normalize it to the canonical key.
    // Canonical wins: if a canonical line already exists, drop the alias line.
    if (canonicalKey !== key && Object.prototype.hasOwnProperty.call(entries, canonicalKey)) {
      remaining.delete(canonicalKey)

      // If the canonical key already exists as a raw key in the file, remove the alias line.
      if (hasRawKeyInFile.has(canonicalKey)) {
        return null
      }

      // If there are multiple alias lines, only the first one should become canonical.
      if (canonicalWrittenFromAlias) {
        return null
      }

      canonicalWrittenFromAlias = true
      return `${prefix}${canonicalKey}=${serializeEnvValue(entries[canonicalKey])}`
    }

    if (!Object.prototype.hasOwnProperty.call(entries, key)) return line

    remaining.delete(key)
    return `${prefix}${key}=${serializeEnvValue(entries[key])}`
  })

  const filteredLines = updatedLines.filter((l): l is string => typeof l === 'string')

  let out = filteredLines.join(eol)

  // If there are new keys, append them at the end.
  if (remaining.size > 0) {
    const needsLeadingEol = out.length > 0 && !out.endsWith(eol)
    if (needsLeadingEol) out += eol

    // Separate with a blank line if file already has content.
    if (out.trim().length > 0) out += eol

    out += Array.from(remaining)
      .sort()
      .map((key) => `${key}=${serializeEnvValue(entries[key])}`)
      .join(eol)

    out += eol
  }

  return out
}

export async function POST(request: NextRequest) {
  const access = assertLocalAccess(request)
  if (!access.ok) {
    return NextResponse.json(
      { error: 'Acesso negado', reason: access.reason, hostname: (access as any).hostname },
      { status: 403 }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const envVars = pickAllowedEnvVars((body as any)?.envVars)

  const envPath = path.join(process.cwd(), '.env.local')

  let existing = ''
  try {
    existing = await fs.readFile(envPath, 'utf8')
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      console.error('Failed to read .env.local:', err)
      return NextResponse.json({ error: 'Erro ao ler .env.local' }, { status: 500 })
    }
  }

  // Preserva chaves internas existentes no arquivo ao reexecutar wizard.
  const existingAdmin = getEnvValueFromFile(existing, 'SMARTZAP_ADMIN_KEY')
  const existingApi = getEnvValueFromFile(existing, 'SMARTZAP_API_KEY')
  if (!envVars.SMARTZAP_ADMIN_KEY && existingAdmin) envVars.SMARTZAP_ADMIN_KEY = existingAdmin
  if (!envVars.SMARTZAP_API_KEY && existingApi) envVars.SMARTZAP_API_KEY = existingApi

  // Gera chaves internas automaticamente no modo local (somente se faltarem).
  ensureInternalKeys(envVars)

  const keys = Object.keys(envVars)
  if (keys.length === 0) {
    return NextResponse.json(
      { error: 'Nenhuma variável válida para salvar' },
      { status: 400 }
    )
  }

  const updated = upsertEnvFileContent(existing, envVars)

  try {
    await fs.writeFile(envPath, updated, 'utf8')
  } catch (err) {
    console.error('Failed to write .env.local:', err)
    return NextResponse.json({ error: 'Erro ao escrever .env.local' }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    file: '.env.local',
    updatedKeys: keys.sort(),
  })
}
