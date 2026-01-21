/**
 * T028: useConversations - List conversations with filters
 * Provides conversation list with filtering, search, and real-time updates
 */

import { useMemo, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRealtimeQuery } from './useRealtimeQuery'
import {
  inboxService,
  type ConversationListParams,
  type ConversationListResult,
} from '@/services/inboxService'
import type { InboxConversation, ConversationStatus, ConversationMode } from '@/types'
import { CACHE, REALTIME } from '@/lib/constants'

const CONVERSATIONS_KEY = 'inbox-conversations'
const CONVERSATIONS_LIST_KEY = [CONVERSATIONS_KEY, 'list']

// Query key builder
export const getConversationsQueryKey = (params: ConversationListParams) => [
  ...CONVERSATIONS_LIST_KEY,
  params,
]

// =============================================================================
// Main Hook
// =============================================================================

export interface UseConversationsParams {
  page?: number
  limit?: number
  status?: ConversationStatus
  mode?: ConversationMode
  labelId?: string
  search?: string
  initialData?: InboxConversation[]
}

export function useConversations(params: UseConversationsParams = {}) {
  const queryClient = useQueryClient()
  const { page = 1, limit = 20, status, mode, labelId, search, initialData } = params

  const queryParams: ConversationListParams = useMemo(
    () => ({ page, limit, status, mode, labelId, search }),
    [page, limit, status, mode, labelId, search]
  )

  const queryKey = getConversationsQueryKey(queryParams)

  // Se temos initialData e estamos na página 1 sem filtros, usamos como dados iniciais
  const isFirstPageNoFilters = page === 1 && !status && !mode && !labelId && !search
  const queryInitialData = isFirstPageNoFilters && initialData
    ? {
        conversations: initialData,
        total: initialData.length,
        page: 1,
        limit,
        totalPages: 1
      }
    : undefined

  // Query with real-time subscription
  const query = useRealtimeQuery<ConversationListResult>({
    queryKey,
    queryFn: () => inboxService.listConversations(queryParams),
    initialData: queryInitialData,
    staleTime: CACHE.campaigns, // Reuse campaign cache timing
    refetchOnWindowFocus: false,
    // Real-time configuration
    table: 'inbox_conversations',
    events: ['INSERT', 'UPDATE', 'DELETE'],
    debounceMs: REALTIME.debounceDefault,
  })

  // Computed values
  const conversations = query.data?.conversations ?? []
  const total = query.data?.total ?? 0
  const totalPages = query.data?.totalPages ?? 1
  const hasNextPage = page < totalPages
  const hasPreviousPage = page > 1

  // Total unread count across all conversations
  const totalUnread = useMemo(
    () => conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0),
    [conversations]
  )

  // Invalidation helper
  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: CONVERSATIONS_LIST_KEY })
  }, [queryClient])

  return {
    // Data
    conversations,
    total,
    totalPages,
    totalUnread,

    // Pagination
    page,
    hasNextPage,
    hasPreviousPage,

    // Query state
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    error: query.error,

    // Actions
    invalidate,
    refetch: query.refetch,
  }
}

// =============================================================================
// Mutations Hook
// =============================================================================

export function useConversationMutations() {
  const queryClient = useQueryClient()

  // Update conversation
  const updateMutation = useMutation({
    mutationFn: ({ id, ...params }: { id: string } & Parameters<typeof inboxService.updateConversation>[1]) =>
      inboxService.updateConversation(id, params),
    onSuccess: (updated) => {
      // Update in list cache
      queryClient.setQueriesData<ConversationListResult>(
        { queryKey: CONVERSATIONS_LIST_KEY },
        (old) => {
          if (!old) return old
          return {
            ...old,
            conversations: old.conversations.map((c) =>
              c.id === updated.id ? { ...c, ...updated } : c
            ),
          }
        }
      )
      // Update single conversation cache
      queryClient.setQueryData([CONVERSATIONS_KEY, updated.id], updated)
    },
  })

  // Mark as read
  const markAsReadMutation = useMutation({
    mutationFn: inboxService.markAsRead,
    onMutate: async (conversationId) => {
      await queryClient.cancelQueries({ queryKey: CONVERSATIONS_LIST_KEY })

      // Optimistic update
      queryClient.setQueriesData<ConversationListResult>(
        { queryKey: CONVERSATIONS_LIST_KEY },
        (old) => {
          if (!old) return old
          return {
            ...old,
            conversations: old.conversations.map((c) =>
              c.id === conversationId ? { ...c, unread_count: 0 } : c
            ),
          }
        }
      )
    },
  })

  // Close conversation
  const closeMutation = useMutation({
    mutationFn: (id: string) => inboxService.updateConversation(id, { status: 'closed' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONVERSATIONS_LIST_KEY })
    },
  })

  // Reopen conversation
  const reopenMutation = useMutation({
    mutationFn: (id: string) => inboxService.updateConversation(id, { status: 'open' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONVERSATIONS_LIST_KEY })
    },
  })

  // Switch mode
  const switchModeMutation = useMutation({
    mutationFn: ({ id, mode }: { id: string; mode: ConversationMode }) =>
      inboxService.updateConversation(id, { mode }),
    onMutate: async ({ id, mode }) => {
      await queryClient.cancelQueries({ queryKey: CONVERSATIONS_LIST_KEY })

      // Optimistic update
      queryClient.setQueriesData<ConversationListResult>(
        { queryKey: CONVERSATIONS_LIST_KEY },
        (old) => {
          if (!old) return old
          return {
            ...old,
            conversations: old.conversations.map((c) =>
              c.id === id ? { ...c, mode } : c
            ),
          }
        }
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONVERSATIONS_LIST_KEY })
    },
  })

  // T050: Handoff to human
  const handoffMutation = useMutation({
    mutationFn: ({ id, ...params }: { id: string; reason?: string; summary?: string; pauseMinutes?: number }) =>
      inboxService.handoffToHuman(id, params),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: CONVERSATIONS_LIST_KEY })

      // Optimistic update - switch to human mode
      queryClient.setQueriesData<ConversationListResult>(
        { queryKey: CONVERSATIONS_LIST_KEY },
        (old) => {
          if (!old) return old
          return {
            ...old,
            conversations: old.conversations.map((c) =>
              c.id === id ? { ...c, mode: 'human' as ConversationMode } : c
            ),
          }
        }
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONVERSATIONS_LIST_KEY })
    },
  })

  // T050: Return to bot
  const returnToBotMutation = useMutation({
    mutationFn: (id: string) => inboxService.returnToBot(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: CONVERSATIONS_LIST_KEY })

      // Optimistic update - switch to bot mode
      queryClient.setQueriesData<ConversationListResult>(
        { queryKey: CONVERSATIONS_LIST_KEY },
        (old) => {
          if (!old) return old
          return {
            ...old,
            conversations: old.conversations.map((c) =>
              c.id === id ? { ...c, mode: 'bot' as ConversationMode } : c
            ),
          }
        }
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONVERSATIONS_LIST_KEY })
    },
  })

  // Delete conversation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => inboxService.deleteConversation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONVERSATIONS_LIST_KEY })
    },
  })

  return {
    update: updateMutation.mutateAsync,
    markAsRead: markAsReadMutation.mutateAsync,
    close: closeMutation.mutateAsync,
    reopen: reopenMutation.mutateAsync,
    switchMode: switchModeMutation.mutateAsync,
    handoff: handoffMutation.mutateAsync,
    returnToBot: returnToBotMutation.mutateAsync,
    deleteConversation: deleteMutation.mutateAsync,

    isUpdating: updateMutation.isPending,
    isMarkingAsRead: markAsReadMutation.isPending,
    isClosing: closeMutation.isPending,
    isReopening: reopenMutation.isPending,
    isSwitchingMode: switchModeMutation.isPending,
    isHandingOff: handoffMutation.isPending,
    isReturningToBot: returnToBotMutation.isPending,
    isDeleting: deleteMutation.isPending,
  }
}
