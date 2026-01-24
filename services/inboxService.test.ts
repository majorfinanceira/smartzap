import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { inboxService } from './inboxService'

// Mock global fetch
const mockFetch: ReturnType<typeof vi.fn> = vi.fn()
const originalFetch = globalThis.fetch

const createMockResponse = (data: unknown, options?: { ok?: boolean; status?: number }) => ({
  ok: options?.ok ?? true,
  status: options?.status ?? 200,
  json: vi.fn().mockResolvedValue(data),
})

describe('inboxService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as any).fetch = mockFetch
  })

  afterEach(() => {
    vi.resetAllMocks()
    ;(globalThis as any).fetch = originalFetch
  })

  it('listConversations deve montar query params', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({ conversations: [], total: 0, page: 1, totalPages: 0 }))

    await inboxService.listConversations({ page: 2, limit: 10, status: 'open', search: 'ana' } as any)

    expect(mockFetch).toHaveBeenCalledWith('/api/inbox/conversations?page=2&limit=10&status=open&search=ana')
  })

  it('getConversation deve lançar erro com status', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({ error: 'Not found' }, { ok: false, status: 404 }))

    await expect(inboxService.getConversation('c1')).rejects.toThrow('404: Not found')
  })

  it('sendMessage deve lançar erro quando falha', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({ error: 'Falhou' }, { ok: false }))

    await expect(inboxService.sendMessage('c1', { content: 'oi' })).rejects.toThrow('Falhou')
  })

  it('createLabel deve enviar payload', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({ id: 'l1', name: 'VIP' }))

    await inboxService.createLabel({ name: 'VIP', color: '#fff' })

    const [, init] = mockFetch.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.name).toBe('VIP')
  })

  it('updateQuickReply deve usar PATCH', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({ id: 'q1', title: 't', content: 'c' }))

    await inboxService.updateQuickReply('q1', { title: 'novo' })

    expect(mockFetch).toHaveBeenCalledWith('/api/inbox/quick-replies/q1', expect.objectContaining({ method: 'PATCH' }))
  })

  it('handoffToHuman deve lançar erro', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({ error: 'Falhou' }, { ok: false }))

    await expect(inboxService.handoffToHuman('c1')).rejects.toThrow('Falhou')
  })

  it('pauseAutomation deve enviar duration', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({
      success: true,
      conversation: { id: 'c1' },
      paused_until: 'x',
      duration_minutes: 10,
    }))

    await inboxService.pauseAutomation('c1', 10, 'motivo')

    const [, init] = mockFetch.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.duration_minutes).toBe(10)
  })
})
