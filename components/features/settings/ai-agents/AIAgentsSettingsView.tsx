'use client'

/**
 * T057: AIAgentsSettingsView - Main view for AI agents management
 * Lists agents with create/edit/delete capabilities
 */

import React, { useState, useCallback, useMemo } from 'react'
import { Bot, Plus, Loader2, AlertCircle, AlertTriangle, Power } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AIAgentCard } from './AIAgentCard'
import { AIAgentForm } from './AIAgentForm'
import type { AIAgent } from '@/types'
import type { CreateAIAgentParams, UpdateAIAgentParams } from '@/services/aiAgentService'

export interface AIAgentsSettingsViewProps {
  agents: AIAgent[]
  isLoading: boolean
  error: Error | null
  onCreate: (params: CreateAIAgentParams) => Promise<AIAgent>
  onUpdate: (id: string, params: UpdateAIAgentParams) => Promise<AIAgent>
  onDelete: (id: string) => Promise<unknown>
  onSetDefault: (id: string) => Promise<AIAgent>
  onToggleActive: (id: string, isActive: boolean) => Promise<AIAgent>
  isCreating?: boolean
  isUpdating?: boolean
  isDeleting?: boolean
  // Toggle global
  globalEnabled: boolean
  isGlobalToggleLoading?: boolean
  onGlobalToggle: (enabled: boolean) => Promise<unknown>
}

export function AIAgentsSettingsView({
  agents,
  isLoading,
  error,
  onCreate,
  onUpdate,
  onDelete,
  onSetDefault,
  onToggleActive,
  isCreating,
  isUpdating,
  isDeleting,
  globalEnabled,
  isGlobalToggleLoading,
  onGlobalToggle,
}: AIAgentsSettingsViewProps) {
  // Form state
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingAgent, setEditingAgent] = useState<AIAgent | null>(null)

  // Delete confirmation state
  const [deleteAgent, setDeleteAgent] = useState<AIAgent | null>(null)

  // Handlers
  const handleOpenCreate = useCallback(() => {
    setEditingAgent(null)
    setIsFormOpen(true)
  }, [])

  const handleOpenEdit = useCallback((agent: AIAgent) => {
    setEditingAgent(agent)
    setIsFormOpen(true)
  }, [])

  const handleFormSubmit = useCallback(
    async (params: CreateAIAgentParams | UpdateAIAgentParams) => {
      if (editingAgent) {
        await onUpdate(editingAgent.id, params as UpdateAIAgentParams)
      } else {
        await onCreate(params as CreateAIAgentParams)
      }
      setIsFormOpen(false)
      setEditingAgent(null)
    },
    [editingAgent, onCreate, onUpdate]
  )

  const handleConfirmDelete = useCallback(async () => {
    if (deleteAgent) {
      await onDelete(deleteAgent.id)
      setDeleteAgent(null)
    }
  }, [deleteAgent, onDelete])

  const handleSetDefault = useCallback(
    async (agent: AIAgent) => {
      await onSetDefault(agent.id)
    },
    [onSetDefault]
  )

  const handleToggleActive = useCallback(
    async (agent: AIAgent, isActive: boolean) => {
      await onToggleActive(agent.id, isActive)
    },
    [onToggleActive]
  )

  // Check if there's an active default agent
  const hasActiveDefaultAgent = useMemo(() => {
    return agents.some((agent) => agent.is_default && agent.is_active)
  }, [agents])

  // Check if there are agents but none is default
  const hasAgentsButNoDefault = useMemo(() => {
    return agents.length > 0 && !agents.some((agent) => agent.is_default)
  }, [agents])

  // Handler para toggle global
  const handleGlobalToggle = useCallback(
    async (checked: boolean) => {
      await onGlobalToggle(checked)
    },
    [onGlobalToggle]
  )

  return (
    <TooltipProvider>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary-500/10">
                <Bot className="h-5 w-5 text-primary-400" />
              </div>
              <div>
                <CardTitle>Agentes IA</CardTitle>
                <CardDescription>
                  Configure os agentes de atendimento automático
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {/* Toggle global */}
              <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg bg-zinc-800/50 border border-zinc-700">
                <span className="text-sm text-zinc-400">Atendimento IA</span>
                <Switch
                  id="ai-agents-global"
                  checked={globalEnabled}
                  onCheckedChange={handleGlobalToggle}
                  disabled={isGlobalToggleLoading}
                  className="data-[state=checked]:bg-primary-500"
                />
              </div>
              <Button onClick={handleOpenCreate} size="sm" disabled={!globalEnabled}>
                <Plus className="h-4 w-4 mr-2" />
                Novo Agente
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {/* Loading state */}
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
            </div>
          )}

          {/* Error state */}
          {error && !isLoading && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <AlertCircle className="h-8 w-8 text-red-400 mb-2" />
              <p className="text-sm text-zinc-400">Erro ao carregar agentes</p>
              <p className="text-xs text-zinc-500">{error.message}</p>
            </div>
          )}

          {/* Banner: Global toggle OFF */}
          {!isLoading && !error && !globalEnabled && agents.length > 0 && (
            <div className="mb-4 p-4 rounded-lg bg-zinc-800/50 border border-zinc-700">
              <div className="flex items-start gap-3">
                <Power className="h-5 w-5 text-zinc-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-zinc-300">
                    Agentes IA desativados globalmente
                  </p>
                  <p className="text-xs text-zinc-500 mt-1">
                    Ative o switch acima para habilitar o atendimento automático por IA.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Empty state */}
          {!isLoading && !error && agents.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              {/* Warning banner - só mostra se toggle global está ON */}
              {globalEnabled && (
                <div className="w-full max-w-md mb-6 p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div className="text-left">
                      <p className="text-sm font-medium text-amber-400">
                        Atendimento automático desativado
                      </p>
                      <p className="text-xs text-amber-400/70 mt-1">
                        Sem um agente configurado, todas as conversas serão direcionadas para atendimento humano.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="p-4 rounded-full bg-zinc-800 mb-4">
                <Bot className="h-8 w-8 text-zinc-500" />
              </div>
              <h3 className="text-lg font-medium text-zinc-300 mb-1">
                Nenhum agente configurado
              </h3>
              <p className="text-sm text-zinc-500 mb-4">
                Crie seu primeiro agente IA para automatizar o atendimento
              </p>
              <Button onClick={handleOpenCreate} disabled={!globalEnabled}>
                <Plus className="h-4 w-4 mr-2" />
                Criar Primeiro Agente
              </Button>
            </div>
          )}

          {/* Warning: no default agent (só mostra se toggle global está ON) */}
          {!isLoading && !error && globalEnabled && hasAgentsButNoDefault && (
            <div className="mb-4 p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-400">
                    Nenhum agente definido como padrão
                  </p>
                  <p className="text-xs text-amber-400/70 mt-1">
                    Defina um agente como padrão para que ele seja usado automaticamente em novas conversas.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Warning: default agent is inactive (só mostra se toggle global está ON) */}
          {!isLoading && !error && globalEnabled && agents.length > 0 && !hasActiveDefaultAgent && !hasAgentsButNoDefault && (
            <div className="mb-4 p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-400">
                    Agente padrão está desativado
                  </p>
                  <p className="text-xs text-amber-400/70 mt-1">
                    Ative o agente padrão ou defina outro como padrão para habilitar o atendimento automático.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Agents grid */}
          {!isLoading && !error && agents.length > 0 && (
            <div className={`grid gap-4 sm:grid-cols-2 ${!globalEnabled ? 'opacity-60' : ''}`}>
              {agents.map((agent) => (
                <AIAgentCard
                  key={agent.id}
                  agent={agent}
                  onEdit={handleOpenEdit}
                  onDelete={setDeleteAgent}
                  onSetDefault={handleSetDefault}
                  onToggleActive={handleToggleActive}
                  isUpdating={isUpdating}
                  disabled={!globalEnabled}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit form */}
      <AIAgentForm
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        agent={editingAgent}
        onSubmit={handleFormSubmit}
        isSubmitting={isCreating || isUpdating}
      />

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteAgent} onOpenChange={() => setDeleteAgent(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir agente?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o agente &ldquo;{deleteAgent?.name}&rdquo;?
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-red-600 hover:bg-red-700"
              disabled={isDeleting}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Excluindo...
                </>
              ) : (
                'Excluir'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  )
}
