'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Plus, Trash2, ArrowRight, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CreateFlowFromTemplateDialog } from '@/components/features/flows/builder/CreateFlowFromTemplateDialog'
import { CreateFlowWithAIDialog } from '@/components/features/flows/builder/CreateFlowWithAIDialog'
import type { FlowRow } from '@/services/flowsService'

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('pt-BR')
}

export function FlowBuilderListView(props: {
  flows: FlowRow[]
  isLoading: boolean
  isFetching: boolean
  search: string
  onSearchChange: (v: string) => void
  onCreate: (name: string) => void
  onCreateFromTemplate: (input: { name: string; templateKey: string }) => void
  onCreateWithAI: (input: { name: string; prompt: string }) => void
  isCreating: boolean
  isCreatingWithAI: boolean
  onDelete: (id: string) => void
  isDeleting: boolean
  onRefresh: () => void
}) {
  const [newName, setNewName] = useState('')

  const canCreate = useMemo(() => newName.trim().length >= 3, [newName])

  return (
    <div className="space-y-4">
      <div className="glass-panel p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Buscar</label>
              <Input
                value={props.search}
                onChange={(e) => props.onSearchChange(e.target.value)}
                placeholder="Nome ou Meta Flow ID"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Criar novo Flow</label>
              <div className="flex gap-2">
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ex: onboarding_lead"
                />
                <Button
                  type="button"
                  onClick={() => {
                    const n = newName.trim()
                    if (!n) return
                    props.onCreate(n)
                    setNewName('')
                  }}
                  disabled={!canCreate || props.isCreating}
                >
                  <Plus size={16} />
                  Criar
                </Button>
              </div>
              <div className="text-[11px] text-gray-500 mt-1">Sugestão: use nomes curtos e consistentes (ex.: snake_case).</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <CreateFlowWithAIDialog isCreating={props.isCreatingWithAI} onCreate={(input) => props.onCreateWithAI(input)} />
            <CreateFlowFromTemplateDialog
              isCreating={props.isCreating}
              onCreate={(input) => props.onCreateFromTemplate(input)}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={props.onRefresh}
              disabled={props.isLoading || props.isFetching}
            >
              <RefreshCw size={16} className={props.isFetching ? 'animate-spin' : ''} />
              Atualizar
            </Button>
          </div>
        </div>

        <div className="mt-3 text-xs text-gray-500">
          {props.isLoading ? 'Carregando…' : `Mostrando ${props.flows.length} flow(s)`}
          {props.isFetching && !props.isLoading ? ' (atualizando…)': ''}
        </div>
      </div>

      <div className="glass-panel p-0 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5">
            <tr className="text-gray-300">
              <th className="px-4 py-3 font-semibold">Nome</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Meta Flow ID</th>
              <th className="px-4 py-3 font-semibold">Criado</th>
              <th className="px-4 py-3 font-semibold text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {props.flows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-gray-500">
                  Nenhum flow ainda. Crie um para abrir o editor visual.
                </td>
              </tr>
            ) : (
              props.flows.map((f) => (
                <tr key={f.id} className="border-t border-white/5 hover:bg-white/5">
                  <td className="px-4 py-3 text-gray-200 font-medium">{f.name}</td>
                  <td className="px-4 py-3 text-gray-300">{f.status}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-300">{f.meta_flow_id || '—'}</td>
                  <td className="px-4 py-3 text-gray-400">{formatDateTime(f.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <Link href={`/flows/builder/${encodeURIComponent(f.id)}`}>
                        <Button type="button" variant="secondary">
                          Abrir
                          <ArrowRight size={16} />
                        </Button>
                      </Link>
                      <Button
                        type="button"
                        variant="ghost"
                        className="text-red-300 hover:text-red-200"
                        onClick={() => props.onDelete(f.id)}
                        disabled={props.isDeleting}
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
