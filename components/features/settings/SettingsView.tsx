import React, { useState } from 'react';
import { AlertTriangle, HelpCircle, Save, RefreshCw, Wifi, Edit2, Shield, AlertCircle, UserCheck, Smartphone, X, Copy, Check, ExternalLink, Webhook, Clock, Phone, Trash2, Loader2, ChevronDown, ChevronUp, Zap, ArrowDown, CheckCircle2, Circle, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { AppSettings } from '../../../types';
import { AccountLimits } from '../../../lib/meta-limits';
import { PhoneNumber } from '../../../hooks/useSettings';
import { AISettings } from './AISettings';
import { formatPhoneNumberDisplay } from '../../../lib/phone-formatter';

interface WebhookStats {
  lastEventAt?: string | null;
  todayDelivered?: number;
  todayRead?: number;
  todayFailed?: number;
}

interface DomainOption {
  url: string;
  source: string;
  recommended: boolean;
}

interface SettingsViewProps {
  settings: AppSettings;
  setSettings: (settings: AppSettings) => void;
  isLoading: boolean;
  isSaving: boolean;
  onSave: () => void;
  onSaveSettings: (settings: AppSettings) => void; // Direct save with settings
  onDisconnect: () => void;
  accountLimits?: AccountLimits | null;
  tierName?: string | null;
  limitsError?: boolean;
  limitsErrorMessage?: string | null;
  limitsLoading?: boolean;
  onRefreshLimits?: () => void;
  // Webhook props
  webhookUrl?: string;
  webhookToken?: string;
  webhookStats?: WebhookStats | null;
  // Phone numbers for webhook override
  phoneNumbers?: PhoneNumber[];
  phoneNumbersLoading?: boolean;
  onRefreshPhoneNumbers?: () => void;
  onSetWebhookOverride?: (phoneNumberId: string, callbackUrl: string) => Promise<boolean>;
  onRemoveWebhookOverride?: (phoneNumberId: string) => Promise<boolean>;
  // Domain selection
  availableDomains?: DomainOption[];
  webhookPath?: string;
  // Hide header (when shown externally)
  hideHeader?: boolean;

  // AI Settings
  aiSettings?: {
    isConfigured: boolean;
    source: 'database' | 'env' | 'none';
    tokenPreview?: string | null;
    provider?: 'google' | 'openai' | 'anthropic';
    model?: string;
    providers?: {
      google: { isConfigured: boolean; source: 'database' | 'env' | 'none'; tokenPreview?: string | null };
      openai: { isConfigured: boolean; source: 'database' | 'env' | 'none'; tokenPreview?: string | null };
      anthropic: { isConfigured: boolean; source: 'database' | 'env' | 'none'; tokenPreview?: string | null };
    };
  };
  aiSettingsLoading?: boolean;
  saveAIConfig?: (data: { apiKey?: string; provider?: string; model?: string }) => Promise<void>;
  removeAIKey?: (provider: 'google' | 'openai' | 'anthropic') => Promise<void>;
  isSavingAI?: boolean;
  // Test Contact - Supabase
  testContact?: { name?: string; phone: string } | null;
  saveTestContact?: (contact: { name?: string; phone: string }) => Promise<void>;
  removeTestContact?: () => Promise<void>;
  isSavingTestContact?: boolean;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  setSettings,
  isLoading,
  isSaving,
  onSave,
  onSaveSettings,
  onDisconnect,
  accountLimits,
  tierName,
  limitsError,
  limitsErrorMessage,
  limitsLoading,
  onRefreshLimits,
  webhookUrl,
  webhookToken,
  webhookStats,
  phoneNumbers,
  phoneNumbersLoading,
  onRefreshPhoneNumbers,
  onSetWebhookOverride,
  onRemoveWebhookOverride,
  availableDomains,
  webhookPath,
  hideHeader,

  // AI Props
  aiSettings,
  aiSettingsLoading,
  saveAIConfig,
  removeAIKey,
  isSavingAI,
  // Test Contact Props - Supabase
  testContact,
  saveTestContact,
  removeTestContact,
  isSavingTestContact,
}) => {
  // Always start collapsed
  const [isEditing, setIsEditing] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Test contact editing
  const [isEditingTestContact, setIsEditingTestContact] = useState(false);
  const [testContactName, setTestContactName] = useState(testContact?.name || '');
  const [testContactPhone, setTestContactPhone] = useState(testContact?.phone || '');

  // Webhook override editing
  const [editingPhoneId, setEditingPhoneId] = useState<string | null>(null);
  const [overrideUrl, setOverrideUrl] = useState('');
  const [isSavingOverride, setIsSavingOverride] = useState(false);

  // Webhook explanation expanded state
  const [showWebhookExplanation, setShowWebhookExplanation] = useState(false);

  // Expanded URL state (to show full URL inline)
  const [expandedUrlPhoneId, setExpandedUrlPhoneId] = useState<string | null>(null);

  // Funnel view expanded state
  const [expandedFunnelPhoneId, setExpandedFunnelPhoneId] = useState<string | null>(null);

  // Selected domain for webhook URL
  const [selectedDomainUrl, setSelectedDomainUrl] = useState<string>('');

  // Compute the actual webhook URL based on selected domain
  const computedWebhookUrl = selectedDomainUrl
    ? `${selectedDomainUrl}${webhookPath || '/api/webhook'}`
    : webhookUrl;

  const handleCopy = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      toast.success('Copiado!');
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      toast.error('Erro ao copiar');
    }
  };

  const handleSaveTestContact = async () => {
    if (!testContactPhone.trim()) {
      toast.error('Preencha o telefone do contato de teste');
      return;
    }

    if (!saveTestContact) {
      toast.error('Função de salvar não disponível');
      return;
    }

    try {
      await saveTestContact({
        name: testContactName.trim(),
        phone: testContactPhone.trim(),
      });
      setIsEditingTestContact(false);
    } catch {
      // Error handled by mutation
    }
  };

  const handleRemoveTestContact = async () => {
    if (!removeTestContact) return;

    try {
      await removeTestContact();
      setTestContactName('');
      setTestContactPhone('');
    } catch {
      // Error handled by mutation
    }
  };

  // Webhook override handlers
  const handleSetOverride = async (phoneNumberId: string) => {
    if (!overrideUrl.trim()) {
      toast.error('Digite a URL do webhook');
      return;
    }

    if (!overrideUrl.startsWith('https://')) {
      toast.error('A URL deve começar com https://');
      return;
    }

    setIsSavingOverride(true);
    try {
      const success = await onSetWebhookOverride?.(phoneNumberId, overrideUrl.trim());
      if (success) {
        setEditingPhoneId(null);
        setOverrideUrl('');
      }
    } finally {
      setIsSavingOverride(false);
    }
  };

  const handleRemoveOverride = async (phoneNumberId: string) => {
    setIsSavingOverride(true);
    try {
      await onRemoveWebhookOverride?.(phoneNumberId);
    } finally {
      setIsSavingOverride(false);
    }
  };

  // 1-click: Set SmartZap webhook directly
  const handleSetZapflowWebhook = async (phoneNumberId: string) => {
    const urlToSet = computedWebhookUrl;
    if (!urlToSet) return;

    setIsSavingOverride(true);
    try {
      await onSetWebhookOverride?.(phoneNumberId, urlToSet);
    } finally {
      setIsSavingOverride(false);
    }
  };

  // Helper to get webhook status with level info
  const getWebhookStatus = (phone: PhoneNumber) => {
    const config = phone.webhook_configuration;
    const activeUrl = computedWebhookUrl;

    // Level 1: Phone number override
    if (config?.phone_number) {
      const isSmartZap = config.phone_number === activeUrl;
      return {
        status: isSmartZap ? 'smartzap' : 'other',
        url: config.phone_number,
        level: 1,
        levelName: 'NÚMERO',
        levelDescription: 'Override específico deste número'
      };
    }

    // Level 2: WABA override
    if (config?.whatsapp_business_account) {
      return {
        status: 'waba',
        url: config.whatsapp_business_account,
        level: 2,
        levelName: 'WABA',
        levelDescription: 'Override da conta comercial'
      };
    }

    // Level 3: App callback
    if (config?.application) {
      return {
        status: 'app',
        url: config.application,
        level: 3,
        levelName: 'APP',
        levelDescription: 'Padrão do Meta Developer Dashboard'
      };
    }

    return {
      status: 'none',
      url: null,
      level: 0,
      levelName: 'NENHUM',
      levelDescription: 'Nenhum webhook configurado'
    };
  };

  // Helper to get all 3 webhook levels for funnel visualization
  const getWebhookFunnelLevels = (phone: PhoneNumber) => {
    const config = phone.webhook_configuration;
    const activeStatus = getWebhookStatus(phone);
    const activeUrl = computedWebhookUrl;

    return [
      {
        level: 1,
        name: 'NÚMERO',
        url: config?.phone_number || null,
        isActive: activeStatus.level === 1,
        isSmartZap: config?.phone_number === activeUrl,
        color: 'emerald',
        description: 'Override específico deste número'
      },
      {
        level: 2,
        name: 'WABA',
        url: config?.whatsapp_business_account || null,
        isActive: activeStatus.level === 2,
        isSmartZap: config?.whatsapp_business_account === activeUrl,
        color: 'blue',
        description: 'Override da conta comercial'
      },
      {
        level: 3,
        name: 'APP',
        url: config?.application || null,
        isActive: activeStatus.level === 3,
        isSmartZap: config?.application === activeUrl,
        color: 'zinc',
        description: 'Padrão do Meta Dashboard',
        isLocked: true  // Não pode ser alterado via API
      }
    ];
  };

  if (isLoading) return <div className="text-white">Carregando configurações...</div>;

  return (
    <div>
      {!hideHeader && (
        <>
          <h1 className="text-3xl font-bold text-white tracking-tight mb-2">Configurações</h1>
          <p className="text-gray-400 mb-10">Gerencie sua conexão com a WhatsApp Business API</p>
        </>
      )}

      <div className="space-y-8">
        {/* Status Card */}
        <div className={`glass-panel rounded-2xl p-8 flex items-start gap-6 border transition-all duration-500 ${settings.isConnected ? 'border-emerald-500/30 shadow-[0_0_30px_rgba(16,185,129,0.1)]' : 'border-red-500/30 shadow-[0_0_30px_rgba(239,68,68,0.1)]'}`}>
          <div className={`p-4 rounded-2xl ${settings.isConnected ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
            {settings.isConnected ? <Wifi size={32} /> : <AlertTriangle size={32} />}
          </div>
          <div className="flex-1">
            <h3 className={`text-xl font-bold ${settings.isConnected ? 'text-white' : 'text-white'}`}>
              {settings.isConnected ? 'Sistema Online' : 'Desconectado'}
            </h3>

            <div className={`text-sm mt-3 space-y-1.5 ${settings.isConnected ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
              {settings.isConnected ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="opacity-70">Conta Comercial:</span>
                    <span className="font-mono text-emerald-300 bg-emerald-500/10 px-1.5 py-0.5 rounded">{settings.businessAccountId}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="opacity-70">Telefone Verificado:</span>
                    <span className="font-mono text-emerald-300 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                      {settings.displayPhoneNumber || settings.phoneNumberId}
                    </span>
                  </div>
                </>
              ) : (
                <p>Conexão com Meta API perdida. Por favor re-autentique suas credenciais abaixo.</p>
              )}
            </div>

            {settings.isConnected && (
              <div className="mt-5 flex flex-wrap gap-3">
                {/* Limits Status */}
                {limitsLoading ? (
                  <span className="px-3 py-1.5 bg-zinc-900 rounded-lg text-xs font-medium text-gray-400 border border-white/10 flex items-center gap-1.5 animate-pulse">
                    <RefreshCw size={12} className="animate-spin" />
                    Verificando limites...
                  </span>
                ) : limitsError ? (
                  <button
                    onClick={onRefreshLimits}
                    className="px-3 py-1.5 bg-red-500/10 rounded-lg text-xs font-medium text-red-400 border border-red-500/20 flex items-center gap-1.5 hover:bg-red-500/20 transition-colors"
                  >
                    <AlertCircle size={12} />
                    {limitsErrorMessage || 'Erro ao buscar limites'}
                    <RefreshCw size={10} className="ml-1" />
                  </button>
                ) : (
                  <span className="px-3 py-1.5 bg-zinc-900 rounded-lg text-xs font-medium text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5">
                    <Wifi size={12} />
                    Limite: {accountLimits?.maxUniqueUsersPerDay?.toLocaleString('pt-BR')} msgs/dia
                  </span>
                )}

                {/* Quality Status */}
                {!limitsError && !limitsLoading && (
                  <span className={`px-3 py-1.5 bg-zinc-900 rounded-lg text-xs font-medium border flex items-center gap-1.5 ${accountLimits?.qualityScore === 'GREEN'
                    ? 'text-emerald-400 border-emerald-500/20'
                    : accountLimits?.qualityScore === 'YELLOW'
                      ? 'text-yellow-400 border-yellow-500/20'
                      : accountLimits?.qualityScore === 'RED'
                        ? 'text-red-400 border-red-500/20'
                        : 'text-gray-400 border-white/10'
                    }`}>
                    <Shield size={12} />
                    Qualidade: {accountLimits?.qualityScore === 'GREEN' ? 'Alta' : accountLimits?.qualityScore === 'YELLOW' ? 'Média' : accountLimits?.qualityScore === 'RED' ? 'Baixa' : '---'}
                  </span>
                )}
              </div>
            )}
          </div>

          {settings.isConnected && (
            <div className="flex flex-col gap-3 min-w-[140px]">
              <button
                onClick={() => setIsEditing(!isEditing)}
                className={`group relative overflow-hidden rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-300 flex items-center justify-center gap-2
                  ${isEditing
                    ? 'bg-white text-black shadow-lg hover:bg-gray-100'
                    : 'bg-white/5 text-white hover:bg-white/10 border border-white/10 hover:border-white/20'
                  }`}
              >
                <Edit2 size={14} className={`transition-transform duration-500 ${isEditing ? 'rotate-45' : 'group-hover:scale-110'}`} />
                {isEditing ? 'Cancelar' : 'Editar'}
              </button>

              <button
                onClick={onDisconnect}
                className="text-xs font-medium text-red-400/60 hover:text-red-400 hover:bg-red-500/5 px-4 py-2 rounded-xl transition-all duration-300 flex items-center justify-center gap-2"
              >
                Desconectar
              </button>
            </div>
          )}
        </div>

        {/* AI Settings Section - New! */}
        {settings.isConnected && saveAIConfig && (
          <AISettings
            settings={aiSettings}
            isLoading={!!aiSettingsLoading}
            onSave={saveAIConfig}
            onRemoveKey={removeAIKey}
            isSaving={!!isSavingAI}
          />
        )}

        {/* Form - Only visible if disconnected OR editing */}
        {(!settings.isConnected || isEditing) && (
          <div className="glass-panel rounded-2xl p-8 animate-in slide-in-from-top-4 duration-300">
            <h3 className="text-lg font-semibold text-white mb-8 flex items-center gap-2">
              <span className="w-1 h-6 bg-primary-500 rounded-full"></span>
              Configuração da API
            </h3>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  ID do Número de Telefone <span className="text-primary-500">*</span>
                </label>
                <div className="relative group">
                  <input
                    type="text"
                    value={settings.phoneNumberId}
                    onChange={(e) => setSettings({ ...settings, phoneNumberId: e.target.value })}
                    placeholder="ex: 298347293847"
                    className="w-full px-4 py-3 bg-zinc-900/50 border border-white/10 rounded-xl focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500/50 outline-none font-mono text-sm text-white transition-all group-hover:border-white/20"
                  />
                  <div className="absolute right-4 top-3.5 text-gray-600 cursor-help hover:text-white transition-colors" title="Encontrado no Meta Business Manager">
                    <HelpCircle size={16} />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  ID da Conta Comercial (Business ID) <span className="text-primary-500">*</span>
                </label>
                <div className="relative group">
                  <input
                    type="text"
                    value={settings.businessAccountId}
                    onChange={(e) => setSettings({ ...settings, businessAccountId: e.target.value })}
                    placeholder="ex: 987234987234"
                    className="w-full px-4 py-3 bg-zinc-900/50 border border-white/10 rounded-xl focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500/50 outline-none font-mono text-sm text-white transition-all group-hover:border-white/20"
                  />
                  <div className="absolute right-4 top-3.5 text-gray-600 cursor-help hover:text-white transition-colors" title="Encontrado no Meta Business Manager">
                    <HelpCircle size={16} />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Token de Acesso do Usuário do Sistema <span className="text-primary-500">*</span>
                </label>
                <div className="relative group">
                  <input
                    type="password"
                    value={settings.accessToken}
                    onChange={(e) => setSettings({ ...settings, accessToken: e.target.value })}
                    placeholder="EAAG........"
                    className="w-full px-4 py-3 bg-zinc-900/50 border border-white/10 rounded-xl focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500/50 outline-none font-mono text-sm text-white transition-all group-hover:border-white/20 tracking-widest"
                  />
                </div>
                <p className="text-xs text-gray-500 mt-2 font-mono">Armazenamento criptografado SHA-256.</p>
              </div>
            </div>

            <div className="mt-10 pt-8 border-t border-white/5 flex justify-end gap-4">
              <button
                className="px-6 py-3 rounded-xl border border-white/10 text-gray-300 font-medium hover:bg-white/5 transition-colors flex items-center gap-2"
                onClick={() => toast.success('Teste de conexão bem-sucedido!')}
              >
                <RefreshCw size={18} /> Testar Conexão
              </button>
              <button
                className="px-8 py-3 rounded-xl bg-white text-black font-bold hover:bg-gray-200 transition-colors flex items-center gap-2 shadow-[0_0_20px_rgba(255,255,255,0.1)]"
                onClick={() => {
                  onSave();
                  setIsEditing(false);
                }}
                disabled={isSaving}
              >
                <Save size={18} /> {isSaving ? 'Salvando...' : 'Salvar Config'}
              </button>
            </div>
          </div>
        )}

        {/* Test Contact Section */}
        {settings.isConnected && (
          <div className="glass-panel rounded-2xl p-8">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <span className="w-1 h-6 bg-amber-500 rounded-full"></span>
              Contato de Teste
            </h3>
            <p className="text-sm text-gray-400 mb-6">
              Configure um número para testar suas campanhas antes de enviar para todos os contatos.
            </p>

            {testContact && !isEditingTestContact ? (
              // Show saved test contact
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-amber-500/20 rounded-xl">
                    <UserCheck size={24} className="text-amber-400" />
                  </div>
                  <div>
                    <p className="font-medium text-white">{testContact.name || 'Contato de Teste'}</p>
                    <p className="text-sm text-amber-400 font-mono">{formatPhoneNumberDisplay(testContact.phone, 'international')}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setTestContactName(testContact?.name || '');
                      setTestContactPhone(testContact?.phone || '');
                      setIsEditingTestContact(true);
                    }}
                    className="px-3 py-1.5 text-sm text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                  >
                    Editar
                  </button>
                  <button
                    onClick={handleRemoveTestContact}
                    className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            ) : (
              // Form to add/edit test contact
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Nome
                    </label>
                    <input
                      type="text"
                      value={testContactName}
                      onChange={(e) => setTestContactName(e.target.value)}
                      placeholder="Ex: Meu Teste"
                      className="w-full px-4 py-3 bg-zinc-900/50 border border-white/10 rounded-xl focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 outline-none text-sm text-white transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Telefone (com código do país)
                    </label>
                    <input
                      type="tel"
                      value={testContactPhone}
                      onChange={(e) => setTestContactPhone(e.target.value)}
                      placeholder="Ex: +5511999999999"
                      className="w-full px-4 py-3 bg-zinc-900/50 border border-white/10 rounded-xl focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 outline-none text-sm text-white font-mono transition-all"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-3">
                  {isEditingTestContact && (
                    <button
                      onClick={() => {
                        setIsEditingTestContact(false);
                        setTestContactName(testContact?.name || '');
                        setTestContactPhone(testContact?.phone || '');
                      }}
                      className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
                    >
                      Cancelar
                    </button>
                  )}
                  <button
                    onClick={handleSaveTestContact}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black font-medium rounded-lg transition-colors flex items-center gap-2"
                  >
                    <Smartphone size={16} />
                    Salvar Contato de Teste
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Webhook Configuration Section */}
        {settings.isConnected && webhookUrl && (
          <div className="glass-panel rounded-2xl p-8">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <span className="w-1 h-6 bg-blue-500 rounded-full"></span>
                <Webhook size={20} className="text-blue-400" />
                Webhooks
              </h3>
              {phoneNumbers && phoneNumbers.length > 0 && (
                <button
                  onClick={onRefreshPhoneNumbers}
                  disabled={phoneNumbersLoading}
                  className="p-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                  title="Atualizar lista"
                >
                  <RefreshCw size={16} className={phoneNumbersLoading ? 'animate-spin' : ''} />
                </button>
              )}
            </div>
            <p className="text-sm text-gray-400 mb-6">
              Webhooks são notificações que a Meta envia quando algo acontece (mensagem entregue, lida, etc).
            </p>

            {/* SmartZap Webhook Info */}
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 mb-6">
              <h4 className="font-medium text-blue-300 mb-3 flex items-center gap-2">
                <Zap size={16} />
                URL do Webhook SmartZap
              </h4>

              {/* Domain Selector - only show if multiple domains available */}
              {availableDomains && availableDomains.length > 1 && (
                <div className="mb-4 p-3 bg-zinc-900/50 rounded-lg border border-white/5">
                  <label className="block text-xs font-medium text-gray-400 mb-2">
                    Selecione o domínio para o webhook:
                  </label>
                  <select
                    value={selectedDomainUrl}
                    onChange={(e) => setSelectedDomainUrl(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-800 border border-white/10 rounded-lg text-sm text-white focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 outline-none"
                  >
                    <option value="">Automático (recomendado)</option>
                    {availableDomains.map((domain) => (
                      <option key={domain.url} value={domain.url}>
                        {domain.url} {domain.recommended ? '★' : ''} ({domain.source})
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-gray-500 mt-1.5">
                    Escolha qual domínio usar na URL do webhook. O ★ indica o recomendado.
                  </p>
                </div>
              )}

              <div className="space-y-3">
                <div className="flex gap-2">
                  <code className="flex-1 px-3 py-2 bg-zinc-900/50 border border-white/10 rounded-lg font-mono text-sm text-gray-300 break-all">
                    {computedWebhookUrl}
                  </code>
                  <button
                    onClick={() => handleCopy(computedWebhookUrl || '', 'url')}
                    className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 border border-white/10 rounded-lg transition-colors shrink-0"
                    title="Copiar URL"
                  >
                    {copiedField === 'url' ? (
                      <Check size={16} className="text-emerald-400" />
                    ) : (
                      <Copy size={16} className="text-gray-400" />
                    )}
                  </button>
                </div>
                <div className="flex gap-2 items-center">
                  <span className="text-xs text-gray-500">Token:</span>
                  <code className="px-2 py-1 bg-zinc-900/50 rounded text-xs font-mono text-gray-400">
                    {webhookToken}
                  </code>
                  <button
                    onClick={() => handleCopy(webhookToken || '', 'token')}
                    className="p-1 hover:bg-white/5 rounded transition-colors"
                    title="Copiar Token"
                  >
                    {copiedField === 'token' ? (
                      <Check size={12} className="text-emerald-400" />
                    ) : (
                      <Copy size={12} className="text-gray-400" />
                    )}
                  </button>
                </div>
              </div>

              {/* Webhook Status */}
              {webhookStats?.lastEventAt && (
                <div className="mt-3 pt-3 border-t border-blue-500/20 flex items-center gap-2 text-xs text-blue-300/70">
                  <Check size={12} className="text-emerald-400" />
                  Último evento: {new Date(webhookStats.lastEventAt).toLocaleString('pt-BR')}
                  <span className="text-gray-500">·</span>
                  <span>{webhookStats.todayDelivered || 0} delivered</span>
                  <span className="text-gray-500">·</span>
                  <span>{webhookStats.todayRead || 0} read</span>
                </div>
              )}
            </div>

            {/* Phone Numbers List */}
            {phoneNumbers && phoneNumbers.length > 0 && (
              <>
                {/* Warning Banner - Webhook pointing to another system */}
                {(() => {
                  const numbersWithExternalWebhook = phoneNumbers.filter(phone => {
                    const status = getWebhookStatus(phone);
                    return status.status === 'other';
                  });

                  if (numbersWithExternalWebhook.length > 0) {
                    return (
                      <div className="mb-4 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl animate-in fade-in slide-in-from-top-2 duration-300">
                        <div className="flex items-start gap-3">
                          <div className="p-2 bg-amber-500/20 rounded-lg flex-shrink-0">
                            <AlertTriangle size={20} className="text-amber-400" />
                          </div>
                          <div className="flex-1">
                            <h4 className="font-semibold text-amber-300 mb-1">
                              Webhook apontando para outro sistema
                            </h4>
                            <p className="text-sm text-amber-200/80">
                              {numbersWithExternalWebhook.length === 1
                                ? `O número ${numbersWithExternalWebhook[0].display_phone_number} está enviando webhooks para outro sistema.`
                                : `${numbersWithExternalWebhook.length} números estão enviando webhooks para outros sistemas.`
                              }
                              {' '}Os status de entrega (Entregue, Lido) <strong>não serão atualizados</strong> neste app.
                            </p>
                            <p className="text-xs text-amber-300/60 mt-2">
                              Clique em "Ativar Prioridade #1" no número afetado para corrigir.
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  return null;
                })()}

                <h4 className="font-medium text-white mb-3 flex items-center gap-2">
                  <Phone size={16} className="text-gray-400" />
                  Seus Números
                </h4>

                {phoneNumbersLoading ? (
                  <div className="flex items-center justify-center py-8 text-gray-400">
                    <Loader2 size={24} className="animate-spin mr-2" />
                    Carregando números...
                  </div>
                ) : (
                  <div className="space-y-3">
                    {phoneNumbers.map((phone) => {
                      const webhookStatus = getWebhookStatus(phone);
                      const funnelLevels = getWebhookFunnelLevels(phone);
                      const isEditingThis = editingPhoneId === phone.id;
                      const isFunnelExpanded = expandedFunnelPhoneId === phone.id;

                      // Determinar cor baseado no status real
                      const cardColor = webhookStatus.status === 'smartzap'
                        ? 'emerald'
                        : webhookStatus.status === 'other'
                          ? 'amber'
                          : webhookStatus.level === 2
                            ? 'blue'
                            : 'zinc';

                      return (
                        <div
                          key={phone.id}
                          className={`border rounded-xl overflow-hidden transition-all ${cardColor === 'emerald'
                            ? 'bg-emerald-500/5 border-emerald-500/20'
                            : cardColor === 'amber'
                              ? 'bg-amber-500/5 border-amber-500/20'
                              : cardColor === 'blue'
                                ? 'bg-blue-500/5 border-blue-500/20'
                                : 'bg-zinc-800/50 border-white/10'
                            }`}
                        >
                          {/* Header Row - Always visible */}
                          <div className="p-4">
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className={`p-2.5 rounded-xl ${cardColor === 'emerald'
                                  ? 'bg-emerald-500/20 text-emerald-400'
                                  : cardColor === 'amber'
                                    ? 'bg-amber-500/20 text-amber-400'
                                    : cardColor === 'blue'
                                      ? 'bg-blue-500/20 text-blue-400'
                                      : 'bg-zinc-700 text-gray-400'
                                  }`}>
                                  <Phone size={18} />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="font-medium text-white">
                                    {phone.display_phone_number}
                                  </div>
                                  <div className="text-sm text-gray-400 truncate">
                                    {phone.verified_name || 'Sem nome verificado'}
                                  </div>
                                  {/* Status line - sempre visível */}
                                  <div className={`text-xs mt-1.5 flex items-center gap-1.5 ${cardColor === 'emerald'
                                    ? 'text-emerald-400/80'
                                    : cardColor === 'amber'
                                      ? 'text-amber-400/80'
                                      : cardColor === 'blue'
                                        ? 'text-blue-400/80'
                                        : 'text-gray-500'
                                    }`}>
                                    {webhookStatus.status === 'smartzap' ? (
                                      <>
                                        <CheckCircle2 size={12} />
                                        <span>SmartZap capturando eventos</span>
                                      </>
                                    ) : webhookStatus.status === 'other' ? (
                                      <>
                                        <AlertCircle size={12} />
                                        <span>Outro sistema no nível #1</span>
                                      </>
                                    ) : webhookStatus.level === 2 ? (
                                      <>
                                        <Circle size={12} />
                                        <span>Usando webhook da WABA</span>
                                      </>
                                    ) : webhookStatus.level === 3 ? (
                                      <>
                                        <Circle size={12} />
                                        <span>Usando fallback do App</span>
                                      </>
                                    ) : (
                                      <>
                                        <AlertCircle size={12} />
                                        <span>Nenhum webhook configurado</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 flex-shrink-0">
                                {/* Level Badge - Clickable to expand funnel */}
                                <button
                                  onClick={() => setExpandedFunnelPhoneId(isFunnelExpanded ? null : phone.id)}
                                  className={`px-2.5 py-1 text-xs font-medium rounded-lg flex items-center gap-1.5 transition-all hover:ring-2 hover:ring-white/20 ${cardColor === 'emerald'
                                    ? 'bg-emerald-500/20 text-emerald-400'
                                    : cardColor === 'amber'
                                      ? 'bg-amber-500/20 text-amber-400'
                                      : cardColor === 'blue'
                                        ? 'bg-blue-500/20 text-blue-400'
                                        : 'bg-zinc-700 text-gray-300'
                                    }`}
                                  title="Clique para ver o funil completo"
                                >
                                  {webhookStatus.level > 0 && (
                                    <span className="font-bold">#{webhookStatus.level}</span>
                                  )}
                                  {webhookStatus.status === 'smartzap' ? 'SmartZap' : webhookStatus.levelName}
                                  <ChevronDown size={12} className={`transition-transform ${isFunnelExpanded ? 'rotate-180' : ''}`} />
                                </button>

                                {/* Actions */}
                                {!isEditingThis && (
                                  <>
                                    {webhookStatus.status !== 'smartzap' && (
                                      <button
                                        onClick={() => handleSetZapflowWebhook(phone.id)}
                                        disabled={isSavingOverride}
                                        className="px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-600/50 text-white rounded-lg transition-colors flex items-center gap-1"
                                      >
                                        {isSavingOverride ? (
                                          <Loader2 size={12} className="animate-spin" />
                                        ) : (
                                          <Zap size={12} />
                                        )}
                                        Ativar Prioridade #1
                                      </button>
                                    )}
                                    {(webhookStatus.status === 'smartzap' || webhookStatus.status === 'other') && (
                                      <button
                                        onClick={() => handleRemoveOverride(phone.id)}
                                        disabled={isSavingOverride}
                                        className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                                        title="Remover override (voltar para padrão)"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Funnel Visualization - Expandable */}
                          {isFunnelExpanded && !isEditingThis && (
                            <div className="px-4 pb-4 animate-in slide-in-from-top-2 duration-200">
                              <div className="bg-zinc-900/50 rounded-xl p-4 border border-white/5">
                                <div className="text-xs text-gray-500 mb-3 flex items-center gap-2">
                                  <ArrowDown size={12} />
                                  Fluxo de eventos (primeiro que existir, captura)
                                </div>

                                {/* Funnel Steps */}
                                <div className="space-y-0">
                                  {funnelLevels.map((level, index) => {
                                    const isLast = index === funnelLevels.length - 1;
                                    const colorClasses = {
                                      emerald: {
                                        active: 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400',
                                        inactive: 'bg-emerald-500/5 border-emerald-500/10 text-emerald-400/50',
                                        arrow: 'text-emerald-500/30'
                                      },
                                      blue: {
                                        active: 'bg-blue-500/20 border-blue-500/40 text-blue-400',
                                        inactive: 'bg-blue-500/5 border-blue-500/10 text-blue-400/50',
                                        arrow: 'text-blue-500/30'
                                      },
                                      zinc: {
                                        active: 'bg-zinc-700 border-zinc-600 text-gray-300',
                                        inactive: 'bg-zinc-800/50 border-white/5 text-gray-500',
                                        arrow: 'text-zinc-600'
                                      }
                                    };
                                    const colors = colorClasses[level.color as keyof typeof colorClasses];

                                    return (
                                      <div key={level.level}>
                                        {/* Level Box */}
                                        <div
                                          className={`relative rounded-lg border p-3 transition-all ${level.isActive ? colors.active : colors.inactive
                                            } ${level.isActive ? `ring-2 ring-offset-2 ring-offset-zinc-900 ${level.color === 'emerald' ? 'ring-emerald-500/30' : level.color === 'blue' ? 'ring-blue-500/30' : 'ring-zinc-500/30'}` : ''}`}
                                        >
                                          <div className="flex items-center justify-between gap-3">
                                            <div className="flex items-center gap-2">
                                              {/* Status icon */}
                                              {level.isActive ? (
                                                <CheckCircle2 size={16} className={level.isSmartZap ? 'text-emerald-400' : ''} />
                                              ) : level.url ? (
                                                <Circle size={16} className="opacity-40" />
                                              ) : (
                                                <Circle size={16} className="opacity-20" />
                                              )}

                                              {/* Level info */}
                                              <div>
                                                <div className="flex items-center gap-2">
                                                  <span className="font-bold text-sm">#{level.level}</span>
                                                  <span className="font-medium text-sm">{level.name}</span>
                                                  {level.isActive && level.isSmartZap && (
                                                    <span className="px-1.5 py-0.5 bg-emerald-500/30 text-emerald-300 text-[10px] font-bold rounded">
                                                      ZAPFLOW
                                                    </span>
                                                  )}
                                                  {level.isActive && !level.isSmartZap && level.url && (
                                                    <span className="px-1.5 py-0.5 bg-amber-500/30 text-amber-300 text-[10px] font-bold rounded">
                                                      OUTRO
                                                    </span>
                                                  )}
                                                  {/* Lock icon for fixed levels (APP) */}
                                                  {'isLocked' in level && level.isLocked && (
                                                    <span className="flex items-center gap-1 px-1.5 py-0.5 bg-zinc-700/50 text-gray-400 text-[10px] font-medium rounded" title="Configurado no Meta Dashboard">
                                                      <Lock size={10} />
                                                      FIXO
                                                    </span>
                                                  )}
                                                </div>
                                                {level.url ? (
                                                  <code className="text-[10px] opacity-60 block mt-0.5 break-all">
                                                    {level.url}
                                                  </code>
                                                ) : (
                                                  <span className="text-[10px] opacity-40 block mt-0.5">
                                                    Não configurado
                                                  </span>
                                                )}
                                              </div>
                                            </div>

                                            {/* Active indicator */}
                                            {level.isActive && (
                                              <div className="flex items-center gap-1 text-[10px] font-medium bg-white/10 px-2 py-1 rounded-full">
                                                <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                                                ATIVO
                                              </div>
                                            )}
                                          </div>
                                        </div>

                                        {/* Arrow connector */}
                                        {!isLast && (
                                          <div className={`flex justify-center py-1 ${colors.arrow}`}>
                                            <ArrowDown size={16} />
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>

                                {/* Legend */}
                                <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-[10px] text-gray-500">
                                  <span>A Meta verifica de cima para baixo</span>
                                  <span className="flex items-center gap-1">
                                    <CheckCircle2 size={10} />
                                    = Capturando eventos
                                  </span>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Edit form */}
                          {isEditingThis && (
                            <div className="px-4 pb-4">
                              <div className="pt-4 border-t border-white/5 space-y-3">
                                <div>
                                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                                    URL do Webhook (deve ser HTTPS)
                                  </label>
                                  <input
                                    type="url"
                                    value={overrideUrl}
                                    onChange={(e) => setOverrideUrl(e.target.value)}
                                    placeholder="https://seu-sistema.com/webhook"
                                    className="w-full px-3 py-2 bg-zinc-900/50 border border-white/10 rounded-lg text-sm font-mono text-white focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 outline-none"
                                  />
                                </div>
                                <div className="flex justify-end gap-2">
                                  <button
                                    onClick={() => {
                                      setEditingPhoneId(null);
                                      setOverrideUrl('');
                                    }}
                                    className="px-3 py-1.5 text-sm text-gray-400 hover:text-white transition-colors"
                                  >
                                    Cancelar
                                  </button>
                                  <button
                                    onClick={() => handleSetOverride(phone.id)}
                                    disabled={isSavingOverride || !overrideUrl.trim()}
                                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
                                  >
                                    {isSavingOverride ? (
                                      <Loader2 size={14} className="animate-spin" />
                                    ) : (
                                      <Check size={14} />
                                    )}
                                    Salvar
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {/* Expandable explanation of webhook levels */}
            <div className="mt-6">
              <button
                onClick={() => setShowWebhookExplanation(!showWebhookExplanation)}
                className="w-full flex items-center justify-between p-4 bg-zinc-800/50 hover:bg-zinc-800 border border-white/10 rounded-xl transition-colors"
              >
                <span className="flex items-center gap-2 text-sm font-medium text-gray-300">
                  <HelpCircle size={16} className="text-gray-400" />
                  Entenda os 3 níveis de webhook
                </span>
                {showWebhookExplanation ? (
                  <ChevronUp size={16} className="text-gray-400" />
                ) : (
                  <ChevronDown size={16} className="text-gray-400" />
                )}
              </button>

              {showWebhookExplanation && (
                <div className="mt-3 p-4 bg-zinc-900/50 border border-white/5 rounded-xl space-y-4 animate-in slide-in-from-top-2 duration-200">
                  <p className="text-sm text-gray-400">
                    A Meta verifica os webhooks nesta ordem. O primeiro que existir, ganha:
                  </p>

                  <div className="space-y-3">
                    <div className="flex gap-3 p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-lg">
                      <div className="w-8 h-8 bg-emerald-500/20 rounded-lg flex items-center justify-center text-emerald-400 font-bold text-sm flex-shrink-0">
                        #1
                      </div>
                      <div>
                        <div className="font-medium text-emerald-300">NÚMERO</div>
                        <p className="text-xs text-emerald-200/60 mt-0.5">
                          Webhook específico deste número. Ignora os níveis abaixo.
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          → Use quando: sistemas diferentes por número (IA, CRM, etc)
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-3 p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg">
                      <div className="w-8 h-8 bg-blue-500/20 rounded-lg flex items-center justify-center text-blue-400 font-bold text-sm flex-shrink-0">
                        #2
                      </div>
                      <div>
                        <div className="font-medium text-blue-300">WABA</div>
                        <p className="text-xs text-blue-200/60 mt-0.5">
                          Webhook para TODOS os números da sua conta comercial.
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          → Use quando: 1 sistema para toda a empresa
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-3 p-3 bg-zinc-700/30 border border-white/10 rounded-lg">
                      <div className="w-8 h-8 bg-zinc-700 rounded-lg flex items-center justify-center text-gray-300 font-bold text-sm flex-shrink-0">
                        #3
                      </div>
                      <div>
                        <div className="font-medium text-gray-300">APP (Padrão)</div>
                        <p className="text-xs text-gray-400 mt-0.5">
                          Webhook configurado no Meta Developer Dashboard.
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          → Fallback: usado se não tiver #1 nem #2
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
