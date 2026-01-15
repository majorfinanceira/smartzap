'use client'

import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ExternalLink, Loader2, Save, UploadCloud, Wand2, LayoutTemplate, PenSquare } from 'lucide-react'
import { toast } from 'sonner'

import { Page, PageActions, PageDescription, PageHeader, PageTitle } from '@/components/ui/page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FlowFormBuilder } from '@/components/features/flows/builder/FlowFormBuilder'
import { TemplateModelPreviewCard } from '@/components/ui/TemplateModelPreviewCard'
import { MetaFlowPreview } from '@/components/ui/MetaFlowPreview'
import { useFlowEditorController } from '@/hooks/useFlowEditor'
import { Textarea } from '@/components/ui/textarea'
import { FLOW_TEMPLATES } from '@/lib/flow-templates'
import { flowJsonToFormSpec, generateFlowJsonFromFormSpec, validateFlowFormSpec } from '@/lib/flow-form'

export default function FlowBuilderEditorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const router = useRouter()
  const { id } = React.use(params)

  const controller = useFlowEditorController(id)

  const flow = controller.flow

  const [name, setName] = React.useState('')
  const [metaFlowId, setMetaFlowId] = React.useState<string>('')
  const [previewMode, setPreviewMode] = React.useState<'smartzap' | 'meta'>('meta')
  const [step, setStep] = React.useState<1 | 2 | 3>(1)
  const [formPreviewJson, setFormPreviewJson] = React.useState<unknown>(null)
  const [formScreenId, setFormScreenId] = React.useState('')
  const [formIssues, setFormIssues] = React.useState<string[]>([])
  const [formDirty, setFormDirty] = React.useState(false)
  const latestFormSpecRef = React.useRef<any>(null)
  const dynamicFlowJsonRef = React.useRef<Record<string, unknown> | null>(null)
  const formActionsRef = React.useRef<{
    openAI: () => void
    openTemplate: () => void
    setScreenId: (value: string) => void
  } | null>(null)
  const [startMode, setStartMode] = React.useState<'ai' | 'template' | null>(null)
  const [aiPrompt, setAiPrompt] = React.useState('')
  const [aiLoading, setAiLoading] = React.useState(false)
  const [selectedTemplateKey, setSelectedTemplateKey] = React.useState<string>(FLOW_TEMPLATES[0]?.key || '')
  const [hoverTemplateKey, setHoverTemplateKey] = React.useState<string | null>(null)
  const hoverPreviewTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const [formPreview, setFormPreview] = React.useState<{
    title: string
    intro?: string
    submitLabel?: string
    questions: Array<{ label: string; required: boolean }>
  } | null>(null)

  const handleFormPreviewChange = React.useCallback(
    ({ form, generatedJson, issues, dirty }: { form: any; generatedJson: unknown; issues: string[]; dirty: boolean }) => {
      latestFormSpecRef.current = form
      const dynamicJson = dynamicFlowJsonRef.current || null
      setFormPreviewJson(dynamicJson ?? generatedJson)
      setFormScreenId(String(form?.screenId || ''))
      setFormIssues(Array.isArray(issues) ? issues : [])
      setFormDirty(!!dirty)
      setFormPreview({
        title: form?.title || '',
        intro: form?.intro || '',
        submitLabel: form?.submitLabel || '',
        questions: Array.isArray(form?.fields)
          ? form.fields.map((f: any) => ({
              label: String(f?.label || 'Pergunta'),
              required: !!f?.required,
            }))
          : [],
      })
    },
    [],
  )

  const previewBody = React.useMemo(() => {
    const title = (formPreview?.title || name || 'Formulário').trim()
    const intro = (formPreview?.intro || '').trim()
    const questions = formPreview?.questions || []

    if (!questions.length && !intro) return ''

    const lines: string[] = []
    if (title) lines.push(title)
    if (intro) lines.push(intro)
    if (questions.length) {
      lines.push('')
      lines.push('Perguntas:')
      for (const [idx, q] of questions.slice(0, 8).entries()) {
        lines.push(`${idx + 1}. ${q.label}${q.required ? ' *' : ''}`)
      }
      if (questions.length > 8) lines.push(`…e mais ${questions.length - 8} perguntas`)
    }
    return lines.join('\n')
  }, [formPreview, name])

  const previewButtonLabel = (formPreview?.submitLabel || '').trim() || 'Abrir formulário'
  const hasPreviewQuestions = (formPreview?.questions?.length || 0) > 0
  const hasIntro = Boolean((formPreview?.intro || '').trim())

  const applyFormSpec = React.useCallback((form: any) => {
    latestFormSpecRef.current = form
    const issues = validateFlowFormSpec(form)
    const flowJson = generateFlowJsonFromFormSpec(form)
    setFormPreviewJson(flowJson)
    setFormScreenId(String(form?.screenId || ''))
    setFormIssues(issues)
    setFormDirty(true)
    setFormPreview({
      title: form?.title || '',
      intro: form?.intro || '',
      submitLabel: form?.submitLabel || '',
      questions: Array.isArray(form?.fields)
        ? form.fields.map((f: any) => ({
            label: String(f?.label || 'Pergunta'),
            required: !!f?.required,
          }))
        : [],
    })
  }, [])

  const handleGenerateWithAI = React.useCallback(async () => {
    if (aiLoading) return
    if (!aiPrompt.trim() || aiPrompt.trim().length < 10) {
      toast.error('Descreva melhor o que você quer (mínimo 10 caracteres)')
      return
    }
    setAiLoading(true)
    try {
      const res = await fetch('/api/ai/generate-flow-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: aiPrompt.trim(),
          titleHint: name,
          maxQuestions: 10,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        const msg = (data?.error && String(data.error)) || 'Falha ao gerar miniapp com IA'
        const details = data?.details ? `: ${String(data.details)}` : ''
        throw new Error(`${msg}${details}`)
      }
      const generatedForm = data?.form
      if (!generatedForm) throw new Error('Resposta inválida da IA (form ausente)')

      applyFormSpec(generatedForm)
      controller.save({
        spec: { ...(controller.spec as any), form: generatedForm },
        flowJson: generateFlowJsonFromFormSpec(generatedForm),
      })
      setStep(2)
      toast.success('MiniApp gerada! Revise e ajuste as perguntas.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao gerar miniapp com IA')
    } finally {
      setAiLoading(false)
    }
  }, [aiLoading, aiPrompt, applyFormSpec, controller, name])

  const handleApplyTemplate = React.useCallback(() => {
    const tpl = FLOW_TEMPLATES.find((t) => t.key === selectedTemplateKey)
    if (!tpl) return
    // Usa tpl.form se disponível (para templates dinâmicos), senão converte do flowJson
    const form = tpl.form
      ? { ...tpl.form, title: name || tpl.form.title }
      : flowJsonToFormSpec(tpl.flowJson, name || 'MiniApp')
    applyFormSpec(form)
    controller.save({
      spec: { ...(controller.spec as any), form },
      // Para templates dinâmicos, usa o flowJson original
      flowJson: tpl.isDynamic ? tpl.flowJson : generateFlowJsonFromFormSpec(form),
    })
    if (tpl.isDynamic) {
      dynamicFlowJsonRef.current = tpl.flowJson
    }
    setStep(2)
    toast.success(tpl.isDynamic
      ? 'Template dinâmico aplicado! O agendamento em tempo real será configurado ao publicar.'
      : 'Modelo aplicado! Ajuste as perguntas.')
  }, [applyFormSpec, controller, name, selectedTemplateKey])

  const handleTemplateHover = React.useCallback((tpl: { flowJson: unknown; key?: string; form?: any; isDynamic?: boolean }) => {
    if (tpl.key) {
      setHoverTemplateKey(tpl.key)
    }
    if (hoverPreviewTimerRef.current) {
      clearTimeout(hoverPreviewTimerRef.current)
    }
    hoverPreviewTimerRef.current = setTimeout(() => {
      try {
        // Usa tpl.form se disponível (para templates dinâmicos)
        const form = tpl.form
          ? { ...tpl.form, title: name || tpl.form.title }
          : flowJsonToFormSpec(tpl.flowJson, name || 'MiniApp')
        setFormPreview({
          title: form?.title || '',
          intro: form?.intro || '',
          submitLabel: form?.submitLabel || '',
          questions: Array.isArray(form?.fields)
            ? form.fields.map((f: any) => ({
                label: String(f?.label || 'Pergunta'),
                required: !!f?.required,
              }))
            : [],
        })
        setFormPreviewJson(tpl.flowJson)
      } catch {
        // ignore hover preview errors
      }
    }, 150)
  }, [name])

  React.useEffect(() => {
    if (!flow) return
    // Só sincroniza quando o registro muda (ou quando ainda não há valor no state)
    setName((prev) => prev || flow.name || '')
    setMetaFlowId((prev) => prev || flow.meta_flow_id || '')
  }, [flow?.id])

  React.useEffect(() => {
    const flowJson = (flow as any)?.flow_json
    if (!flowJson || typeof flowJson !== 'object') return
    const dataApiVersion = (flowJson as any).data_api_version
    if (dataApiVersion === '3.0') {
      dynamicFlowJsonRef.current = flowJson as Record<string, unknown>
      setFormPreviewJson(flowJson)
    }
  }, [flow])

  const shouldShowLoading = controller.isLoading
  const panelClass = 'rounded-2xl border border-white/10 bg-zinc-900/60 shadow-[0_12px_30px_rgba(0,0,0,0.35)]'
  const metaStatus = String((flow as any)?.meta_status || '').toUpperCase()
  const hasMetaErrors = Array.isArray((flow as any)?.meta_validation_errors)
    ? (flow as any).meta_validation_errors.length > 0
    : !!(flow as any)?.meta_validation_errors
  const statusLabel = metaStatus === 'PUBLISHED'
    ? 'Publicado'
    : metaStatus === 'PENDING' || metaStatus === 'IN_REVIEW'
      ? 'Em revisão'
      : metaStatus === 'REJECTED' || metaStatus === 'ERROR' || hasMetaErrors
        ? 'Requer ação'
        : metaStatus
          ? metaStatus
          : 'Rascunho'
  const statusClass = metaStatus === 'PUBLISHED'
    ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100'
    : metaStatus === 'PENDING' || metaStatus === 'IN_REVIEW' || metaStatus === 'REJECTED' || metaStatus === 'ERROR' || hasMetaErrors
      ? 'border-amber-400/30 bg-amber-500/10 text-amber-200'
      : 'border-white/10 bg-zinc-950/40 text-gray-300'
  const steps = [
    { id: 1, label: 'Começar' },
    { id: 2, label: 'Conteúdo' },
    { id: 3, label: 'Finalizar' },
  ] as const

  return (
    <Page>
      <PageHeader>
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-widest text-gray-500">Templates / MiniApps / Builder</div>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-3">
              <PageTitle>Editor de MiniApp</PageTitle>
              {flow ? (
                <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${statusClass}`}>
                  {statusLabel}
                </span>
              ) : null}
            </div>
            <PageDescription>
              MiniApp é um formulário. Crie perguntas no modo Formulário e envie para a Meta quando estiver pronto.
            </PageDescription>
          </div>
        </div>
        <PageActions>
          <div className="flex items-center gap-2">
            <Link href="/templates?tab=flows">
              <Button variant="outline" className="border-white/10 bg-zinc-900 hover:bg-white/5">
                <ArrowLeft className="w-4 h-4" />
                Voltar
              </Button>
            </Link>
            <Link href="/flows/builder">
              <Button variant="outline" className="border-white/10 bg-zinc-900 hover:bg-white/5">
                Lista
              </Button>
            </Link>
          </div>
        </PageActions>
      </PageHeader>

      {shouldShowLoading ? (
        <div className={`${panelClass} p-8 text-gray-300 flex items-center gap-3`}>
          <Loader2 className="w-5 h-5 animate-spin" />
          Carregando miniapp...
        </div>
      ) : controller.isError ? (
        <div className={`${panelClass} p-8 text-red-300 space-y-2`}>
          <div className="font-medium">Falha ao carregar miniapp.</div>
          <div className="text-sm text-red-200/90 whitespace-pre-wrap">
            {controller.error?.message || 'Erro desconhecido'}
          </div>
          <div>
            <Button variant="outline" onClick={() => router.refresh()} className="border-white/10 bg-zinc-900 hover:bg-white/5">
              Tentar novamente
            </Button>
          </div>
        </div>
      ) : !flow ? (
        <div className={`${panelClass} p-8 text-gray-300`}>MiniApp não encontrada.</div>
      ) : (
        <>
          <div className="mt-4 grid xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-6 items-start">
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {steps.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setStep(item.id)}
                    className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm transition ${
                      step === item.id
                        ? 'border-emerald-400/40 bg-emerald-500/10 text-white'
                        : 'border-white/10 bg-zinc-900/40 text-gray-400 hover:text-white'
                    }`}
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 text-xs font-semibold leading-none">
                      {item.id}
                    </span>
                    <span className="uppercase tracking-widest text-xs">{item.label}</span>
                  </button>
                ))}
              </div>

              {step === 1 && (
                <div className={`${panelClass} p-6 space-y-6`}>
                  <div>
                    <div className="text-lg font-semibold text-white">Como quer começar?</div>
                    <div className="text-xs text-gray-500">Escolha uma opção para criar sua MiniApp.</div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <button
                      type="button"
                      onClick={() => setStartMode('ai')}
                      className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 text-left hover:bg-white/5 transition"
                    >
                      <div className="flex items-center gap-2 text-white font-semibold">
                        <Wand2 className="h-4 w-4" />
                        Criar com IA
                      </div>
                      <div className="mt-1 text-xs text-gray-400">Descreva o que precisa e a IA monta as perguntas.</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setStartMode('template')}
                      className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 text-left hover:bg-white/5 transition"
                    >
                      <div className="flex items-center gap-2 text-white font-semibold">
                        <LayoutTemplate className="h-4 w-4" />
                        Usar modelo pronto
                      </div>
                      <div className="mt-1 text-xs text-gray-400">Escolha um template e personalize.</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setStep(2)}
                      className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 text-left hover:bg-white/5 transition"
                    >
                      <div className="flex items-center gap-2 text-white font-semibold">
                        <PenSquare className="h-4 w-4" />
                        Criar do zero
                      </div>
                      <div className="mt-1 text-xs text-gray-400">Comece com a primeira pergunta.</div>
                    </button>
                  </div>

                  {startMode === 'ai' ? (
                    <div className={`rounded-2xl border border-white/10 bg-zinc-900/60 p-4 space-y-3 ${aiLoading ? 'animate-pulse' : ''}`}>
                      <div className="text-sm font-semibold text-white">Criar com IA</div>
                      <div className="text-xs text-gray-500">Descreva o que você quer coletar.</div>
                      <Textarea
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                        className="min-h-28 bg-zinc-900 border-white/10 text-white"
                        placeholder='Ex: "Quero um formulário de pré-cadastro para uma turma. Pergunte nome, telefone, e-mail e cidade."'
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="border-white/10 bg-zinc-950/40 hover:bg-white/5"
                          onClick={() => setStartMode(null)}
                          disabled={aiLoading}
                        >
                          Cancelar
                        </Button>
                        <Button type="button" onClick={handleGenerateWithAI} disabled={aiLoading || aiPrompt.trim().length < 10}>
                          {aiLoading ? 'Gerando…' : 'Gerar MiniApp'}
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  {startMode === 'template' ? (
                    <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 space-y-3">
                      <div className="text-sm font-semibold text-white">Usar modelo pronto</div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {FLOW_TEMPLATES.map((tpl) => (
                          <button
                            key={tpl.key}
                            type="button"
                            onMouseEnter={() => handleTemplateHover(tpl)}
                            onMouseLeave={() => {
                              if (hoverPreviewTimerRef.current) {
                                clearTimeout(hoverPreviewTimerRef.current)
                                hoverPreviewTimerRef.current = null
                              }
                            }}
                            onClick={() => setSelectedTemplateKey(tpl.key)}
                            className={`rounded-xl border p-4 text-left transition ${
                              selectedTemplateKey === tpl.key
                                ? 'border-emerald-400/40 bg-emerald-500/10 text-white'
                                : 'border-white/10 bg-zinc-900/60 text-gray-300 hover:bg-white/5'
                            }`}
                          >
                            <div className="text-sm font-semibold">{tpl.name}</div>
                            <div className="mt-1 text-xs text-gray-400">{tpl.description}</div>
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="border-white/10 bg-zinc-950/40 hover:bg-white/5"
                          onClick={() => setStartMode(null)}
                        >
                          Cancelar
                        </Button>
                        <Button type="button" onClick={handleApplyTemplate} disabled={!selectedTemplateKey}>
                          Usar modelo
                        </Button>
                      </div>
                    </div>
                  ) : null}

                </div>
              )}

              <div className={`${panelClass} p-6 space-y-4 ${step === 2 ? '' : 'hidden'}`}>
                <FlowFormBuilder
                  flowName={name}
                  currentSpec={controller.spec}
                  isSaving={controller.isSaving}
                  showHeaderActions={false}
                  showTechFields={false}
                  registerActions={(actions) => {
                    formActionsRef.current = actions
                  }}
                  onActionComplete={() => setStep(2)}
                  onPreviewChange={handleFormPreviewChange as any}
                  onSave={(patch) => {
                    const dynamicFlowJson = dynamicFlowJsonRef.current
                    controller.save({
                      ...(patch.spec !== undefined ? { spec: patch.spec } : {}),
                      ...(patch.flowJson !== undefined
                        ? { flowJson: dynamicFlowJson ?? patch.flowJson }
                        : {}),
                    })
                  }}
                />

                <div className="flex items-center justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    className="border-white/10 bg-zinc-950/40 hover:bg-white/5"
                    onClick={() => setStep(3)}
                  >
                    Ir para finalizar
                  </Button>
                </div>
              </div>

              {step === 3 && (
                <div className={`${panelClass} p-6 space-y-4`}>
                  <div>
                    <div className="text-lg font-semibold text-white">Finalizar</div>
                  </div>

                  <div>
                    <label className="block text-xs uppercase tracking-widest text-gray-500 mb-2">Nome</label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} />
                  </div>

                  <details className="rounded-2xl border border-white/10 bg-zinc-950/40 p-4">
                    <summary className="cursor-pointer text-sm font-semibold text-white">
                      Ajustes avançados
                    </summary>
                    <div className="mt-3 space-y-3">
                      <div>
                        <label className="block text-xs uppercase tracking-widest text-gray-500 mb-2">Screen ID (Meta)</label>
                        <Input
                          value={formScreenId}
                          onChange={(e) => {
                            const next = e.target.value.toUpperCase()
                            setFormScreenId(next)
                            formActionsRef.current?.setScreenId(next)
                          }}
                          placeholder="Ex: CADASTRO"
                        />
                      </div>
                      <div className="text-sm text-gray-400">
                        {formDirty ? 'Alterações não salvas' : 'Sincronizado'}
                        {formIssues.length === 0 ? (
                          <span className="text-emerald-300"> • pronto</span>
                        ) : (
                          <span className="text-amber-300"> • revisar</span>
                        )}
                      </div>
                    </div>
                  </details>

                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    <Button
                      variant="outline"
                      onClick={() => controller.save({ name, metaFlowId: metaFlowId || undefined })}
                      disabled={controller.isSaving}
                      className="border-white/10 bg-zinc-950/40 hover:bg-white/5"
                    >
                      {controller.isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      Salvar rascunho
                    </Button>

                    <Button
                      onClick={async () => {
                        const nextSpec = latestFormSpecRef.current
                          ? { ...(controller.spec as any), form: latestFormSpecRef.current }
                          : controller.spec

                        const flowJsonToSave =
                          dynamicFlowJsonRef.current || formPreviewJson || (flow as any)?.flow_json
                        // #region agent log
                        fetch('http://127.0.0.1:7243/ingest/1294d6ce-76f2-430d-96ab-3ae4d7527327',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'endpoint-health',hypothesisId:'H1',location:'app/(dashboard)/flows/builder/[id]/page.tsx:551',message:'publish preflight start',data:{flowId:id},timestamp:Date.now()})}).catch(()=>{});
                        // #endregion agent log
                        try {
                          const keysRes = await fetch('/api/flows/endpoint/keys', { cache: 'no-store' })
                          const keysData = await keysRes.json().catch(() => ({}))
                          const endpointUrl = typeof keysData?.endpointUrl === 'string' ? keysData.endpointUrl : null
                          // #region agent log
                          fetch('http://127.0.0.1:7243/ingest/1294d6ce-76f2-430d-96ab-3ae4d7527327',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'endpoint-health',hypothesisId:'H2',location:'app/(dashboard)/flows/builder/[id]/page.tsx:558',message:'endpoint keys status',data:{flowId:id,keysOk:keysRes.ok,endpointUrl},timestamp:Date.now()})}).catch(()=>{});
                          // #endregion agent log
                          if (endpointUrl) {
                            const endpointRes = await fetch(endpointUrl, { method: 'GET', cache: 'no-store' })
                            // #region agent log
                            fetch('http://127.0.0.1:7243/ingest/1294d6ce-76f2-430d-96ab-3ae4d7527327',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'endpoint-health',hypothesisId:'H3',location:'app/(dashboard)/flows/builder/[id]/page.tsx:563',message:'endpoint GET check',data:{flowId:id,endpointUrl,status:endpointRes.status,ok:endpointRes.ok},timestamp:Date.now()})}).catch(()=>{});
                            // #endregion agent log
                          }
                        } catch (error) {
                          // #region agent log
                          fetch('http://127.0.0.1:7243/ingest/1294d6ce-76f2-430d-96ab-3ae4d7527327',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'endpoint-health',hypothesisId:'H4',location:'app/(dashboard)/flows/builder/[id]/page.tsx:569',message:'endpoint preflight error',data:{flowId:id,errorMessage:error instanceof Error ? error.message : 'unknown'},timestamp:Date.now()})}).catch(()=>{});
                          // #endregion agent log
                        }
                        // #region agent log
                        fetch('http://127.0.0.1:7243/ingest/1294d6ce-76f2-430d-96ab-3ae4d7527327',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'post-fix',hypothesisId:'H4',location:'app/(dashboard)/flows/builder/[id]/page.tsx:543',message:'publish flow json selection',data:{flowId:id,hasDynamicOverride:Boolean(dynamicFlowJsonRef.current),flowJsonVersion:(flowJsonToSave as any)?.version ?? null,flowJsonDataApiVersion:(flowJsonToSave as any)?.data_api_version ?? null},timestamp:Date.now()})}).catch(()=>{});
                        // #endregion agent log

                        await controller.saveAsync({
                          name,
                          metaFlowId: metaFlowId || undefined,
                          ...(nextSpec ? { spec: nextSpec } : {}),
                          ...(flowJsonToSave ? { flowJson: flowJsonToSave } : {}),
                        })

                        const updated = await controller.publishToMetaAsync({
                          publish: true,
                          categories: ['OTHER'],
                          updateIfExists: true,
                        })

                        setMetaFlowId(updated.meta_flow_id || '')
                        toast.success('MiniApp publicada na Meta com sucesso!')
                        router.push('/templates?tab=flows')
                      }}
                      disabled={controller.isSaving || controller.isPublishingToMeta}
                      className="bg-white text-black hover:bg-gray-200"
                    >
                      {(controller.isSaving || controller.isPublishingToMeta) ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <UploadCloud className="w-4 h-4" />
                      )}
                      Enviar para Meta
                    </Button>
                  </div>
                </div>
              )}

            </div>

            <div className="space-y-4 lg:sticky lg:top-6 self-start">
              <div className={`${panelClass} p-4`}>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="text-xs uppercase tracking-widest text-gray-500">Resumo</div>
                    <div className="text-lg font-semibold text-white">Prévia</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPreviewMode('smartzap')}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                      previewMode === 'smartzap'
                        ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100'
                        : 'border-white/10 bg-zinc-950/40 text-gray-300 hover:text-white'
                    }`}
                  >
                    Padrão SmartZap
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewMode('meta')}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                      previewMode === 'meta'
                        ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100'
                        : 'border-white/10 bg-zinc-950/40 text-gray-300 hover:text-white'
                    }`}
                  >
                    Meta (oficial)
                  </button>
                </div>

                {hasPreviewQuestions || hasIntro ? (
                  previewMode === 'smartzap' ? (
                    <TemplateModelPreviewCard
                      title="Prévia do modelo"
                      businessName="Business"
                      contextLabel="flow"
                      headerLabel={null}
                      bodyText={previewBody}
                      emptyBodyText="Adicione perguntas para ver a prévia."
                      buttons={[
                        {
                          type: 'FLOW',
                          text: previewButtonLabel,
                        },
                      ]}
                    />
                  ) : (
                    <div className="flex items-center justify-center">
                      <MetaFlowPreview flowJson={formPreviewJson || (flow as any).flow_json} />
                    </div>
                  )
                ) : (
                  <div className="py-16 text-center text-sm text-gray-500">
                    Adicione uma pergunta para ver a prévia.
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </Page>
  )
}
