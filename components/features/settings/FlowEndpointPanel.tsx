'use client';

import React, { useState, useEffect } from 'react';
import { Workflow, Copy, Check, RefreshCw, Key } from 'lucide-react';
import { toast } from 'sonner';

interface EndpointStatus {
  configured: boolean;
  publicKey: string | null;
  endpointUrl: string | null;
}

export function FlowEndpointPanel() {
  const [status, setStatus] = useState<EndpointStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState<'url' | 'key' | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/flows/endpoint/keys');
      const data = await res.json();
      setStatus(data);
    } catch {
      toast.error('Erro ao verificar status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch('/api/flows/endpoint/keys', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        toast.success('Chaves geradas com sucesso!');
        await fetchStatus();
      } else {
        toast.error(data.error || 'Erro ao gerar');
      }
    } catch {
      toast.error('Erro ao gerar chaves');
    } finally {
      setGenerating(false);
    }
  };

  const copyToClipboard = async (text: string, type: 'url' | 'key') => {
    await navigator.clipboard.writeText(text);
    setCopied(type);
    toast.success('Copiado!');
    setTimeout(() => setCopied(null), 2000);
  };

  if (loading) {
    return (
      <div className="glass-panel rounded-2xl p-8">
        <div className="animate-pulse h-20 bg-white/5 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-2xl p-8">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <span className="w-1 h-6 bg-purple-500 rounded-full" />
            <Workflow size={18} className="text-purple-300" />
            MiniApp Dinâmico (Endpoint)
          </h3>
          <p className="text-sm text-gray-400 mt-1">
            Permite MiniApps buscarem dados em tempo real (ex: slots do Calendar).
          </p>
        </div>
        {status?.configured && (
          <span className="px-3 py-1 text-xs bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 rounded-full">
            Configurado
          </span>
        )}
      </div>

      {!status?.configured ? (
        <div className="text-center py-8">
          <div className="inline-flex p-4 bg-purple-500/10 rounded-2xl mb-4">
            <Key size={32} className="text-purple-400" />
          </div>
          <p className="text-gray-400 mb-4">Gere as chaves para ativar o endpoint.</p>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="h-10 px-6 bg-purple-500 hover:bg-purple-400 text-white font-medium rounded-lg transition-colors inline-flex items-center gap-2 disabled:opacity-50"
          >
            {generating ? <RefreshCw size={16} className="animate-spin" /> : <Key size={16} />}
            {generating ? 'Gerando...' : 'Gerar Chaves'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Sucesso */}
          <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4">
            <div className="flex items-center gap-2 text-emerald-300">
              <Check size={16} />
              <span className="text-sm font-medium">Pronto para usar!</span>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Ao publicar um MiniApp dinâmico, o endpoint será configurado automaticamente.
            </p>
          </div>

          {/* Endpoint URL */}
          <div className="bg-zinc-900/50 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-400">URL do Endpoint</span>
              <button
                onClick={() => status.endpointUrl && copyToClipboard(status.endpointUrl, 'url')}
                className="text-xs text-purple-300 hover:text-purple-200 flex items-center gap-1"
              >
                {copied === 'url' ? <Check size={12} /> : <Copy size={12} />}
                {copied === 'url' ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <code className="text-sm text-white font-mono break-all">
              {status.endpointUrl || 'URL não disponível'}
            </code>
          </div>

          {/* Regenerate */}
          <div className="flex justify-end">
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="text-xs text-gray-400 hover:text-white flex items-center gap-1 transition-colors"
            >
              <RefreshCw size={12} className={generating ? 'animate-spin' : ''} />
              Regenerar chaves
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
