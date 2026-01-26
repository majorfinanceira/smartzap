'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'

const LOCAL_STORAGE_KEY = 'smartzap_onboarding_completed'

interface OnboardingStatus {
    onboardingCompleted: boolean
    permanentTokenConfirmed: boolean
}

/**
 * Hook para gerenciar o status do onboarding com fallback em localStorage.
 * 
 * IMPORTANTE: O modal de boas-vindas só deve aparecer se:
 * 1. O banco de dados CONFIRMA que onboarding NÃO foi completado
 * 2. E o localStorage NÃO tem o flag de completo
 * 
 * Isso evita que o modal apareça indevidamente quando:
 * - A API falha temporariamente
 * - Há problemas de rede
 * - O servidor está lento
 */
export function useOnboardingStatus() {
    const queryClient = useQueryClient()
    
    // Estado local do fallback
    const [localCompleted, setLocalCompleted] = useState<boolean | null>(null)
    
    // Carrega do localStorage na montagem
    useEffect(() => {
        const stored = localStorage.getItem(LOCAL_STORAGE_KEY)
        setLocalCompleted(stored === 'true')
    }, [])
    
    // Query para buscar do banco
    const { 
        data: dbStatus, 
        isLoading, 
        isError,
        refetch,
    } = useQuery({
        queryKey: ['onboardingStatus'],
        queryFn: async (): Promise<OnboardingStatus> => {
            const response = await fetch('/api/settings/onboarding')
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`)
            }
            const data = await response.json()
            
            // Se banco diz que está completo, salva no localStorage como backup
            if (data.onboardingCompleted === true) {
                localStorage.setItem(LOCAL_STORAGE_KEY, 'true')
            }
            
            return data
        },
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
        retry: 2,
        retryDelay: 1000,
    })
    
    // Sincroniza localStorage quando DB confirma completo
    useEffect(() => {
        if (dbStatus?.onboardingCompleted === true && localCompleted !== true) {
            localStorage.setItem(LOCAL_STORAGE_KEY, 'true')
            setLocalCompleted(true)
        }
    }, [dbStatus?.onboardingCompleted, localCompleted])
    
    // Marca como completo no banco E localStorage
    const markComplete = useCallback(async () => {
        // Marca local imediatamente (otimistic update)
        localStorage.setItem(LOCAL_STORAGE_KEY, 'true')
        setLocalCompleted(true)
        
        // Atualiza no servidor
        try {
            await fetch('/api/settings/onboarding', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ onboardingCompleted: true }),
            })
            refetch()
        } catch (error) {
            console.error('Erro ao salvar onboarding no banco:', error)
            // Não reverte o localStorage - melhor ter completo local que mostrar modal
        }
        
        // Invalida queries relacionadas
        queryClient.invalidateQueries({ queryKey: ['healthStatus'] })
    }, [refetch, queryClient])
    
    // O onboarding está completo se:
    // 1. O banco de dados CONFIRMA que está completo (fonte da verdade quando disponível)
    // 2. OU o localStorage diz que está completo (fallback para erros de rede)
    // 3. OU houve erro na API (assume completo para não incomodar)
    const isCompleted = 
        dbStatus?.onboardingCompleted === true || 
        localCompleted === true ||
        isError
    
    // Está carregando apenas se não tiver fallback local
    const isLoadingStatus = isLoading && localCompleted === null
    
    return {
        /** Se o onboarding foi completado (DB || localStorage || erro) */
        isCompleted,
        /** Se ainda está carregando o status inicial */
        isLoading: isLoadingStatus,
        /** Se houve erro ao buscar do banco */
        isError,
        /** Se o token permanente foi confirmado */
        isPermanentTokenConfirmed: dbStatus?.permanentTokenConfirmed ?? false,
        /** Dados brutos do banco */
        dbStatus,
        /** Marca o onboarding como completo */
        markComplete,
        /** Refaz a query */
        refetch,
    }
}
