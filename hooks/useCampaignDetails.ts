import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from '@/lib/navigation';
import { toast } from 'sonner';
import { campaignService } from '../services';
import { useCampaignRealtime } from './useCampaignRealtime';
import { Campaign, CampaignStatus, MessageStatus, Message } from '../types';

// Polling interval as backup while Realtime is connected (60 seconds)
const BACKUP_POLLING_INTERVAL = 60 * 1000;
// Fallback polling when Realtime is not connected (keeps stats fresh without F5)
const DISCONNECTED_POLLING_INTERVAL = 10 * 1000;

function mergeCampaignCountersMonotonic(oldCampaign: Campaign | undefined, fresh: Campaign | undefined): Campaign | undefined {
  if (!fresh) return oldCampaign;
  if (!oldCampaign) return fresh;

  // Aceita reset explícito (ex.: voltar para DRAFT) para não travar valores antigos.
  const looksLikeReset = (
    fresh.status === CampaignStatus.DRAFT &&
    !fresh.startedAt &&
    Number(fresh.sent || 0) === 0 &&
    Number(fresh.failed || 0) === 0 &&
    Number(fresh.skipped || 0) === 0
  );

  if (looksLikeReset) return fresh;

  const merged: Campaign = { ...fresh };
  merged.sent = Math.max(Number(oldCampaign.sent || 0), Number(fresh.sent || 0));
  merged.failed = Math.max(Number(oldCampaign.failed || 0), Number(fresh.failed || 0));
  merged.skipped = Math.max(Number(oldCampaign.skipped || 0), Number(fresh.skipped || 0));
  merged.delivered = Math.max(Number(oldCampaign.delivered || 0), Number(fresh.delivered || 0));
  merged.read = Math.max(Number(oldCampaign.read || 0), Number(fresh.read || 0));
  merged.recipients = Math.max(Number(oldCampaign.recipients || 0), Number(fresh.recipients || 0));
  return merged;
}

function mergeMessageStatsMonotonic(
  oldData: any,
  freshData: any
): any {
  if (!freshData || typeof freshData !== 'object') return oldData;
  if (!oldData || typeof oldData !== 'object') return freshData;
  if (!freshData.stats || !oldData.stats) return freshData;

  const oldStats = oldData.stats
  const freshStats = freshData.stats

  const sent = Math.max(Number(oldStats.sent || 0), Number(freshStats.sent || 0));
  const failed = Math.max(Number(oldStats.failed || 0), Number(freshStats.failed || 0));
  const skipped = Math.max(Number(oldStats.skipped || 0), Number(freshStats.skipped || 0));
  const delivered = Math.max(Number(oldStats.delivered || 0), Number(freshStats.delivered || 0));
  const read = Math.max(Number(oldStats.read || 0), Number(freshStats.read || 0));

  const total = Math.max(Number(oldStats.total || 0), Number(freshStats.total || 0));
  const pending = Math.max(0, total - (sent + failed + skipped));

  return {
    ...freshData,
    stats: {
      ...freshStats,
      total,
      pending,
      sent,
      delivered,
      read,
      skipped,
      failed,
    },
  };
}

export const useCampaignDetailsController = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<MessageStatus | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isResendingSkipped, setIsResendingSkipped] = useState(false);
  const [isCancelingSchedule, setIsCancelingSchedule] = useState(false);

  // Fetch campaign data (com polling opcional calculado abaixo)
  const campaignQuery = useQuery({
    queryKey: ['campaign', id],
    queryFn: () => campaignService.getById(id!),
    enabled: !!id && !id.startsWith('temp_'),
    staleTime: 5000,
    refetchInterval: pollingInterval,
    onSuccess: (fresh) => {
      // Merge monotônico para evitar regressão visual quando a UI aplicou deltas via Broadcast,
      // mas o DB ainda não foi atualizado (bulk upsert no fim do batch).
      queryClient.setQueryData(['campaign', id], (old: any) =>
        mergeCampaignCountersMonotonic(old as Campaign | undefined, fresh as Campaign | undefined)
      );
    },
  });

  const campaign = campaignQuery.data;

  // Real-time updates via Supabase Realtime with smart debounce
  const { isConnected: isRealtimeConnected, shouldShowRefreshButton, telemetry } = useCampaignRealtime({
    campaignId: id,
    status: campaign?.status,
    recipients: campaign?.recipients || 0,
    completedAt: campaign?.completedAt ?? undefined,
  });

  // Polling logic:
  // - Connected via Realtime: 60s backup polling
  // - Disconnected (Realtime caiu): 10s fallback polling
  // - Large campaigns (>= 10k): polling only
  const isActiveCampaign = campaign?.status === CampaignStatus.SENDING ||
    campaign?.status === CampaignStatus.SCHEDULED ||
    campaign?.status === CampaignStatus.COMPLETED;

  const isLargeCampaign = (campaign?.recipients || 0) >= 10000;

  const pollingInterval = useMemo(() => {
    if (!isActiveCampaign) return false as const;
    if (isLargeCampaign) return BACKUP_POLLING_INTERVAL;
    return isRealtimeConnected ? BACKUP_POLLING_INTERVAL : DISCONNECTED_POLLING_INTERVAL;
  }, [isActiveCampaign, isLargeCampaign, isRealtimeConnected]);

  const metricsQuery = useQuery({
    queryKey: ['campaignMetrics', id],
    queryFn: () => campaignService.getMetrics(id!),
    enabled: !!id,
    staleTime: 5000,
    refetchInterval: pollingInterval,
  })

  // Fetch messages with optional polling
  const messagesQuery = useQuery({
    queryKey: ['campaignMessages', id, filterStatus],
    queryFn: () => campaignService.getMessages(id!, { status: filterStatus || undefined }),
    enabled: !!id,
    staleTime: 5000,
    // Backup polling only while connected and active
    refetchInterval: pollingInterval,
    onSuccess: (fresh) => {
      // Atualiza stats de forma monotônica para evitar "pular pra trás".
      queryClient.setQueriesData({ queryKey: ['campaignMessages', id] }, (old: any) =>
        mergeMessageStatsMonotonic(old, fresh)
      );
    },
  });

  const activeCampaign = campaignQuery.data;

  // Extract messages from paginated response
  const messages: Message[] = useMemo(() => {
    const data = messagesQuery.data;
    if (!data) return [];
    return data.messages || [];
  }, [messagesQuery.data]);

  const messageStats = useMemo(() => {
    const data = messagesQuery.data;
    return data?.stats || null;
  }, [messagesQuery.data]);

  // Manual refresh function
  const refetch = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        campaignQuery.refetch(),
        messagesQuery.refetch(),
      ]);
      toast.success('Dados atualizados');
    } catch {
      toast.error('Erro ao atualizar dados');
    } finally {
      setIsRefreshing(false);
    }
  };

  // Pause mutation
  const pauseMutation = useMutation({
    mutationFn: () => campaignService.pause(id!),
    onSuccess: () => {
      toast.success('Campanha pausada com sucesso');
      queryClient.invalidateQueries({ queryKey: ['campaign', id] });
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
    onError: () => {
      toast.error('Erro ao pausar campanha');
    }
  });

  // Resume mutation
  const resumeMutation = useMutation({
    mutationFn: () => campaignService.resume(id!),
    onSuccess: () => {
      toast.success('Campanha retomada com sucesso');
      queryClient.invalidateQueries({ queryKey: ['campaign', id] });
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
    onError: () => {
      toast.error('Erro ao retomar campanha');
    }
  });

  // Start mutation (for scheduled campaigns)
  const startMutation = useMutation({
    mutationFn: () => campaignService.start(id!),
    onSuccess: () => {
      toast.success('Campanha iniciada com sucesso');
      queryClient.invalidateQueries({ queryKey: ['campaign', id] });
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
    onError: () => {
      toast.error('Erro ao iniciar campanha');
    }
  });

  const cancelScheduleMutation = useMutation({
    mutationFn: () => campaignService.cancelSchedule(id!),
    onSuccess: (result) => {
      if (result.ok) {
        toast.success('Agendamento cancelado. A campanha voltou para Rascunho.');
        queryClient.invalidateQueries({ queryKey: ['campaign', id] });
        queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      } else {
        toast.error(result.error || 'Falha ao cancelar agendamento');
      }
    },
    onError: () => {
      toast.error('Falha ao cancelar agendamento');
    }
  })

  const resendSkippedMutation = useMutation({
    mutationFn: () => campaignService.resendSkipped(id!),
    onSuccess: async (result) => {
      toast.success(result.message || 'Ignorados reenfileirados')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['campaign', id] }),
        queryClient.invalidateQueries({ queryKey: ['campaignMessages', id] }),
        queryClient.invalidateQueries({ queryKey: ['campaigns'] }),
      ])
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Erro ao reenviar ignorados')
    }
  })

  const filteredMessages = useMemo(() => {
    if (!messages) return [];
    return messages.filter(m =>
      m.contactName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.contactPhone.includes(searchTerm)
    );
  }, [messages, searchTerm]);

  // Calculate real stats from messages (fallback if campaign stats not available)
  const realStats = useMemo(() => {
    if (!messages || messages.length === 0) return null;
    const sent = messages.filter(m => m.status === MessageStatus.SENT || m.status === MessageStatus.DELIVERED || m.status === MessageStatus.READ).length;
    const failed = messages.filter(m => m.status === MessageStatus.FAILED).length;
    const skipped = messages.filter(m => m.status === MessageStatus.SKIPPED).length;
    const delivered = messages.filter(m => m.status === MessageStatus.DELIVERED || m.status === MessageStatus.READ).length;
    const read = messages.filter(m => m.status === MessageStatus.READ).length;
    return { sent, failed, skipped, delivered, read, total: messages.length };
  }, [messages]);

  // Actions
  const handlePause = () => {
    if (activeCampaign?.status === CampaignStatus.SENDING) {
      pauseMutation.mutate();
    }
  };

  const handleResume = () => {
    if (activeCampaign?.status === CampaignStatus.PAUSED) {
      resumeMutation.mutate();
    }
  };

  const handleStart = () => {
    if (activeCampaign?.status === CampaignStatus.SCHEDULED || activeCampaign?.status === CampaignStatus.DRAFT) {
      startMutation.mutate();
    }
  };

  const handleResendSkipped = async () => {
    if (!id) return
    setIsResendingSkipped(true)
    try {
      await resendSkippedMutation.mutateAsync()
    } finally {
      setIsResendingSkipped(false)
    }
  }

  const handleCancelSchedule = async () => {
    if (!id) return
    setIsCancelingSchedule(true)
    try {
      await cancelScheduleMutation.mutateAsync()
    } finally {
      setIsCancelingSchedule(false)
    }
  }

  // Can perform actions?
  const canPause = activeCampaign?.status === CampaignStatus.SENDING;
  const canResume = activeCampaign?.status === CampaignStatus.PAUSED;
  const canStart = activeCampaign?.status === CampaignStatus.SCHEDULED || activeCampaign?.status === CampaignStatus.DRAFT;
  const canCancelSchedule = activeCampaign?.status === CampaignStatus.SCHEDULED;

  return {
    campaign: activeCampaign,
    messages: filteredMessages,
    isLoading: campaignQuery.isLoading || messagesQuery.isLoading,
    metrics: metricsQuery.data,
    searchTerm,
    setSearchTerm,
    navigate,
    realStats,
    messageStats,
    // Realtime status
    isRealtimeConnected,
    shouldShowRefreshButton,
    telemetry,
    isRefreshing,
    refetch,
    // Actions
    onPause: handlePause,
    onResume: handleResume,
    onStart: handleStart,
    onCancelSchedule: handleCancelSchedule,
    isCancelingSchedule,
    isPausing: pauseMutation.isPending,
    isResuming: resumeMutation.isPending,
    isStarting: startMutation.isPending,
    canCancelSchedule,
    canPause,
    canResume,
    canStart,
    onResendSkipped: handleResendSkipped,
    isResendingSkipped,
    filterStatus,
    setFilterStatus,
  };
};
