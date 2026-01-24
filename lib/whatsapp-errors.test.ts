import { describe, it, expect } from 'vitest'

import {
  mapWhatsAppError,
  isPaymentError,
  isRateLimitError,
  isRetryableError,
  getErrorCategory,
  getUserFriendlyMessage,
  getRecommendedAction,
  getUserFriendlyMessageForMetaError,
  getRecommendedActionForMetaError,
  normalizeMetaErrorTextForStorage,
} from './whatsapp-errors'

describe('whatsapp-errors', () => {
  it('deve mapear erro conhecido corretamente', () => {
    const error = mapWhatsAppError(131042)
    expect(error.category).toBe('payment')
    expect(error.retryable).toBe(false)
  })

  it('deve mapear erro desconhecido como unknown', () => {
    const error = mapWhatsAppError(999999)
    expect(error.category).toBe('unknown')
    expect(error.userMessage).toContain('999999')
  })

  it('deve identificar erros de pagamento e rate limit', () => {
    expect(isPaymentError(131042)).toBe(true)
    expect(isRateLimitError(130429)).toBe(true)
  })

  it('deve identificar erros retryable', () => {
    expect(isRetryableError(131000)).toBe(true)
    expect(isRetryableError(131042)).toBe(false)
  })

  it('deve retornar categoria, mensagem e ação', () => {
    expect(getErrorCategory(131056)).toBe('rate_limit')
    expect(getUserFriendlyMessage(131056)).toContain('Muitas mensagens')
    expect(getRecommendedAction(131056)).toContain('Aguarde')
  })

  it('deve normalizar e truncar texto da Meta', () => {
    const raw = '   Texto   com   muitos   espaços   '
    const normalized = normalizeMetaErrorTextForStorage(raw, 10)
    expect(normalized).toBe('Texto com…')
  })

  it('deve preferir detalhes da Meta na mensagem amigável', () => {
    const message = getUserFriendlyMessageForMetaError({
      code: 131052,
      details: 'Falha ao baixar mídia do weblink. HTTP code 403',
    })

    expect(message).toContain('403')
  })

  it('deve incluir detalhes em ação quando rate limit', () => {
    const action = getRecommendedActionForMetaError({
      code: 130429,
      details: 'Too many requests for this WABA',
    })

    expect(action).toContain('Meta:')
  })
})
