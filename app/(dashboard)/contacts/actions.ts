'use server'

import { createClient } from '@/lib/supabase-server'
import type { Contact, ContactStatus, CustomFieldDefinition } from '@/types'

const PAGE_SIZE = 50

export interface ContactsInitialData {
  contacts: Contact[]
  total: number
  stats: {
    total: number
    active: number
    optOut: number
    suppressed: number
  }
  tags: string[]
  customFields: CustomFieldDefinition[]
}

/**
 * Busca dados iniciais de contatos no servidor (RSC).
 */
export async function getContactsInitialData(): Promise<ContactsInitialData> {
  const supabase = await createClient()

  // Buscar tudo em paralelo
  const [contactsResult, statsResult, tagsResult, customFieldsResult] = await Promise.all([
    // Primeira página de contatos
    supabase
      .from('contacts')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(0, PAGE_SIZE - 1),

    // Stats agregados
    supabase.rpc('get_contact_stats'),

    // Tags únicas
    supabase
      .from('contacts')
      .select('tags')
      .not('tags', 'is', null),

    // Campos customizados
    supabase
      .from('custom_field_definitions')
      .select('*')
      .eq('entity_type', 'contact')
      .order('name')
  ])

  // Mapear contatos
  const contacts: Contact[] = (contactsResult.data || []).map(c => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    status: c.status as ContactStatus,
    tags: c.tags || [],
    lastActive: c.last_active || c.updated_at || c.created_at,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    custom_fields: c.custom_fields,
    suppressionReason: c.suppression_reason,
    suppressionSource: c.suppression_source,
    suppressionExpiresAt: c.suppression_expires_at
  }))

  // Extrair tags únicas
  const allTags = new Set<string>()
  ;(tagsResult.data || []).forEach(row => {
    if (Array.isArray(row.tags)) {
      row.tags.forEach((tag: string) => allTags.add(tag))
    }
  })

  // Stats com fallback
  const stats = statsResult.data || { total: 0, active: 0, opt_out: 0, suppressed: 0 }

  return {
    contacts,
    total: contactsResult.count || 0,
    stats: {
      total: stats.total || contacts.length,
      active: stats.active || 0,
      optOut: stats.opt_out || 0,
      suppressed: stats.suppressed || 0
    },
    tags: Array.from(allTags).sort(),
    customFields: (customFieldsResult.data || []) as CustomFieldDefinition[]
  }
}
