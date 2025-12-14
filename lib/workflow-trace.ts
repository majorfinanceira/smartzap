import { redis } from '@/lib/redis'

export type WorkflowTraceEvent = {
  tag: 'workflow_trace'
  ts: string
  traceId: string
  campaignId?: string
  step?: string
  batchIndex?: number
  contactId?: string
  phoneMasked?: string
  phase: string
  ms?: number
  ok?: boolean
  extra?: Record<string, unknown>
}

const TRACE_REDIS_TTL_SECONDS = 60 * 60 * 24 * 2 // 2 dias
const TRACE_REDIS_MAX_EVENTS = 4000

export function maskPhone(phone: string | null | undefined): string {
  const p = String(phone || '').trim()
  if (!p) return ''
  const last4 = p.replace(/\D/g, '').slice(-4)
  return last4 ? `***${last4}` : '***'
}

export async function emitWorkflowTrace(event: Omit<WorkflowTraceEvent, 'tag' | 'ts'>) {
  const payload: WorkflowTraceEvent = {
    tag: 'workflow_trace',
    ts: new Date().toISOString(),
    ...event,
  }

  // 1) Logs estruturados (aparece no Vercel Logs e é fácil de filtrar por traceId)
  // Não use console.debug: muitas vezes é filtrado dependendo da configuração.
  console.log(JSON.stringify(payload))

  // 2) Best-effort: guarda no Redis para inspeção sem depender de exportar logs
  // Habilite com WORKFLOW_TRACE_STORE=1
  if (!redis || process.env.WORKFLOW_TRACE_STORE !== '1') return

  try {
    const key = `trace:${payload.traceId}`
    await redis.lpush(key, payload)
    await redis.ltrim(key, 0, TRACE_REDIS_MAX_EVENTS - 1)
    await redis.expire(key, TRACE_REDIS_TTL_SECONDS)
  } catch (e) {
    // Não pode quebrar envio por causa de tracing
    console.warn('[workflow_trace] Falha ao gravar no Redis (best-effort):', e)
  }
}

export async function timePhase<T>(
  phase: string,
  meta: Omit<WorkflowTraceEvent, 'tag' | 'ts' | 'phase' | 'ms'>,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now()
  try {
    const result = await fn()
    await emitWorkflowTrace({
      ...meta,
      phase,
      ms: Date.now() - start,
      ok: true,
    })
    return result
  } catch (err) {
    await emitWorkflowTrace({
      ...meta,
      phase,
      ms: Date.now() - start,
      ok: false,
      extra: {
        error: err instanceof Error ? err.message : String(err),
      },
    })
    throw err
  }
}
