import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from '@/lib/navigation';
import { toast } from 'sonner';
import { campaignService } from '../services';
import { useCampaignRealtime } from './useCampaignRealtime';
import { CampaignStatus, MessageStatus, Message } from '../types';

// Polling interval as backup while Realtime is connected (60 seconds)
const BACKUP_POLLING_INTERVAL = 60 * 1000;
// Fallback polling when Realtime is not connected (keeps stats fresh without F5)
const DISCONNECTED_POLLING_INTERVAL = 10 * 1000;

export const useCampaignDetailsController = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<MessageStatus | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isResendingSkipped, setIsResendingSkipped] = useState(false);

  // Fetch campaign data
  const campaignQuery = useQuery({
    queryKey: ['campaign', id],
    queryFn: () => campaignService.getById(id!),
    enabled: !!id && !id.startsWith('temp_'),
    staleTime: 5000,
  });

  const campaign = campaignQuery.data;

  // Real-time updates via Supabase Realtime with smart debounce
  const { isConnected: isRealtimeConnected, shouldShowRefreshButton } = useCampaignRealtime({
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

  // Poll if: (connected as backup) OR (disconnected fallback) OR (large campaign needs polling as primary)
  const shouldPoll = isActiveCampaign && (isRealtimeConnected || !isRealtimeConnected || isLargeCampaign);

  const pollingInterval = useMemo(() => {
    if (!shouldPoll) return false as const;
    if (isLargeCampaign) return BACKUP_POLLING_INTERVAL;
    return isRealtimeConnected ? BACKUP_POLLING_INTERVAL : DISCONNECTED_POLLING_INTERVAL;
  }, [shouldPoll, isLargeCampaign, isRealtimeConnected]);

  // Fetch messages with optional polling
  const messagesQuery = useQuery({
    queryKey: ['campaignMessages', id, filterStatus],
    queryFn: () => campaignService.getMessages(id!, { status: filterStatus || undefined }),
    enabled: !!id,
    staleTime: 5000,
    // Backup polling only while connected and active
    refetchInterval: pollingInterval,
  });

  // Add polling to campaign query too
  const campaignWithPolling = useQuery({
    queryKey: ['campaign', id],
    queryFn: () => campaignService.getById(id!),
    enabled: !!id && !id.startsWith('temp_'),
    staleTime: 5000,
    refetchInterval: pollingInterval,
  });

  // Use the campaign data (prefer the polling-enabled query)
  const activeCampaign = campaignWithPolling.data || campaign;

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

  // Can perform actions?
  const canPause = activeCampaign?.status === CampaignStatus.SENDING;
  const canResume = activeCampaign?.status === CampaignStatus.PAUSED;
  const canStart = activeCampaign?.status === CampaignStatus.SCHEDULED || activeCampaign?.status === CampaignStatus.DRAFT;

  return {
    campaign: activeCampaign,
    messages: filteredMessages,
    isLoading: campaignQuery.isLoading || messagesQuery.isLoading,
    searchTerm,
    setSearchTerm,
    navigate,
    realStats,
    messageStats,
    // Realtime status
    isRealtimeConnected,
    shouldShowRefreshButton,
    isRefreshing,
    refetch,
    // Actions
    onPause: handlePause,
    onResume: handleResume,
    onStart: handleStart,
    isPausing: pauseMutation.isPending,
    isResuming: resumeMutation.isPending,
    isStarting: startMutation.isPending,
    canPause,
    canResume,
    canStart,
    onResendSkipped: handleResendSkipped,
    isResendingSkipped,
    filterStatus,
    setFilterStatus,
  };
};
