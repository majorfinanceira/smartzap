/**
 * API Route: Get Environment Variable Status
 * 
 * Returns which env vars are already configured (without exposing values)
 * Used by the wizard to skip already-configured steps
 */

import { NextResponse } from 'next/server'

export const runtime = 'edge'

export async function GET() {
    // Check which env vars exist (return boolean, not values for security)
    const status = {
        // Password
        masterPassword: !!process.env.MASTER_PASSWORD,

        // Supabase
        supabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        supabaseAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        supabaseServiceKey: !!process.env.SUPABASE_SECRET_KEY || !!process.env.SUPABASE_SERVICE_ROLE_KEY,

        // QStash (required)
        qstashToken: !!process.env.QSTASH_TOKEN,
        qstashSigningKey: !!process.env.QSTASH_CURRENT_SIGNING_KEY,

        // Redis (recommended)
        upstashRedisRestUrl: !!process.env.UPSTASH_REDIS_REST_URL,
        upstashRedisRestToken: !!process.env.UPSTASH_REDIS_REST_TOKEN,
        whatsappStatusDedupeTtlSeconds: !!process.env.WHATSAPP_STATUS_DEDUPE_TTL_SECONDS,

        // WhatsApp
        whatsappToken: !!process.env.WHATSAPP_TOKEN,
        whatsappPhoneId: !!process.env.WHATSAPP_PHONE_ID,
        whatsappBusinessId: !!process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    }

    // Calculate which steps are complete
    const steps = {
        password: status.masterPassword,
        database: status.supabaseUrl && status.supabaseAnonKey && status.supabaseServiceKey,
        qstash: status.qstashToken && status.qstashSigningKey,
        whatsapp: status.whatsappToken && status.whatsappPhoneId && status.whatsappBusinessId,
        redis: status.upstashRedisRestUrl && status.upstashRedisRestToken,
    }

    // WhatsApp é opcional no onboarding.
    // O mínimo para considerar a infra pronta é: senha + Supabase + QStash.
    const allConfigured = steps.password && steps.database && steps.qstash

    // Check if we can use server-side Vercel token for resume operations
    const hasVercelToken = !!process.env.VERCEL_TOKEN

    return NextResponse.json({
        status,
        steps,
        allConfigured,
        hasVercelToken,
        // If infra is configured, user only needs to complete company info
        // (WhatsApp pode ser configurado depois em /settings)
        nextStep: allConfigured ? 5 :
            !steps.password ? 1 :
                !steps.database ? 2 :
                    !steps.qstash ? 3 : 5
    })
}
