'use client';

import React, { useState, useEffect } from 'react';
import { Clock, Save, Loader2 } from 'lucide-react';
import { WorkflowExecutionConfig } from '../../../types';

export interface WorkflowExecutionPanelProps {
  workflowExecution?: {
    ok: boolean;
    source?: string;
    config: WorkflowExecutionConfig;
  } | null;
  workflowExecutionLoading?: boolean;
  saveWorkflowExecution?: (data: Partial<WorkflowExecutionConfig>) => Promise<WorkflowExecutionConfig | void>;
  isSaving?: boolean;
}

const clampExecutionValue = (value: number, min: number, max: number) => {
  const safe = Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, Math.floor(safe)));
};

export function WorkflowExecutionPanel({
  workflowExecution,
  workflowExecutionLoading,
  saveWorkflowExecution,
  isSaving,
}: WorkflowExecutionPanelProps) {
  const workflowExecutionConfig = workflowExecution?.config;

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(() => ({
    retryCount: workflowExecutionConfig?.retryCount ?? 0,
    retryDelayMs: workflowExecutionConfig?.retryDelayMs ?? 500,
    timeoutMs: workflowExecutionConfig?.timeoutMs ?? 10000,
  }));

  // Keep draft in sync when server data arrives (unless editing)
  useEffect(() => {
    if (isEditing) return;
    if (!workflowExecution?.config) return;
    setDraft({
      retryCount: workflowExecution.config.retryCount,
      retryDelayMs: workflowExecution.config.retryDelayMs,
      timeoutMs: workflowExecution.config.timeoutMs,
    });
  }, [
    workflowExecution?.config?.retryCount,
    workflowExecution?.config?.retryDelayMs,
    workflowExecution?.config?.timeoutMs,
    isEditing,
  ]);

  const handleSave = async () => {
    if (!saveWorkflowExecution) return;
    await saveWorkflowExecution({
      retryCount: clampExecutionValue(draft.retryCount, 0, 10),
      retryDelayMs: clampExecutionValue(draft.retryDelayMs, 0, 60000),
      timeoutMs: clampExecutionValue(draft.timeoutMs, 0, 60000),
    });
    setIsEditing(false);
  };

  return (
    <div className="glass-panel rounded-2xl p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
            <span className="w-1 h-6 bg-sky-500 rounded-full"></span>
            <Clock size={18} className="text-sky-300" />
            Execução do workflow (global)
          </h3>
          <p className="text-sm text-gray-400">
            Define retries e timeouts padrão para cada etapa, sem complicar o fluxo.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isEditing && (
            <button
              onClick={handleSave}
              disabled={!!isSaving}
              className="h-10 px-5 rounded-xl bg-sky-500 hover:bg-sky-400 text-black font-semibold transition-all text-sm flex items-center gap-2 shadow-lg shadow-sky-500/10 disabled:opacity-50"
            >
              {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              Salvar
            </button>
          )}
          <button
            onClick={() => setIsEditing((v) => !v)}
            className="h-10 px-4 rounded-xl bg-white/5 text-white hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all text-sm font-medium"
          >
            {isEditing ? 'Fechar' : 'Configurar'}
          </button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-zinc-900/40 border border-white/10 rounded-xl p-4">
          <div className="text-xs text-gray-500">Resumo</div>
          {workflowExecutionLoading ? (
            <div className="mt-2 text-sm text-gray-400 flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Carregando…
            </div>
          ) : (
            <div className="mt-2">
              <div className="text-sm text-white">
                retries: <span className="font-mono text-white">{workflowExecutionConfig?.retryCount ?? 0}</span>
                <span className="text-gray-500"> · </span>
                delay: <span className="font-mono text-white">{workflowExecutionConfig?.retryDelayMs ?? 500}ms</span>
                <span className="text-gray-500"> · </span>
                timeout: <span className="font-mono text-white">{workflowExecutionConfig?.timeoutMs ?? 10000}ms</span>
              </div>
              <div className="mt-2 text-xs text-gray-400">
                fonte: {workflowExecution?.source || 'env'}
              </div>
            </div>
          )}
        </div>

        <div className="bg-zinc-900/40 border border-white/10 rounded-xl p-4">
          <div className="text-xs text-gray-500">Observação</div>
          <div className="mt-2 text-xs text-gray-400 leading-relaxed">
            Aplica em todos os steps do workflow. Ajustes por etapa foram removidos para manter simples.
          </div>
        </div>
      </div>

      {isEditing && (
        <div className="mt-6 p-5 bg-zinc-900/30 border border-white/10 rounded-2xl">
          <div className="text-sm font-medium text-white">Parâmetros globais</div>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">retryCount</label>
              <input
                type="number"
                min={0}
                max={10}
                value={draft.retryCount}
                onChange={(e) => setDraft((s) => ({ ...s, retryCount: Number(e.target.value) }))}
                className="w-full px-3 py-2 bg-zinc-900/50 border border-white/10 rounded-lg text-sm text-white font-mono"
              />
              <p className="text-[11px] text-gray-500 mt-1">Quantas tentativas extras por etapa.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">retryDelayMs</label>
              <input
                type="number"
                min={0}
                max={60000}
                value={draft.retryDelayMs}
                onChange={(e) => setDraft((s) => ({ ...s, retryDelayMs: Number(e.target.value) }))}
                className="w-full px-3 py-2 bg-zinc-900/50 border border-white/10 rounded-lg text-sm text-white font-mono"
              />
              <p className="text-[11px] text-gray-500 mt-1">Delay base antes de reintentar (backoff exponencial).</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">timeoutMs</label>
              <input
                type="number"
                min={0}
                max={60000}
                value={draft.timeoutMs}
                onChange={(e) => setDraft((s) => ({ ...s, timeoutMs: Number(e.target.value) }))}
                className="w-full px-3 py-2 bg-zinc-900/50 border border-white/10 rounded-lg text-sm text-white font-mono"
              />
              <p className="text-[11px] text-gray-500 mt-1">Tempo máximo por etapa antes de falhar.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
