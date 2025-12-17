'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  RefreshCw,
  ArrowLeft,
  Copy,
  Clock,
  LifeBuoy,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  ExternalLink,
  Wand2,
} from 'lucide-react'

import { Page, PageActions, PageDescription, PageHeader, PageTitle } from '@/components/ui/page'
import { PrefetchLink } from '@/components/ui/PrefetchLink'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import type {
  MetaDiagnosticsAction,
  MetaDiagnosticsCheck,
  MetaDiagnosticsCheckStatus,
  MetaDiagnosticsResponse,
} from '@/services/metaDiagnosticsService'

const META_BUSINESS_LOCKED_CODE = 131031

type MetaLockSignal =
  | { kind: 'none' }
  | { kind: 'historical'; evidence: { source: string; count?: number } }
  | { kind: 'current'; evidence: { source: string; count?: number } }

function hasMetaBusinessLockedEvidence(checks: MetaDiagnosticsCheck[]): MetaLockSignal {
  // Regra: só tratamos como BLOQUEIO ATUAL se o Health Status estiver BLOCKED.
  // Caso contrário, 131031 vira apenas um sinal histórico (ex.: ocorreu 1x em falhas recentes).

  const health = checks.find((c) => c.id === 'meta_health_status')
  const healthOverall = String((health?.details as any)?.overall || '')
  const healthErrors = Array.isArray((health?.details as any)?.errors) ? ((health?.details as any)?.errors as any[]) : []
  const healthHas131031 = healthErrors.some((e) => Number(e?.error_code) === META_BUSINESS_LOCKED_CODE)
  const isBlockedNow = health?.status === 'fail' || healthOverall === 'BLOCKED'

  if (isBlockedNow) {
    return {
      kind: 'current',
      evidence: {
        source: health?.title || 'Health Status',
        ...(healthHas131031 ? { count: 1 } : null),
      },
    }
  }

  // Sinal histórico: falhas recentes (detalhe.top[]) inclui o código
  for (const c of checks) {
    if (c.id !== 'internal_recent_failures') continue
    const top = (c.details as any)?.top
    if (Array.isArray(top)) {
      const found = top.find((x: any) => Number(x?.code) === META_BUSINESS_LOCKED_CODE)
      if (found) {
        return {
          kind: 'historical',
          evidence: {
            source: c.title || c.id,
            count: typeof found?.count === 'number' ? found.count : undefined,
          },
        }
      }
    }
  }

  return { kind: 'none' }
}

function StatusBadge({ status }: { status: MetaDiagnosticsCheckStatus }) {
  const base = 'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-medium'
  if (status === 'pass') return <span className={`${base} bg-emerald-500/10 border-emerald-500/20 text-emerald-200`}><CheckCircle2 size={14} /> OK</span>
  if (status === 'warn') return <span className={`${base} bg-amber-500/10 border-amber-500/20 text-amber-200`}><AlertTriangle size={14} /> Atenção</span>
  if (status === 'fail') return <span className={`${base} bg-red-500/10 border-red-500/20 text-red-200`}><XCircle size={14} /> Falha</span>
  return <span className={`${base} bg-white/5 border-white/10 text-gray-200`}><Info size={14} /> Info</span>
}

function HealthStatusSeal({ checks }: { checks: MetaDiagnosticsCheck[] }) {
  const health = checks.find((c) => c.id === 'meta_health_status')
  const overall = String((health?.details as any)?.overall || '')

  const status: MetaDiagnosticsCheckStatus =
    overall === 'BLOCKED' ? 'fail' : overall === 'LIMITED' ? 'warn' : overall === 'AVAILABLE' ? 'pass' : 'info'

  const subtitle =
    overall === 'BLOCKED'
      ? 'Bloqueio confirmado pela Meta (Health Status). Não há “auto-fix” aqui: precisa resolver no Business Manager/Meta.'
      : overall === 'LIMITED'
        ? 'Envio limitado pela Meta. Pode afetar volume/entregabilidade até resolver a causa.'
        : overall === 'AVAILABLE'
          ? 'Envio liberado segundo a Meta (prova oficial).'
          : 'Health Status não disponível (ou não foi possível consultar).'

  return (
    <div className="glass-panel rounded-2xl p-6">
      <div className="text-xs text-gray-500">Semáforo</div>
      <div className="mt-2 flex items-center gap-2">
        <StatusBadge status={status} />
        <div className="text-sm text-white font-medium">Health Status: {overall || '—'}</div>
      </div>
      <div className="mt-2 text-sm text-gray-300">{subtitle}</div>
      <div className="mt-2 text-xs text-gray-500">
        Fonte: Graph API · field <span className="font-mono">health_status</span>
      </div>
    </div>
  )
}

function TokenExpirySeal({ data, checks }: { data?: MetaDiagnosticsResponse; checks: MetaDiagnosticsCheck[] }) {
  const enabled = Boolean(data?.debugTokenValidation?.enabled)
  const token = data?.summary?.token || null

  // fallback (se summary/token não vier por algum motivo): tenta ler do check meta_debug_token
  const fallbackExpiresAt = (() => {
    const c = checks.find((x) => x.id === 'meta_debug_token')
    const v = (c?.details as any)?.expiresAt
    if (typeof v === 'number') return v
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  })()

  const expiresIso = token?.expiresAtIso || (fallbackExpiresAt ? new Date(fallbackExpiresAt * 1000).toISOString() : null)
  const status = token?.status || (enabled ? 'unknown' : 'unknown')

  const badgeStatus: MetaDiagnosticsCheckStatus =
    !enabled ? 'info' : status === 'expired' ? 'fail' : status === 'expiring' ? 'warn' : status === 'ok' ? 'pass' : 'info'

  const subtitle = !enabled
    ? 'Para ver expiração do token com prova, habilite debug_token (Meta App ID/Secret).'
    : expiresIso
      ? `Expira em: ${new Date(expiresIso).toLocaleString('pt-BR')}`
      : 'Expiração não disponível (tipo de token/Meta não retornou expires_at).'

  const extra = enabled && token?.daysRemaining != null
    ? `Dias restantes: ${token.daysRemaining}`
    : null

  return (
    <div className="glass-panel rounded-2xl p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs text-gray-500">Token</div>
          <div className="mt-2 flex items-center gap-2">
            <StatusBadge status={badgeStatus} />
            <div className="text-sm text-white font-medium">Expiração</div>
          </div>
          <div className="mt-2 text-sm text-gray-300">{subtitle}</div>
          {extra && <div className="mt-2 text-xs text-gray-500">{extra}</div>}
        </div>
        <div className="shrink-0 text-gray-300">
          <Clock size={18} />
        </div>
      </div>
    </div>
  )
}

function DebugTokenSeal({ data }: { data?: MetaDiagnosticsResponse }) {
  const metaApp = data?.metaApp || null
  const dbg = data?.debugTokenValidation || null

  const enabled = Boolean(dbg?.enabled || metaApp?.enabled)
  const source = (dbg?.source || metaApp?.source || 'none') as 'db' | 'env' | 'none'

  const status: MetaDiagnosticsCheckStatus = !enabled
    ? 'info'
    : (dbg?.attempted && dbg?.ok === true && dbg?.isValid === true)
      ? 'pass'
      : (dbg?.attempted && (dbg?.ok === false || dbg?.isValid === false))
        ? 'warn'
        : 'info'

  const sourceLabel = source === 'db' ? 'Banco (Supabase)' : source === 'env' ? 'Env vars' : '—'
  const title = enabled ? 'debug_token habilitado' : 'debug_token desabilitado'
  const subtitle = !enabled
    ? 'Configure o Meta App ID/Secret para validar token/escopos com prova (menos achismo, menos suporte).'
    : dbg?.attempted
      ? (dbg?.ok === true && dbg?.isValid === true ? 'Última validação: OK' : 'Última validação: falhou')
      : 'Aguardando primeira validação'

  return (
    <div className="glass-panel rounded-2xl p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs text-gray-500">Selo</div>
          <div className="mt-2 flex items-center gap-2">
            <StatusBadge status={status} />
            <div className="text-sm text-white font-medium truncate">{title}</div>
          </div>
          <div className="mt-2 text-sm text-gray-300">{subtitle}</div>
          <div className="mt-2 text-xs text-gray-500">Fonte: {sourceLabel}</div>
        </div>

        <div className="text-right">
          <div className="text-xs text-gray-500">App ID</div>
          <div className="mt-2 text-sm text-white font-mono">{metaApp?.appId || '—'}</div>
          <div className="mt-2">
            <Link
              href="/settings"
              className="text-xs text-gray-300 underline hover:text-white transition-colors"
            >
              Configurar
            </Link>
          </div>
        </div>
      </div>

      {enabled && dbg?.attempted && dbg?.ok === false && dbg?.error != null ? (
        <div className="mt-4 text-xs text-gray-400">
          Detalhe: {typeof dbg.error === 'string' ? dbg.error : 'Falha ao validar via /debug_token'}
        </div>
      ) : null}
    </div>
  )
}

function formatJsonMaybe(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function NextSteps({ value }: { value: unknown }) {
  const steps = Array.isArray(value) ? (value as unknown[]) : null
  if (!steps || steps.length === 0) return null

  return (
    <div className="mt-3">
      <div className="text-xs text-gray-400">Passo a passo sugerido</div>
      <ul className="mt-2 list-disc pl-5 space-y-1 text-sm text-gray-200">
        {steps.map((s, idx) => (
          <li key={idx}>{typeof s === 'string' ? s : formatJsonMaybe(s)}</li>
        ))}
      </ul>
    </div>
  )
}

function ActionButtons(props: {
  actions: MetaDiagnosticsAction[]
  onRunAction: (a: MetaDiagnosticsAction) => void
  disabled?: boolean
  disabledReason?: string
}) {
  const { actions } = props
  if (!actions?.length) return null

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {actions.map((a) => {
        if (a.kind === 'link' && a.href) {
          return (
            <Link
              key={a.id}
              href={a.href}
              className="px-3 py-2 rounded-lg bg-white/5 text-white hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all text-sm font-medium inline-flex items-center gap-2"
            >
              <ExternalLink size={14} />
              {a.label}
            </Link>
          )
        }

        if (a.kind === 'api') {
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => props.onRunAction(a)}
              disabled={props.disabled}
              className="px-3 py-2 rounded-lg bg-primary-500 hover:bg-primary-400 text-black font-medium transition-colors text-sm inline-flex items-center gap-2 disabled:opacity-50"
              title={
                props.disabled
                  ? props.disabledReason || 'Ação temporariamente indisponível'
                  : a.endpoint
                    ? `${a.method || 'POST'} ${a.endpoint}`
                    : undefined
              }
            >
              <Wand2 size={14} />
              {a.label}
            </button>
          )
        }

        return null
      })}
    </div>
  )
}

export function MetaDiagnosticsView(props: {
  data?: MetaDiagnosticsResponse
  checks: MetaDiagnosticsCheck[]
  filteredChecks: MetaDiagnosticsCheck[]
  counts: { pass: number; warn: number; fail: number; info: number }
  overall: MetaDiagnosticsCheckStatus
  isLoading: boolean
  isFetching: boolean
  filter: 'all' | 'actionable' | 'problems'
  setFilter: (v: 'all' | 'actionable' | 'problems') => void
  onRefresh: () => void
  onRunAction: (a: MetaDiagnosticsAction) => void
  isActing: boolean
}) {
  const reportText = props.data?.report?.text || ''
  const supportPacketText = props.data?.report?.supportPacketText || reportText
  const { isCopied, copyToClipboard } = useCopyToClipboard({ timeout: 1800 })
  const lock = React.useMemo(() => hasMetaBusinessLockedEvidence(props.checks), [props.checks])
  const apiActionsDisabled = props.isActing || lock.kind === 'current'

  const hasGraph100_33 = React.useMemo(() => {
    const checks = props.checks || []
    for (const c of checks) {
      const err = (c as any)?.details?.error
      const code = Number(err?.code ?? err?.error?.code)
      const sub = Number(err?.error_subcode ?? err?.error?.error_subcode)
      if (code === 100 && sub === 33) return true
    }
    return false
  }, [props.checks])

  const hasGraph190 = React.useMemo(() => {
    const checks = props.checks || []
    for (const c of checks) {
      const err = (c as any)?.details?.error
      const code = Number(err?.code ?? err?.error?.code)
      if (code === 190) return true
    }
    return false
  }, [props.checks])

  const hasSignal131042 = React.useMemo(() => {
    // pode aparecer em falhas recentes (internal_recent_failures.top[]) ou em detalhes de health_status
    for (const c of props.checks || []) {
      if (c.id === 'internal_recent_failures') {
        const top = (c.details as any)?.top
        if (Array.isArray(top) && top.some((x: any) => Number(x?.code) === 131042)) return true
      }
      if (c.id === 'meta_health_status') {
        const errors = Array.isArray((c.details as any)?.errors) ? ((c.details as any).errors as any[]) : []
        if (errors.some((e) => Number(e?.error_code) === 131042)) return true
      }
    }
    return false
  }, [props.checks])

  const hasSignal131056 = React.useMemo(() => {
    for (const c of props.checks || []) {
      if (c.id === 'internal_recent_failures') {
        const top = (c.details as any)?.top
        if (Array.isArray(top) && top.some((x: any) => Number(x?.code) === 131056)) return true
      }
      const err = (c as any)?.details?.error
      const code = Number(err?.code ?? err?.error?.code)
      if (code === 131056) return true
    }
    return false
  }, [props.checks])

  return (
    <Page>
      <PageHeader>
        <div>
          <PageTitle>Diagnóstico Meta</PageTitle>
          <PageDescription>
            Central de verificação (Graph API + infraestrutura) com ações rápidas. Ideal pra descobrir por que “não envia” ou “não recebe delivered/read”.
          </PageDescription>
        </div>

        <PageActions>
          <PrefetchLink
            href="/settings"
            className="px-4 py-2 rounded-xl bg-white/5 text-white hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all text-sm font-medium flex items-center gap-2"
          >
            <ArrowLeft size={16} />
            Voltar
          </PrefetchLink>

          <button
            onClick={() => copyToClipboard(reportText)}
            disabled={!reportText}
            className="px-4 py-2 rounded-xl bg-white/5 text-white hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all text-sm font-medium flex items-center gap-2 disabled:opacity-50"
            title={reportText ? 'Copiar relatório resumido (redigido)' : 'Relatório indisponível'}
          >
            <Copy size={16} />
            {isCopied ? 'Copiado!' : 'Copiar relatório'}
          </button>

          <button
            onClick={props.onRefresh}
            className="px-4 py-2 rounded-xl bg-white/5 text-white hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all text-sm font-medium flex items-center gap-2"
            title="Atualizar"
          >
            <RefreshCw size={16} className={props.isFetching ? 'animate-spin' : ''} />
            {props.isFetching ? 'Atualizando…' : 'Atualizar'}
          </button>
        </PageActions>
      </PageHeader>

      {/* Selos / atalhos para reduzir suporte */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6">
        <HealthStatusSeal checks={props.checks} />
        <TokenExpirySeal data={props.data} checks={props.checks} />
        <DebugTokenSeal data={props.data} />

        <div className="glass-panel rounded-2xl p-6">
          <div className="text-xs text-gray-500">Atalho</div>
          <div className="mt-2 text-sm text-white font-medium">Support Packet</div>
          <div className="mt-2 text-sm text-gray-300">
            1 clique pra copiar um pacote pronto (inclui <span className="font-mono">fbtrace_id</span> quando existir).
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => copyToClipboard(supportPacketText)}
              disabled={!supportPacketText}
              className="px-3 py-2 rounded-lg bg-white/5 text-white hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50"
              title={supportPacketText ? 'Copiar packet completo' : 'Indisponível'}
            >
              <LifeBuoy size={14} /> {isCopied ? 'Copiado!' : 'Copiar packet'}
            </button>
            <button
              onClick={() => copyToClipboard(reportText)}
              disabled={!reportText}
              className="px-3 py-2 rounded-lg bg-white/5 text-white hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50"
              title={reportText ? 'Copiar resumo' : 'Indisponível'}
            >
              <Copy size={14} /> Resumo
            </button>
          </div>
        </div>
      </div>

      {hasGraph100_33 && (
        <div className="glass-panel rounded-2xl p-6 border border-amber-500/20 bg-amber-500/5 mb-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 text-amber-300" size={18} />
            <div className="min-w-0">
              <div className="text-white font-semibold">Como interpretar: erro 100 (subcode 33)</div>
              <div className="text-sm text-gray-200/90 mt-1">
                Esse erro quase sempre significa: <b>ID incorreto</b> OU <b>token sem acesso ao ativo</b> (WABA/PHONE_NUMBER).
                Normalmente é permissão/atribuição — não é “bloqueio de conta”.
              </div>
              <ul className="mt-3 list-disc pl-5 space-y-1 text-sm text-gray-200">
                <li>Confirme se o <b>phone_number_id</b> e o <b>waba_id</b> foram copiados do WhatsApp Manager correto.</li>
                <li>Gere um token do <b>System User</b> e atribua os ativos (WABA + Phone Number) no Business Manager.</li>
                <li>Garanta os escopos <span className="font-mono">whatsapp_business_messaging</span> e <span className="font-mono">whatsapp_business_management</span>.</li>
                <li>Volte aqui e clique em <b>Atualizar</b>.</li>
              </ul>
              <div className="mt-3 text-xs text-gray-400">
                Dica: configurando <b>Meta App ID/Secret</b> em Configurações, o diagnóstico consegue validar escopos e origem do token via <span className="font-mono">/debug_token</span>.
              </div>
            </div>
          </div>
        </div>
      )}

      {hasGraph190 && (
        <div className="glass-panel rounded-2xl p-6 border border-red-500/20 bg-red-500/5 mb-6">
          <div className="flex items-start gap-3">
            <XCircle className="mt-0.5 text-red-300" size={18} />
            <div className="min-w-0">
              <div className="text-white font-semibold">Como interpretar: erro 190 (token inválido)</div>
              <div className="text-sm text-gray-200/90 mt-1">
                Esse erro indica token expirado/invalidado, token copiado errado ou token sem permissão (às vezes aparece como “Session has expired”).
              </div>
              <ul className="mt-3 list-disc pl-5 space-y-1 text-sm text-gray-200">
                <li>Gere um novo token (recomendado: <b>System User</b> no Business Manager).</li>
                <li>Atribua os ativos (WABA + Phone Number) ao System User antes de gerar o token.</li>
                <li>Garanta os escopos <span className="font-mono">whatsapp_business_messaging</span> e <span className="font-mono">whatsapp_business_management</span>.</li>
                <li>Atualize o token em <b>Ajustes</b> e rode o diagnóstico novamente.</li>
              </ul>
              <div className="mt-3 text-xs text-gray-400">
                Dica: com <span className="font-mono">debug_token</span> habilitado, você vê expiração/escopos com prova.
              </div>
            </div>
          </div>
        </div>
      )}

      {hasSignal131042 && (
        <div className="glass-panel rounded-2xl p-6 border border-amber-500/20 bg-amber-500/5 mb-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 text-amber-300" size={18} />
            <div className="min-w-0">
              <div className="text-white font-semibold">Como interpretar: erro 131042 (pagamento/conta)</div>
              <div className="text-sm text-gray-200/90 mt-1">
                Esse código costuma aparecer quando há problema de pagamento ou restrição de conta no Business Manager. É Meta-side.
              </div>
              <ul className="mt-3 list-disc pl-5 space-y-1 text-sm text-gray-200">
                <li>Abra o <b>Business Manager</b> e verifique alertas de cobrança/pagamento.</li>
                <li>Confirme se o WABA está verificado e sem pendências de revisão.</li>
                <li>Após corrigir, rode o diagnóstico e faça um envio de teste.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {hasSignal131056 && (
        <div className="glass-panel rounded-2xl p-6 border border-amber-500/20 bg-amber-500/5 mb-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 text-amber-300" size={18} />
            <div className="min-w-0">
              <div className="text-white font-semibold">Como interpretar: erro 131056 (rate limit por par)</div>
              <div className="text-sm text-gray-200/90 mt-1">
                A Meta limita envio para o mesmo usuário (pair rate limit). Isso não é “bloqueio”, é limite temporário.
              </div>
              <ul className="mt-3 list-disc pl-5 space-y-1 text-sm text-gray-200">
                <li>Evite mandar múltiplas mensagens em sequência para o mesmo número em poucos segundos.</li>
                <li>Se for fluxo/campanha, aplique delay/backoff e re-tente com espaçamento.</li>
                <li>Rode novamente depois de alguns minutos.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="glass-panel rounded-2xl p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs text-gray-500">Status geral</div>
              <div className="mt-2 flex items-center gap-2">
                <StatusBadge status={props.overall} />
                <span className="text-xs text-gray-400">({props.checks.length} checks)</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-500">Falhas / Atenções</div>
              <div className="mt-2 text-sm text-white font-medium">
                <span className="text-red-200">{props.counts.fail}</span>
                <span className="text-gray-500"> / </span>
                <span className="text-amber-200">{props.counts.warn}</span>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-4 gap-2 text-xs">
            <div className="bg-zinc-900/40 border border-white/10 rounded-lg p-2">
              <div className="text-gray-500">OK</div>
              <div className="mt-1 text-white font-medium">{props.counts.pass}</div>
            </div>
            <div className="bg-zinc-900/40 border border-white/10 rounded-lg p-2">
              <div className="text-gray-500">Info</div>
              <div className="mt-1 text-white font-medium">{props.counts.info}</div>
            </div>
            <div className="bg-zinc-900/40 border border-amber-500/20 rounded-lg p-2">
              <div className="text-amber-200">Atenção</div>
              <div className="mt-1 text-white font-medium">{props.counts.warn}</div>
            </div>
            <div className="bg-zinc-900/40 border border-red-500/20 rounded-lg p-2">
              <div className="text-red-200">Falha</div>
              <div className="mt-1 text-white font-medium">{props.counts.fail}</div>
            </div>
          </div>
        </div>

        <div className="glass-panel rounded-2xl p-6">
          <div className="text-xs text-gray-500">Ambiente</div>
          <div className="mt-2 text-sm text-white">
            {(props.data?.env as any)?.vercelEnv || '—'}
          </div>
          <div className="mt-3 text-xs text-gray-400 space-y-1">
            <div>
              <span className="text-gray-500">Deploy:</span>{' '}
              <span className="font-mono text-white/90">{((props.data?.env as any)?.deploymentId as string) || '—'}</span>
            </div>
            <div>
              <span className="text-gray-500">Commit:</span>{' '}
              <span className="font-mono text-white/90">{((props.data?.env as any)?.gitCommitSha as string)?.slice?.(0, 7) || '—'}</span>
            </div>
          </div>
        </div>

        <div className="glass-panel rounded-2xl p-6">
          <div className="text-xs text-gray-500">Webhook (URL esperada)</div>
          <div className="mt-2 text-sm text-white font-mono break-all">
            {props.data?.webhook?.expectedUrl || '—'}
          </div>
          <div className="mt-3 text-xs text-gray-400">
            Verify token:{' '}
            <span className="font-mono text-white/90">{props.data?.webhook?.verifyTokenPreview || '—'}</span>
          </div>
        </div>
      </div>

      {lock.kind !== 'none' && (
        <div
          className={`mt-4 glass-panel rounded-2xl p-6 border ${
            lock.kind === 'current'
              ? 'border-red-500/20 bg-red-500/5'
              : 'border-amber-500/20 bg-amber-500/5'
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <StatusBadge status={lock.kind === 'current' ? 'fail' : 'warn'} />
                <h3 className="text-sm font-semibold text-white truncate">
                  {lock.kind === 'current'
                    ? `Bloqueio atual detectado (código ${META_BUSINESS_LOCKED_CODE})`
                    : `Sinal histórico de bloqueio (código ${META_BUSINESS_LOCKED_CODE})`}
                </h3>
              </div>
              <div className="mt-2 text-sm text-gray-200">
                {lock.kind === 'current'
                  ? 'O Health Status da Meta indica BLOQUEIO na cadeia de envio (APP/BUSINESS/WABA/PHONE/TEMPLATE). Enquanto isso estiver ativo, ações e envios podem falhar — não há “auto-fix” via API aqui dentro.'
                  : 'Detectamos o código 131031 em falhas recentes (últimos 7 dias), mas o Health Status atual não está bloqueado. Isso pode ter sido temporário ou relacionado a uma tentativa antiga.'}
              </div>
              <div className="mt-3 text-sm text-gray-300 space-y-1">
                <div>
                  <span className="text-gray-400">O que fazer:</span>
                </div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Abra o Business Manager e verifique alertas de pagamento, verificação e qualidade da conta.</li>
                  {lock.kind === 'current' ? (
                    <>
                      <li>Se não houver caminho de auto-resolução, abra um chamado no suporte da Meta para desbloqueio do WABA.</li>
                      <li>Depois do desbloqueio, volte aqui e clique em “Atualizar” e então “Ativar messages”.</li>
                    </>
                  ) : (
                    <>
                      <li>Se o problema voltar a acontecer, use o “Copiar relatório” e envie junto do <span className="font-mono">fbtrace_id</span> (quando houver) ao suporte da Meta.</li>
                      <li>Se o objetivo agora é receber delivered/read, foque em ativar <span className="font-mono">messages</span> em <span className="font-mono">subscribed_apps</span> (botão “Ativar messages”).</li>
                    </>
                  )}
                </ul>
              </div>
              <div className="mt-3 text-xs text-gray-400">
                Evidência: {lock.evidence?.source || 'diagnóstico'}
                {typeof lock.evidence?.count === 'number' ? ` (ocorrências: ${lock.evidence.count})` : ''}
              </div>
            </div>

            <div className="shrink-0">
              <button
                onClick={() => copyToClipboard(reportText)}
                disabled={!reportText}
                className="px-3 py-2 rounded-lg bg-white/5 text-white hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50"
                title={reportText ? 'Copiar relatório para suporte' : 'Relatório indisponível'}
              >
                <Copy size={14} />
                Copiar relatório
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="text-xs text-gray-400">Filtro:</div>
        {([
          { k: 'problems', label: 'Problemas' },
          { k: 'actionable', label: 'Com ações' },
          { k: 'all', label: 'Tudo' },
        ] as const).map((b) => (
          <button
            key={b.k}
            type="button"
            onClick={() => props.setFilter(b.k)}
            className={`px-3 py-1.5 rounded-lg border text-xs transition-colors ${
              props.filter === b.k
                ? 'bg-white/10 text-white border-white/20'
                : 'bg-zinc-900/40 text-gray-300 border-white/10 hover:bg-white/5'
            }`}
          >
            {b.label}
          </button>
        ))}

        <div className="ml-auto text-xs text-gray-500">
          {props.isLoading ? 'Carregando…' : `${props.filteredChecks.length} itens`}
        </div>
      </div>

      {/* Checks */}
      <div className="space-y-3">
        {props.isLoading && (
          <div className="glass-panel rounded-2xl p-6 text-sm text-gray-400">
            Carregando diagnóstico…
          </div>
        )}

        {!props.isLoading && props.filteredChecks.length === 0 && (
          <div className="glass-panel rounded-2xl p-6 text-sm text-gray-400">
            Nenhum item nesse filtro.
          </div>
        )}

        {props.filteredChecks.map((c) => (
          <div key={c.id} className="glass-panel rounded-2xl p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <StatusBadge status={c.status} />
                  <h3 className="text-sm font-semibold text-white truncate">{c.title}</h3>
                </div>
                <div className="mt-2 text-sm text-gray-300">{c.message}</div>

                <NextSteps value={(c.details as any)?.nextSteps} />

                <ActionButtons
                  actions={c.actions || []}
                  onRunAction={props.onRunAction}
                  disabled={apiActionsDisabled}
                  disabledReason={
                    lock.kind === 'current'
                      ? `Bloqueado pela Meta (código ${META_BUSINESS_LOCKED_CODE}). Resolva no Business Manager e tente novamente.`
                      : 'Executando ação…'
                  }
                />

                {c.details && (
                  <details className="mt-4">
                    <summary className="cursor-pointer text-xs text-gray-400 hover:text-white transition-colors">
                      Ver detalhes técnicos
                    </summary>
                    <pre className="mt-3 text-xs bg-zinc-950/50 border border-white/10 rounded-xl p-4 overflow-auto text-gray-200">
                      {formatJsonMaybe(c.details)}
                    </pre>
                  </details>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Raw report (optional) */}
      {reportText && (
        <div className="glass-panel rounded-2xl p-6">
          <div className="text-xs text-gray-500">Relatório (resumo)</div>
          <pre className="mt-3 text-xs bg-zinc-950/50 border border-white/10 rounded-xl p-4 overflow-auto text-gray-200 whitespace-pre-wrap">
            {reportText}
          </pre>
        </div>
      )}
    </Page>
  )
}
