'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { InstallLayout, StepCard, ServiceIcon } from '@/components/install';
import { CheckCircle, Loader2, AlertCircle, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Storage keys (must match /install/start/page.tsx)
const STORAGE_KEYS = {
  USER_NAME: 'smartzap_install_name',
  USER_EMAIL: 'smartzap_install_email',
  USER_PASS_HASH: 'smartzap_install_pass_hash',
  USER_PASS_PLAIN: 'smartzap_install_pass',
  VERCEL_TOKEN: 'smartzap_install_vercel_token',
  VERCEL_PROJECT: 'smartzap_install_vercel_project',
  SUPABASE_PAT: 'smartzap_install_supabase_pat',
  SUPABASE_URL: 'smartzap_install_supabase_url',
  SUPABASE_REF: 'smartzap_install_supabase_ref',
  SUPABASE_PUBLISHABLE_KEY: 'smartzap_install_supabase_publishable_key',
  SUPABASE_SECRET_KEY: 'smartzap_install_supabase_secret_key',
  SUPABASE_DB_PASS: 'smartzap_install_supabase_db_pass',
  QSTASH_TOKEN: 'smartzap_install_qstash_token',
  REDIS_REST_URL: 'smartzap_install_redis_url',
  REDIS_REST_TOKEN: 'smartzap_install_redis_token',
} as const;

type WizardPhase =
  | 'loading'
  | 'confirm'
  | 'provisioning'
  | 'success'
  | 'error';

interface CollectedData {
  name: string;
  email: string;
  passwordHash: string;
  vercelToken: string;
  vercelProject: { id: string; name: string; teamId?: string } | null;
  supabasePat: string;
  supabaseUrl: string;
  supabaseRef: string;
  supabaseDbPass: string;
  qstashToken: string;
  redisRestUrl: string;
  redisRestToken: string;
}

interface StreamEvent {
  type: 'phase' | 'progress' | 'error' | 'complete' | 'skip' | 'retry';
  phase?: string;
  title?: string;
  subtitle?: string;
  progress?: number;
  error?: string;
  ok?: boolean;
  skipped?: string[];
  stepId?: string;
  retryCount?: number;
  maxRetries?: number;
}

/**
 * Wizard page - Automatic provisioning with real-time progress.
 *
 * This page will:
 * 1. Resolve Supabase keys (anon, service_role)
 * 2. Configure Vercel env vars (including QStash/Redis)
 * 3. Wait for Supabase project
 * 4. Run migrations
 * 5. Bootstrap instance
 * 6. Trigger redeploy
 */
export default function InstallWizardPage() {
  const router = useRouter();

  const [phase, setPhase] = useState<WizardPhase>('loading');
  const [data, setData] = useState<CollectedData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Provisioning state
  const [provisioningTitle, setProvisioningTitle] = useState('Preparando decolagem...');
  const [provisioningSubtitle, setProvisioningSubtitle] = useState('');
  const [provisioningProgress, setProvisioningProgress] = useState(0);
  const [retryInfo, setRetryInfo] = useState<{ stepId: string; count: number; max: number } | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  // First name for personalization (usa o nome real, não extrai do email)
  const firstName = useMemo(() => {
    if (!data?.name) return 'você';
    // Pega apenas o primeiro nome
    return data.name.split(' ')[0] || 'você';
  }, [data?.name]);

  // Hydration: check if all data is present
  useEffect(() => {
    const vercelToken = localStorage.getItem(STORAGE_KEYS.VERCEL_TOKEN);
    const vercelProject = localStorage.getItem(STORAGE_KEYS.VERCEL_PROJECT);
    const supabasePat = localStorage.getItem(STORAGE_KEYS.SUPABASE_PAT);
    const supabaseUrl = localStorage.getItem(STORAGE_KEYS.SUPABASE_URL);
    const supabaseRef = localStorage.getItem(STORAGE_KEYS.SUPABASE_REF);
    const supabaseDbPass = localStorage.getItem(STORAGE_KEYS.SUPABASE_DB_PASS);
    const qstashToken = localStorage.getItem(STORAGE_KEYS.QSTASH_TOKEN);
    const redisUrl = localStorage.getItem(STORAGE_KEYS.REDIS_REST_URL);
    const redisToken = localStorage.getItem(STORAGE_KEYS.REDIS_REST_TOKEN);
    const name = localStorage.getItem(STORAGE_KEYS.USER_NAME);
    const email = localStorage.getItem(STORAGE_KEYS.USER_EMAIL);
    const passwordHash = localStorage.getItem(STORAGE_KEYS.USER_PASS_HASH);

    // Missing data → go back to start
    // Note: supabaseDbPass is critical - we need it to connect as postgres user
    if (
      !vercelToken ||
      !vercelProject ||
      !supabasePat ||
      !supabaseDbPass ||
      !qstashToken ||
      !redisUrl ||
      !redisToken ||
      !name ||
      !email ||
      !passwordHash
    ) {
      router.replace('/install/start');
      return;
    }

    // Supabase URL: se não tiver, gerar baseado no ref
    let resolvedSupabaseUrl = supabaseUrl || '';
    if (!resolvedSupabaseUrl && supabaseRef) {
      resolvedSupabaseUrl = `https://${supabaseRef}.supabase.co`;
    }

    setData({
      name: name || '',
      email: email || 'admin@smartzap.local',
      passwordHash: passwordHash || '',
      vercelToken,
      vercelProject: vercelProject ? JSON.parse(vercelProject) : null,
      supabasePat,
      supabaseUrl: resolvedSupabaseUrl,
      supabaseRef: supabaseRef || '',
      supabaseDbPass: supabaseDbPass || '',
      qstashToken,
      redisRestUrl: redisUrl,
      redisRestToken: redisToken,
    });

    setPhase('confirm');
  }, [router]);

  // Handle SSE stream
  const handleStream = useCallback(async (response: Response) => {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Stream não disponível');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          let event: StreamEvent;
          try {
            event = JSON.parse(line.slice(6));
          } catch (parseErr) {
            console.error('[wizard] Erro ao parsear evento:', parseErr);
            continue;
          }

          // Processar evento parseado
          if (event.type === 'phase') {
            if (event.title) setProvisioningTitle(event.title);
            if (event.subtitle) setProvisioningSubtitle(event.subtitle);
            if (typeof event.progress === 'number') setProvisioningProgress(event.progress);
            setRetryInfo(null);
          } else if (event.type === 'retry') {
            setRetryInfo({
              stepId: event.stepId || '',
              count: event.retryCount || 0,
              max: event.maxRetries || 3,
            });
          } else if (event.type === 'error') {
            // Re-lança para ser capturado pelo handler externo
            throw new Error(event.error || 'Erro desconhecido');
          } else if (event.type === 'complete' && event.ok) {
            setProvisioningProgress(100);
            setPhase('success');
            // NÃO limpar tokens aqui - será feito no clique do botão "Entrar na Matrix"
            // Isso evita race condition se a página recarregar antes de mostrar o success
          }
        }
      }
    }
  }, []);

  const handleStartProvisioning = useCallback(async () => {
    if (!data) return;

    setPhase('provisioning');
    setError(null);
    setProvisioningTitle(`Wake up, ${firstName}...`);
    setProvisioningSubtitle('A Matrix tem você...');
    setProvisioningProgress(0);

    abortControllerRef.current = new AbortController();

    try {
      // Precisamos da URL do Supabase - se não tivermos, erro
      if (!data.supabaseUrl) {
        throw new Error(
          'URL do Supabase não encontrada. Verifique se você criou um projeto em supabase.com e copie a URL do projeto.'
        );
      }

      // 🧠 Health Check Inteligente - detecta o que pode ser pulado
      let healthCheck: {
        skipWaitProject?: boolean;
        skipWaitStorage?: boolean;
        skipMigrations?: boolean;
        skipBootstrap?: boolean;
        estimatedSeconds?: number;
      } | undefined;

      try {
        const healthRes = await fetch('/api/installer/health-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            supabase: {
              url: data.supabaseUrl,
              accessToken: data.supabasePat,
            },
          }),
        });

        if (healthRes.ok) {
          const healthData = await healthRes.json();
          if (healthData.ok) {
            healthCheck = {
              skipWaitProject: healthData.skipWaitProject,
              skipWaitStorage: healthData.skipWaitStorage,
              skipMigrations: healthData.skipMigrations,
              skipBootstrap: healthData.skipBootstrap,
              estimatedSeconds: healthData.estimatedSeconds,
            };
            console.log('[wizard] Health check result:', healthCheck);

            // Mensagem personalizada baseada no que foi detectado
            const skippedCount = [
              healthCheck.skipWaitProject,
              healthCheck.skipWaitStorage,
              healthCheck.skipMigrations,
              healthCheck.skipBootstrap,
            ].filter(Boolean).length;

            if (skippedCount >= 3) {
              setProvisioningSubtitle('Projeto detectado! Instalação rápida...');
            } else if (skippedCount >= 1) {
              setProvisioningSubtitle('Otimizando rota de instalação...');
            }
          }
        }
      } catch (healthErr) {
        // Health check é opcional - continua sem ele
        console.log('[wizard] Health check falhou (continuando sem otimização):', healthErr);
      }

      const payload = {
        vercel: {
          token: data.vercelToken,
          teamId: data.vercelProject?.teamId,
          projectId: data.vercelProject?.id || '',
          targets: ['production', 'preview'],
        },
        supabase: {
          url: data.supabaseUrl,
          accessToken: data.supabasePat,
          projectRef: data.supabaseRef,
          dbPass: data.supabaseDbPass, // Senha do banco para conectar como postgres
        },
        upstash: {
          qstashToken: data.qstashToken,
          redisRestUrl: data.redisRestUrl,
          redisRestToken: data.redisRestToken,
        },
        admin: {
          name: data.name,
          email: data.email,
          passwordHash: data.passwordHash,
        },
        healthCheck, // Passa o resultado do health check para pular etapas
      };

      const response = await fetch('/api/installer/run-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Erro ${response.status}`);
      }

      await handleStream(response);
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        console.log('[wizard] Instalação cancelada');
        return;
      }
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
      setPhase('error');
    }
  }, [data, handleStream]);

  const handleGoToDashboard = () => {
    // Limpar TODOS os dados do instalador antes de redirecionar
    // (igual ao CRM - só limpa quando o usuário clica no botão)
    localStorage.removeItem(STORAGE_KEYS.SUPABASE_PAT);
    localStorage.removeItem(STORAGE_KEYS.VERCEL_TOKEN);
    localStorage.removeItem(STORAGE_KEYS.USER_NAME);
    localStorage.removeItem(STORAGE_KEYS.USER_PASS_HASH);
    sessionStorage.removeItem(STORAGE_KEYS.USER_PASS_PLAIN);
    localStorage.removeItem(STORAGE_KEYS.USER_EMAIL);
    localStorage.removeItem(STORAGE_KEYS.VERCEL_PROJECT);
    localStorage.removeItem(STORAGE_KEYS.SUPABASE_URL);
    localStorage.removeItem(STORAGE_KEYS.SUPABASE_REF);
    localStorage.removeItem(STORAGE_KEYS.SUPABASE_PUBLISHABLE_KEY);
    localStorage.removeItem(STORAGE_KEYS.SUPABASE_SECRET_KEY);
    localStorage.removeItem(STORAGE_KEYS.SUPABASE_DB_PASS);
    localStorage.removeItem(STORAGE_KEYS.QSTASH_TOKEN);
    localStorage.removeItem(STORAGE_KEYS.REDIS_REST_URL);
    localStorage.removeItem(STORAGE_KEYS.REDIS_REST_TOKEN);

    // Redirecionar para login (igual ao CRM)
    window.location.href = '/login';
  };

  const handleRetry = () => {
    setPhase('confirm');
    setError(null);
    setRetryInfo(null);
  };

  // Loading state
  if (phase === 'loading') {
    return (
      <InstallLayout showDots={false}>
        <div className="flex items-center justify-center py-20">
          <motion.div
            className="w-8 h-8 border-3 border-emerald-500/20 border-t-emerald-500 rounded-full"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          />
        </div>
      </InstallLayout>
    );
  }

  // Confirmation screen
  if (phase === 'confirm') {
    return (
      <InstallLayout showDots={false}>
        <StepCard glowColor="emerald">
          <div className="flex flex-col items-center text-center">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="w-16 h-16 rounded-full bg-emerald-500/20 border-2 border-emerald-500/50 flex items-center justify-center"
            >
              <Terminal className="w-8 h-8 text-emerald-500" />
            </motion.div>

            <h2 className="mt-4 text-xl font-semibold text-[var(--ds-text-primary)]">
              A escolha é sua, {firstName}.
            </h2>
            <p className="mt-2 text-sm text-[var(--ds-text-secondary)] max-w-sm">
              Pílula vermelha: voltar para onde estava. Pílula verde: descobrir até onde vai a toca do coelho.
            </p>

            {/* Summary */}
            <div className="w-full mt-6 p-4 rounded-xl bg-[var(--ds-bg-surface)]/50 border border-[var(--ds-border-default)] text-left">
              <h3 className="text-sm font-medium text-[var(--ds-text-secondary)] mb-3">
                Resumo da configuração:
              </h3>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2 text-[var(--ds-text-secondary)]">
                  <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  <span className="truncate">Email: {data?.email}</span>
                </li>
                <li className="flex items-center gap-2 text-[var(--ds-text-secondary)]">
                  <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  <span className="truncate">Projeto Vercel: {data?.vercelProject?.name || 'Detectado'}</span>
                </li>
                <li className="flex items-center gap-2 text-[var(--ds-text-secondary)]">
                  <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  Supabase PAT: Configurado
                </li>
                <li className="flex items-center gap-2 text-[var(--ds-text-secondary)]">
                  <CheckCircle className="w-4 h-4 text-orange-500 flex-shrink-0" />
                  QStash: Token configurado
                </li>
                <li className="flex items-center gap-2 text-[var(--ds-text-secondary)]">
                  <CheckCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                  Redis: URL + Token REST
                </li>
              </ul>
            </div>

            {/* Actions - Matrix Pills */}
            <div className="flex gap-3 mt-6 w-full">
              <Button
                variant="outline"
                className="flex-1 border-red-500/30 text-red-400 hover:bg-red-500/10"
                onClick={() => router.push('/install/start')}
              >
                Pílula Vermelha
              </Button>
              <Button
                variant="brand"
                className="flex-1"
                onClick={handleStartProvisioning}
              >
                Pílula Verde
              </Button>
            </div>
          </div>
        </StepCard>
      </InstallLayout>
    );
  }

  // Provisioning in progress
  if (phase === 'provisioning') {
    return (
      <InstallLayout showDots={false}>
        <StepCard glowColor="emerald">
          <div className="flex flex-col items-center text-center py-8">
            {/* Animated rocket */}
            <motion.div
              animate={{
                y: [0, -10, 0],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
              className="relative"
            >
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                className="absolute inset-0 w-16 h-16 rounded-full border-2 border-emerald-500/20 border-t-emerald-500"
              />
              <div className="w-16 h-16 flex items-center justify-center">
                <Terminal className="w-8 h-8 text-emerald-500" />
              </div>
            </motion.div>

            <AnimatePresence mode="wait">
              <motion.h2
                key={provisioningTitle}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mt-6 text-xl font-semibold text-[var(--ds-text-primary)]"
              >
                {provisioningTitle}
              </motion.h2>
            </AnimatePresence>

            <AnimatePresence mode="wait">
              <motion.p
                key={provisioningSubtitle}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="mt-2 text-sm text-[var(--ds-text-secondary)] h-5"
              >
                {provisioningSubtitle}
              </motion.p>
            </AnimatePresence>

            {/* Progress bar */}
            <div className="w-full mt-8">
              <div className="h-2 bg-[var(--ds-bg-surface)] rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full"
                  initial={{ width: '0%' }}
                  animate={{ width: `${provisioningProgress}%` }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                />
              </div>
              <div className="flex justify-between mt-2 text-xs text-[var(--ds-text-muted)]">
                <span>Progresso</span>
                <span>{provisioningProgress}%</span>
              </div>
            </div>

            {/* Retry indicator */}
            {retryInfo && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-4 text-xs text-yellow-500"
              >
                Tentativa {retryInfo.count}/{retryInfo.max}...
              </motion.p>
            )}

            <p className="mt-6 text-xs text-[var(--ds-text-muted)]">
              Não feche esta página
            </p>
          </div>
        </StepCard>
      </InstallLayout>
    );
  }

  // Success
  if (phase === 'success') {
    return (
      <InstallLayout showDots={false}>
        <StepCard glowColor="emerald">
          <div className="flex flex-col items-center text-center py-8">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
              className="w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center"
            >
              <CheckCircle className="w-10 h-10 text-emerald-500" />
            </motion.div>

            <motion.h2
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="mt-6 text-xl font-semibold text-[var(--ds-text-primary)]"
            >
              Bem-vindo à realidade, {firstName}.
            </motion.h2>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="mt-2 text-sm text-[var(--ds-text-secondary)]"
            >
              Você é o Escolhido.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="mt-8 w-full"
            >
              <Button
                variant="brand"
                size="lg"
                className="w-full"
                onClick={handleGoToDashboard}
              >
                Entrar na Matrix
              </Button>
            </motion.div>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="mt-4 text-xs text-[var(--ds-text-muted)]"
            >
              Não há colher. Configure o WhatsApp em Configurações.
            </motion.p>
          </div>
        </StepCard>
      </InstallLayout>
    );
  }

  // Error
  if (phase === 'error') {
    return (
      <InstallLayout showDots={false}>
        <StepCard glowColor="red">
          <div className="flex flex-col items-center text-center py-8">
            <div className="w-20 h-20 rounded-full bg-red-500/20 border-2 border-red-500 flex items-center justify-center">
              <AlertCircle className="w-10 h-10 text-red-500" />
            </div>

            <h2 className="mt-6 text-xl font-semibold text-[var(--ds-text-primary)]">
              Glitch na Matrix
            </h2>
            <p className="mt-2 text-sm text-red-400 max-w-sm">
              {error || 'Ocorreu um erro inesperado'}
            </p>

            <div className="flex gap-3 mt-8 w-full">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => router.push('/install/start')}
              >
                Reiniciar simulação
              </Button>
              <Button
                variant="brand"
                className="flex-1"
                onClick={handleRetry}
              >
                Tentar de novo
              </Button>
            </div>
          </div>
        </StepCard>
      </InstallLayout>
    );
  }

  return null;
}
