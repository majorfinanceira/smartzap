'use client'

/**
 * T059: AIAgentCard - Display single AI agent with actions
 * Shows agent info, status, and action buttons
 */

import React from 'react'
import {
  Bot,
  Star,
  Pencil,
  Trash2,
  ToggleLeft,
  ToggleRight,
  MoreVertical,
  Clock,
  Thermometer,
  FileText,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { AIAgent } from '@/types'

export interface AIAgentCardProps {
  agent: AIAgent
  onEdit: (agent: AIAgent) => void
  onDelete: (agent: AIAgent) => void
  onSetDefault: (agent: AIAgent) => void
  onToggleActive: (agent: AIAgent, isActive: boolean) => void
  isUpdating?: boolean
  disabled?: boolean
}

export function AIAgentCard({
  agent,
  onEdit,
  onDelete,
  onSetDefault,
  onToggleActive,
  isUpdating,
  disabled,
}: AIAgentCardProps) {
  const debounceSeconds = agent.debounce_ms / 1000

  return (
    <Card
      className={cn(
        'relative transition-all',
        !agent.is_active && 'opacity-60',
        agent.is_default && 'ring-2 ring-primary-500/50'
      )}
    >
      {/* Default badge */}
      {agent.is_default && (
        <div className="absolute -top-2 -right-2">
          <Badge className="bg-primary-500 text-white gap-1">
            <Star className="h-3 w-3" />
            Padrão
          </Badge>
        </div>
      )}

      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'p-2 rounded-lg',
                agent.is_active ? 'bg-primary-500/10' : 'bg-zinc-800'
              )}
            >
              <Bot
                className={cn(
                  'h-5 w-5',
                  agent.is_active ? 'text-primary-400' : 'text-zinc-500'
                )}
              />
            </div>
            <div>
              <h3 className="font-medium text-white">{agent.name}</h3>
              <p className="text-xs text-zinc-500">{agent.model}</p>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                disabled={isUpdating || disabled}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(agent)}>
                <Pencil className="h-4 w-4 mr-2" />
                Editar
              </DropdownMenuItem>

              {!agent.is_default && (
                <DropdownMenuItem onClick={() => onSetDefault(agent)}>
                  <Star className="h-4 w-4 mr-2" />
                  Definir como padrão
                </DropdownMenuItem>
              )}

              <DropdownMenuItem
                onClick={() => onToggleActive(agent, !agent.is_active)}
              >
                {agent.is_active ? (
                  <>
                    <ToggleLeft className="h-4 w-4 mr-2" />
                    Desativar
                  </>
                ) : (
                  <>
                    <ToggleRight className="h-4 w-4 mr-2" />
                    Ativar
                  </>
                )}
              </DropdownMenuItem>

              {!agent.is_default && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => onDelete(agent)}
                    className="text-red-400"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Excluir
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* System prompt preview */}
        <div className="bg-zinc-900 rounded-lg p-3">
          <p className="text-xs text-zinc-400 line-clamp-3">
            {agent.system_prompt}
          </p>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-4 text-xs text-zinc-500">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1">
                <Thermometer className="h-3.5 w-3.5" />
                <span>{agent.temperature}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>Temperature</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1">
                <FileText className="h-3.5 w-3.5" />
                <span>{agent.max_tokens}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>Max tokens</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                <span>{debounceSeconds}s</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>Debounce (aguarda antes de responder)</TooltipContent>
          </Tooltip>

          {!agent.is_active && (
            <Badge variant="secondary" className="text-[10px] h-4">
              Inativo
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
