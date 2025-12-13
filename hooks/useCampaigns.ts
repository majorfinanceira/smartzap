import { useState, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { campaignService } from '../services';
import { Campaign } from '../types';
import { useRealtimeQuery } from './useRealtimeQuery';

// --- Data Hook (React Query + Realtime) ---
export const useCampaignsQuery = (initialData?: Campaign[]) => {
  return useRealtimeQuery({
    queryKey: ['campaigns'],
    queryFn: campaignService.getAll,
    initialData: initialData,
    staleTime: 15 * 1000,  // 15 segundos
    // Realtime configuration
    table: 'campaigns',
    events: ['INSERT', 'UPDATE', 'DELETE'],
    debounceMs: 200,
  });
};

// --- Mutations ---
export const useCampaignMutations = () => {
  const queryClient = useQueryClient();

  // Track which IDs are currently being processed
  const [processingDeleteId, setProcessingDeleteId] = useState<string | undefined>(undefined);
  const [processingDuplicateId, setProcessingDuplicateId] = useState<string | undefined>(undefined);

  const deleteMutation = useMutation({
    mutationFn: campaignService.delete,
    // Optimistic update: remove immediately from UI
    onMutate: async (id: string) => {
      setProcessingDeleteId(id);
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['campaigns'] });

      // Get the current data
      const previousData = queryClient.getQueryData<Campaign[]>(['campaigns']);

      // Optimistically remove from cache
      queryClient.setQueryData<Campaign[]>(['campaigns'], (old) =>
        old?.filter(c => c.id !== id) ?? []
      );

      // Also remove from dashboard recent campaigns
      queryClient.setQueryData<Campaign[]>(['recentCampaigns'], (old) =>
        old?.filter(c => c.id !== id) ?? []
      );

      return { previousData };
    },
    onError: (_err, _id, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(['campaigns'], context.previousData);
      }
    },
    onSuccess: () => {
      // Server-side cache was invalidated via revalidateTag
      // Force refetch to get fresh data from invalidated cache
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['recentCampaigns'] });
    },
    onSettled: () => {
      setProcessingDeleteId(undefined);
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: campaignService.duplicate,
    onMutate: async (id: string) => {
      setProcessingDuplicateId(id);
      // Evita refetch simultâneo durante a duplicação
      await queryClient.cancelQueries({ queryKey: ['campaigns'] });
      return { id };
    },
    onSuccess: () => {
      // Server-side cache foi invalidado via revalidateTag (quando aplicável)
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['recentCampaigns'] });
    },
    onSettled: () => {
      setProcessingDuplicateId(undefined);
    },
  });

  return {
    deleteCampaign: deleteMutation.mutate,
    isDeleting: deleteMutation.isPending,
    deletingId: processingDeleteId,

    duplicateCampaign: duplicateMutation.mutate,
    isDuplicating: duplicateMutation.isPending,
    duplicatingId: processingDuplicateId,
  };
};

// --- Controller Hook (Smart) ---
export const useCampaignsController = (initialData?: Campaign[]) => {
  const { data: campaigns = [], isLoading, error, refetch } = useCampaignsQuery(initialData);
  const { deleteCampaign, duplicateCampaign, isDeleting, deletingId, isDuplicating, duplicatingId } = useCampaignMutations();

  // UI State
  const [filter, setFilter] = useState<string>('All');
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Business Logic: Filtering
  const filteredCampaigns = useMemo(() => {
    if (!campaigns) return [];

    return campaigns.filter(c => {
      const matchesFilter = filter === 'All' || c.status === filter;
      const matchesSearch = (c.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (c.templateName || '').toLowerCase().includes(searchTerm.toLowerCase());
      return matchesFilter && matchesSearch;
    });
  }, [campaigns, filter, searchTerm]);

  // Handlers
  const handleDelete = (id: string) => {
    // Deletar diretamente sem confirmação (pode ser desfeito clonando)
    deleteCampaign(id);
  };

  const handleRefresh = () => {
    refetch();
  };

  const handleDuplicate = (id: string) => {
    duplicateCampaign(id);
  };

  return {
    // Data
    campaigns: filteredCampaigns,
    isLoading,
    error,

    // State
    filter,
    searchTerm,

    // Setters
    setFilter,
    setSearchTerm,

    // Actions
    onDelete: handleDelete,
    onDuplicate: handleDuplicate,
    onRefresh: handleRefresh,

    // Loading states for specific items
    isDeleting,
    deletingId,
    isDuplicating,
    duplicatingId,
  };
};
