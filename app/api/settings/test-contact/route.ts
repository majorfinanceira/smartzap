import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { normalizePhoneNumber, validateAnyPhoneNumber } from '@/lib/phone-formatter'

/**
 * API Route: Test Contact Settings
 * 
 * Persists the test contact (name + phone) in Supabase settings table
 * This replaces the localStorage approach for better persistence
 */

const SETTING_KEY = 'test_contact'

export async function GET() {
    try {
        const { data, error } = await supabase
            .from('settings')
            .select('value')
            .eq('key', SETTING_KEY)
            .single()

        if (error && error.code !== 'PGRST116') { // PGRST116 = not found
            throw error
        }

        if (data?.value) {
            // Parse JSON string to object (column is TEXT type)
            const parsed = typeof data.value === 'string'
                ? JSON.parse(data.value)
                : data.value
            return NextResponse.json(parsed)
        }

        return NextResponse.json(null)
    } catch (error) {
        console.error('Error fetching test contact:', error)
        return NextResponse.json(
            { error: 'Failed to fetch test contact' },
            { status: 500 }
        )
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { name, phone } = body

        if (!phone) {
            return NextResponse.json(
                { error: 'Phone number is required' },
                { status: 400 }
            )
        }

        // Normalize first so we accept inputs like "5511999999999" (without '+')
        const normalizedPhoneE164 = normalizePhoneNumber(String(phone))

        const phoneValidation = validateAnyPhoneNumber(normalizedPhoneE164)
        if (!phoneValidation.isValid) {
            return NextResponse.json(
                { error: phoneValidation.error || 'Telefone inválido' },
                { status: 400 }
            )
        }

        const testContact = {
            name: name?.trim() || '',
            phone: normalizedPhoneE164,
            updatedAt: new Date().toISOString()
        }

        // Upsert into settings table (stringify for TEXT column)
        const { error } = await supabase
            .from('settings')
            .upsert({
                key: SETTING_KEY,
                value: JSON.stringify(testContact)
            }, {
                onConflict: 'key'
            })

        if (error) throw error

        return NextResponse.json({
            success: true,
            testContact
        })
    } catch (error) {
        console.error('Error saving test contact:', error)
        return NextResponse.json(
            { error: 'Failed to save test contact' },
            { status: 500 }
        )
    }
}

export async function DELETE() {
    try {
        const { error } = await supabase
            .from('settings')
            .delete()
            .eq('key', SETTING_KEY)

        if (error) throw error

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting test contact:', error)
        return NextResponse.json(
            { error: 'Failed to delete test contact' },
            { status: 500 }
        )
    }
}
