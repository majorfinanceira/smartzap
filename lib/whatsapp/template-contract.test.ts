import { describe, expect, it } from 'vitest'
import { precheckContactForTemplate } from '@/lib/whatsapp/template-contract'

const baseTemplate = {
  id: 'tpl_1',
  name: 'test_template',
  category: 'MARKETING',
  language: 'pt_BR',
  status: 'APPROVED',
  content: '',
  preview: '',
  lastUpdated: new Date().toISOString(),
  parameterFormat: 'positional' as const,
  components: [
    { type: 'BODY', text: 'Olá {{1}}' },
  ],
}

describe('template-contract precheckContactForTemplate', () => {
  it('deve marcar como skipped quando token resolve para vazio (ex: {{email}} sem email)', () => {
    const res = precheckContactForTemplate(
      {
        contactId: 'c_1',
        name: 'João',
        phone: '+5511999999999',
        email: null,
        custom_fields: {},
      },
      baseTemplate as any,
      {
        header: [],
        body: ['{{email}}'],
      }
    )

    expect(res.ok).toBe(false)
    if (res.ok) return

    expect(res.skipCode).toBe('MISSING_REQUIRED_PARAM')
    // Observabilidade: deve indicar exatamente a posição + token cru.
    expect(res.reason).toContain('body:1')
    expect(res.reason).toContain('raw="{{email}}"')
  })

  it('deve passar quando token resolve com valor (ex: {{email}} presente)', () => {
    const res = precheckContactForTemplate(
      {
        contactId: 'c_1',
        name: 'João',
        phone: '+5511999999999',
        email: 'joao@exemplo.com',
        custom_fields: {},
      },
      baseTemplate as any,
      {
        header: [],
        body: ['{{email}}'],
      }
    )

    expect(res.ok).toBe(true)
    if (!res.ok) return

    expect(res.normalizedPhone).toBe('+5511999999999')
    expect(res.values.body).toEqual([{ key: '1', text: 'joao@exemplo.com' }])
  })
})
