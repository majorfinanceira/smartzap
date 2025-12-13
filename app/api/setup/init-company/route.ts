import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { normalizePhoneNumber, validateAnyPhoneNumber } from '@/lib/phone-formatter'

export const runtime = 'nodejs'

function getFirstName(fullName: string): string {
    const normalized = fullName.trim().replace(/\s+/gu, ' ')
    if (!normalized) return ''
    const [first] = normalized.split(' ')
    return first || normalized
}

export async function GET() {
    try {
        // STEP 1: Verificar se o banco está inicializado
        const { data: tables, error: checkError } = await supabase
            .from('settings')
            .select('key')
            .limit(1)

        if (checkError && checkError.message.includes('relation "settings" does not exist')) {
            return NextResponse.json(
                {
                    success: false,
                    error: 'Banco ainda não inicializado (tabelas ausentes). Execute o SQL de inicialização no Supabase e tente novamente.',
                },
                { status: 400 }
            )
        }

        // STEP 2: Init company
        // Check if we have company info in env vars (set during wizard)
        const companyName = process.env.SETUP_COMPANY_NAME
        const companyAdmin = process.env.SETUP_COMPANY_ADMIN
        const companyEmail = process.env.SETUP_COMPANY_EMAIL
        const companyPhone = process.env.SETUP_COMPANY_PHONE

        if (!companyName || !companyAdmin || !companyEmail || !companyPhone) {
            return NextResponse.json({
                success: false,
                message: 'No company info in environment'
            })
        }

        // After the guard above, treat all env vars as required strings.
        const companyNameStr = companyName
        const companyAdminStr = companyAdmin.trim()
        const companyEmailStr = companyEmail.toLowerCase()
        const companyPhoneStr = companyPhone

        // Normalize first so we accept inputs like "5511999999999" (without '+')
        const normalizedPhoneE164 = normalizePhoneNumber(companyPhoneStr)

        const phoneValidation = validateAnyPhoneNumber(normalizedPhoneE164)
        if (!phoneValidation.isValid) {
            return NextResponse.json(
                {
                    success: false,
                    error: phoneValidation.error || 'Telefone inválido',
                },
                { status: 400 }
            )
        }
        const storedPhoneDigits = normalizedPhoneE164.replace(/\D/g, '')

        // Try to save to database
        const now = new Date().toISOString()
        const companyId = crypto.randomUUID()

        // Check if company already exists
        const { data: existingCompany } = await supabase
            .from('settings')
            .select('key, value')
            .in('key', ['company_name', 'company_admin', 'test_contact'])

        const existing: Record<string, string> = {}
        if (Array.isArray(existingCompany)) {
            for (const row of existingCompany) existing[row.key] = row.value
        }

        const desiredName = (() => {
            const adminFullName = companyAdminStr
            const first = getFirstName(adminFullName)
            return first || adminFullName
        })()

        async function seedTestContactIfMissingOrUpgradeable(): Promise<void> {
            // 1) Se não existe, cria.
            if (!existing.test_contact) {
                await supabase
                    .from('settings')
                    .upsert({
                        key: 'test_contact',
                        value: JSON.stringify({
                            name: desiredName,
                            phone: normalizedPhoneE164,
                            updatedAt: now,
                        }),
                        updated_at: now,
                    }, { onConflict: 'key' })
                return
            }

            // 2) Se existe, só faz upgrade seguro (não sobrescreve personalizações).
            try {
                const parsed = JSON.parse(existing.test_contact) as unknown
                if (!parsed || typeof parsed !== 'object') return
                const tc = parsed as { name?: unknown; phone?: unknown }

                const currentName = typeof tc.name === 'string' ? tc.name.trim() : ''
                const currentPhoneRaw = typeof tc.phone === 'string' ? tc.phone.trim() : ''
                const currentPhoneDigits = currentPhoneRaw.replace(/\D/g, '')
                const adminFullName = companyAdminStr

                // Se o telefone bate por dígitos e o valor atual não está em E.164, normaliza.
                const shouldUpgradePhoneToE164 = !!currentPhoneRaw && !currentPhoneRaw.startsWith('+')
                if (shouldUpgradePhoneToE164 && currentPhoneDigits === storedPhoneDigits) {
                    await supabase
                        .from('settings')
                        .upsert({
                            key: 'test_contact',
                            value: JSON.stringify({
                                ...tc,
                                phone: normalizedPhoneE164,
                                updatedAt: now,
                            }),
                            updated_at: now,
                        }, { onConflict: 'key' })
                }

                // Se parece seed antigo com nome completo do admin, ajusta para primeiro nome.
                if (currentName === adminFullName && currentPhoneDigits === storedPhoneDigits) {
                    await supabase
                        .from('settings')
                        .upsert({
                            key: 'test_contact',
                            value: JSON.stringify({
                                ...tc,
                                name: desiredName,
                                phone: normalizedPhoneE164,
                                updatedAt: now,
                            }),
                            updated_at: now,
                        }, { onConflict: 'key' })
                }
            } catch {
                // Se não for JSON válido, não mexe.
            }
        }

        // Se a empresa já existe, garantimos apenas que company_admin exista.
        if (existing.company_name) {
            if (!existing.company_admin) {
                await supabase
                    .from('settings')
                    .upsert({ key: 'company_admin', value: companyAdminStr, updated_at: now }, { onConflict: 'key' })
            }

            // Garantir que sempre exista test_contact após full setup
            await seedTestContactIfMissingOrUpgradeable()

            return NextResponse.json({
                success: true,
                message: existing.company_admin ? 'Company already initialized' : 'Company admin initialized successfully'
            })
        }

        // Save company info
        await Promise.all([
            supabase.from('settings').upsert({ key: 'company_id', value: companyId, updated_at: now }, { onConflict: 'key' }),
            supabase.from('settings').upsert({ key: 'company_name', value: companyNameStr, updated_at: now }, { onConflict: 'key' }),
            supabase.from('settings').upsert({ key: 'company_admin', value: companyAdminStr, updated_at: now }, { onConflict: 'key' }),
            supabase.from('settings').upsert({ key: 'company_email', value: companyEmailStr, updated_at: now }, { onConflict: 'key' }),
            supabase.from('settings').upsert({ key: 'company_phone', value: storedPhoneDigits, updated_at: now }, { onConflict: 'key' }),
            supabase.from('settings').upsert({ key: 'company_created_at', value: now, updated_at: now }, { onConflict: 'key' }),
        ])

        // Garantir que sempre exista test_contact após full setup
        await seedTestContactIfMissingOrUpgradeable()

        return NextResponse.json({
            success: true,
            message: 'Company initialized successfully',
            company: {
                id: companyId,
                name: companyNameStr,
                email: companyEmailStr,
                phone: companyPhoneStr
            }
        })

    } catch (error) {
        console.error('Init company error:', error)
        return NextResponse.json({
            success: false,
            error: 'Failed to initialize company'
        }, { status: 500 })
    }
}
