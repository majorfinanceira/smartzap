
import React from 'react';
import { Search, RefreshCw, Copy, Trash2, Calendar, Play, Pause, Loader2 } from 'lucide-react';
import { Campaign, CampaignStatus } from '../../../types';
import { Page, PageDescription, PageHeader, PageTitle } from '@/components/ui/page';

interface CampaignListViewProps {
  campaigns: Campaign[];
  isLoading: boolean;
  filter: string;
  searchTerm: string;
  onFilterChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  onDelete: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onRowClick: (id: string) => void;
  onPause?: (id: string) => void;
  onResume?: (id: string) => void;
  onStart?: (id: string) => void;
  isPausing?: boolean;
  isResuming?: boolean;
  isStarting?: boolean;
  deletingId?: string;
  duplicatingId?: string;
}

const StatusBadge = ({ status }: { status: CampaignStatus }) => {
  const styles = {
    [CampaignStatus.COMPLETED]: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    [CampaignStatus.SENDING]: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    [CampaignStatus.FAILED]: 'bg-red-500/10 text-red-400 border-red-500/20',
    [CampaignStatus.DRAFT]: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
    [CampaignStatus.PAUSED]: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    [CampaignStatus.SCHEDULED]: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  };

  const labels = {
    [CampaignStatus.COMPLETED]: 'Concluído',
    [CampaignStatus.SENDING]: 'Enviando',
    [CampaignStatus.FAILED]: 'Falhou',
    [CampaignStatus.DRAFT]: 'Rascunho',
    [CampaignStatus.PAUSED]: 'Pausado',
    [CampaignStatus.SCHEDULED]: 'Agendado',
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium border whitespace-nowrap select-none ${styles[status]}`}
    >
      {status === CampaignStatus.SENDING && (
        <span className="relative flex h-2 w-2 mr-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
        </span>
      )}
      {labels[status]}
    </span>
  );
};

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
}

function calcSendDuration(campaign: Campaign): string {
  const startIso = campaign.firstDispatchAt || campaign.startedAt
  if (!startIso || !campaign.lastSentAt) return '—'
  const start = Date.parse(startIso)
  const end = Date.parse(campaign.lastSentAt)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '—'
  return formatDuration(end - start)
}

export const CampaignListView: React.FC<CampaignListViewProps> = ({
  campaigns,
  isLoading,
  filter,
  searchTerm,
  onFilterChange,
  onSearchChange,
  onRefresh,
  onDelete,
  onDuplicate,
  onRowClick,
  onPause,
  onResume,
  onStart,
  isPausing,
  isResuming,
  isStarting,
  deletingId,
  duplicatingId,
}) => {
  if (isLoading) {
    return <div className="text-white">Carregando campanhas...</div>;
  }

  return (
    <Page>
      <PageHeader>
        <div>
          <PageTitle>Campanhas</PageTitle>
          <PageDescription>Gerencie e acompanhe seus disparos de mensagens</PageDescription>
        </div>
      </PageHeader>

      {/* Filters Bar */}
      <div className="glass-panel p-4 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3 w-full sm:w-96 bg-zinc-900 border border-white/5 rounded-lg px-4 py-2.5 focus-within:border-primary-500/50 focus-within:ring-1 focus-within:ring-primary-500/50 transition-all">
          <Search size={18} className="text-gray-500" />
          <input
            type="text"
            placeholder="Buscar campanhas..."
            className="bg-transparent border-none outline-none text-sm w-full text-white placeholder-gray-600"
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            className="p-2.5 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg border border-white/10 transition-colors"
            title="Atualizar"
          >
            <RefreshCw size={18} />
          </button>
          <select
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
            className="px-4 py-2.5 text-sm font-medium bg-zinc-900 text-gray-300 hover:text-white hover:bg-white/5 rounded-lg border border-white/10 transition-colors outline-none cursor-pointer appearance-none"
          >
            <option value="All">Todos os Status</option>
            <option value={CampaignStatus.DRAFT}>Rascunho</option>
            <option value={CampaignStatus.SENDING}>Enviando</option>
            <option value={CampaignStatus.COMPLETED}>Concluído</option>
            <option value={CampaignStatus.PAUSED}>Pausado</option>
            <option value={CampaignStatus.SCHEDULED}>Agendado</option>
            <option value={CampaignStatus.FAILED}>Falhou</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="glass-panel rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/5 border-b border-white/5 text-gray-400 uppercase tracking-wider text-xs">
              <tr>
                <th className="px-6 py-4 font-medium">Nome</th>
                <th className="px-6 py-4 font-medium">Status</th>
                <th className="px-6 py-4 font-medium">Destinatários</th>
                <th className="px-6 py-4 font-medium">Entrega</th>
                <th className="px-6 py-4 font-medium">Envio</th>
                <th className="px-6 py-4 font-medium">Criado em</th>
                <th className="px-6 py-4 font-medium text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {campaigns.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                    Nenhuma campanha encontrada com estes filtros.
                  </td>
                </tr>
              ) : (
                campaigns.map((campaign) => (
                  <tr
                    key={campaign.id}
                    onClick={() => onRowClick(campaign.id)}
                    className="hover:bg-white/5 transition-colors group cursor-pointer"
                  >
                    <td className="px-6 py-4">
                      <p className="font-medium text-white group-hover:text-primary-400 transition-colors">{campaign.name}</p>
                      <p className="text-xs text-gray-500 mt-1 font-mono">{campaign.templateName}</p>
                      {campaign.scheduledAt && campaign.status === CampaignStatus.SCHEDULED && (
                        <p className="text-xs text-purple-400 mt-1 flex items-center gap-1">
                          <Calendar size={10} />
                          {new Date(campaign.scheduledAt).toLocaleString('pt-BR', {
                            dateStyle: 'short',
                            timeStyle: 'short'
                          })}
                        </p>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={campaign.status} />
                    </td>
                    <td className="px-6 py-4 text-gray-400 font-mono">
                      {(campaign.recipients ?? 0).toLocaleString('pt-BR')}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 w-24 bg-zinc-800 rounded-full h-1">
                          {(() => {
                            // READ implica entrega. Em cenários onde a Meta manda READ sem DELIVERED
                            // (ou quando o contador agregado ainda não reconciliou), garantimos
                            // um valor de entrega coerente na lista.
                            const recipients = campaign.recipients ?? 0
                            const delivered = campaign.delivered ?? 0
                            const read = campaign.read ?? 0
                            const deliveredEffective = Math.max(delivered, read)
                            const pct = recipients > 0 ? (deliveredEffective / Math.max(1, recipients)) * 100 : 0

                            return (
                              <div
                                className="bg-primary-500 h-1 rounded-full shadow-[0_0_10px_rgba(16,185,129,0.5)]"
                                style={{ width: `${pct}%` }}
                              />
                            )
                          })()}
                        </div>
                        <span className="text-xs text-gray-400 font-mono">
                          {(() => {
                            const recipients = campaign.recipients ?? 0
                            const delivered = campaign.delivered ?? 0
                            const read = campaign.read ?? 0
                            const deliveredEffective = Math.max(delivered, read)
                            return recipients > 0 ? Math.round((deliveredEffective / Math.max(1, recipients)) * 100) : 0
                          })()}%
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-400 font-mono">
                      <span
                        className="text-xs"
                        title={(campaign.firstDispatchAt || campaign.startedAt) && campaign.lastSentAt
                          ? `De ${new Date(campaign.firstDispatchAt || campaign.startedAt!).toLocaleString('pt-BR')} até ${new Date(campaign.lastSentAt).toLocaleString('pt-BR')}`
                          : 'Duração do disparo (somente status sent).'}
                      >
                        {calcSendDuration(campaign)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-500 font-mono text-xs">
                      {new Date(campaign.createdAt).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {/* Quick action: Clone campaign */}
                        {onDuplicate && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onDuplicate(campaign.id); }}
                            title="Clonar"
                            disabled={duplicatingId === campaign.id}
                            className="p-2 rounded-lg text-gray-400 hover:text-primary-400 hover:bg-primary-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {duplicatingId === campaign.id ? (
                              <Loader2 size={16} className="animate-spin text-primary-400" />
                            ) : (
                              <Copy size={16} />
                            )}
                          </button>
                        )}

                        {/* Quick action: Start scheduled campaign */}
                        {(campaign.status === CampaignStatus.SCHEDULED || campaign.status === CampaignStatus.DRAFT) && onStart && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onStart(campaign.id); }}
                            title="Iniciar agora"
                            disabled={isStarting}
                            className="p-2 rounded-lg text-gray-400 hover:text-primary-400 hover:bg-primary-500/10 disabled:opacity-50"
                          >
                            <Play size={16} />
                          </button>
                        )}

                        {/* Quick action: Pause sending campaign */}
                        {campaign.status === CampaignStatus.SENDING && onPause && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onPause(campaign.id); }}
                            title="Pausar"
                            disabled={isPausing}
                            className="p-2 rounded-lg text-gray-400 hover:text-amber-400 hover:bg-amber-500/10 disabled:opacity-50"
                          >
                            <Pause size={16} />
                          </button>
                        )}

                        {/* Quick action: Resume paused campaign */}
                        {campaign.status === CampaignStatus.PAUSED && onResume && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onResume(campaign.id); }}
                            title="Retomar"
                            disabled={isResuming}
                            className="p-2 rounded-lg text-gray-400 hover:text-primary-400 hover:bg-primary-500/10 disabled:opacity-50"
                          >
                            <Play size={16} />
                          </button>
                        )}


                        <button
                          onClick={(e) => { e.stopPropagation(); onDelete(campaign.id); }}
                          title="Excluir"
                          disabled={deletingId === campaign.id}
                          className="p-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {deletingId === campaign.id ? (
                            <Loader2 size={16} className="animate-spin text-red-400" />
                          ) : (
                            <Trash2 size={16} />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Page>
  );
};
