import React, { useState, useEffect, useMemo } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertCircle,
  Braces, // Clean variable icon
  Calendar,
  Check,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock,
  CreditCard,
  ExternalLink,
  Eye,
  FlaskConical,
  Info,
  Link as LinkIcon,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Smartphone,
  Sparkles,
  TrendingUp,
  Users,
  Wand2,
  X,
  XCircle,
  Zap
} from 'lucide-react';
import { PrefetchLink } from '@/components/ui/PrefetchLink';
import { Template, Contact, TestContact, CustomFieldDefinition } from '../../../types';
import { campaignService } from '../../../services/campaignService';
import { contactService } from '../../../services/contactService';
import { customFieldService } from '@/services/customFieldService';
import { CustomFieldsSheet } from '../contacts/CustomFieldsSheet';
import { getPricingBreakdown } from '../../../lib/whatsapp-pricing';
import { useExchangeRate } from '../../../hooks/useExchangeRate';
import { WhatsAppPhonePreview } from '@/components/ui/WhatsAppPhonePreview';
import { CampaignValidation, AccountLimits, TIER_DISPLAY_NAMES, getNextTier, TIER_LIMITS, getUpgradeRoadmap, UpgradeStep } from '../../../lib/meta-limits';

// Helper Icon
const CheckCircleFilled = ({ size }: { size: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm-1.25 17.292l-4.5-4.364 1.857-1.858 2.643 2.506 5.643-5.784 1.857 1.857-7.5 7.643z" /></svg>
);

interface CampaignWizardViewProps {
  step: number;
  setStep: (step: number) => void;
  name: string;
  setName: (name: string) => void;
  selectedTemplateId: string;
  setSelectedTemplateId: (id: string) => void;
  recipientSource: 'all' | 'specific' | 'test' | null;
  setRecipientSource: (source: 'all' | 'specific' | 'test' | null) => void;
  totalContacts: number;
  recipientCount: number;
  allContacts: Contact[];
  filteredContacts: Contact[];
  contactSearchTerm: string;
  setContactSearchTerm: (term: string) => void;
  selectedContacts: Contact[];
  selectedContactIds: string[];
  toggleContact: (contactId: string) => void;
  availableTemplates: Template[];
  selectedTemplate?: Template;
  handleNext: () => void;
  handleBack: () => void;
  // Pré-check (dry-run)
  // O controller retorna o payload do pré-check (útil para testes/telemetria), então aceitamos qualquer retorno.
  handlePrecheck: () => void | Promise<unknown>;
  precheckResult?: {
    templateName: string;
    totals: { total: number; valid: number; skipped: number };
    results: Array<
      | { ok: true; contactId?: string; name: string; phone: string; normalizedPhone: string }
      | { ok: false; contactId?: string; name: string; phone: string; normalizedPhone?: string; skipCode: string; reason: string }
    >;
  } | null;
  isPrechecking?: boolean;

  handleSend: (scheduledAt?: string) => void | Promise<void>;
  isCreating: boolean;
  isLoading: boolean;
  // Test Contact
  testContact?: TestContact;
  // Template Variables - Meta API Structure
  templateVariables: { header: string[], body: string[], buttons?: Record<string, string> };
  setTemplateVariables: (vars: { header: string[], body: string[], buttons?: Record<string, string> }) => void;
  templateVariableCount: number;
  templateVariableInfo?: {
    body: { index: number; key: string; placeholder: string; context: string }[];
    header: { index: number; key: string; placeholder: string; context: string }[];
    buttons: { index: number; key: string; buttonIndex: number; buttonText: string; context: string }[];
    totalExtra: number;
  };
  // Account Limits & Validation
  accountLimits?: AccountLimits | null;
  isBlockModalOpen: boolean;
  setIsBlockModalOpen: (open: boolean) => void;
  blockReason: CampaignValidation | null;
  // Live validation
  liveValidation?: CampaignValidation | null;
  isOverLimit?: boolean;
  currentLimit?: number;
}

// Modal de bloqueio quando campanha excede limites da conta
const CampaignBlockModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  validation: CampaignValidation | null;
  accountLimits?: AccountLimits | null;
}> = ({ isOpen, onClose, validation, accountLimits }) => {
  if (!isOpen || !validation) return null;

  const currentTier = accountLimits?.messagingTier || 'TIER_250';
  const nextTier = getNextTier(currentTier);
  const currentLimit = TIER_LIMITS[currentTier];
  const nextLimit = nextTier ? TIER_LIMITS[nextTier] : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-lg mx-4 shadow-2xl animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center gap-4 p-6 border-b border-white/10 bg-red-500/5">
          <div className="p-3 bg-red-500/20 rounded-xl">
            <ShieldAlert className="text-red-400" size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Limite de Envio Excedido</h2>
            <p className="text-sm text-gray-400">Sua conta não pode enviar essa quantidade</p>
          </div>
          <button
            onClick={onClose}
            className="ml-auto p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <XCircle className="text-gray-400" size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Current Status */}
          <div className="bg-zinc-800/50 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Seu Tier Atual</span>
              <span className="text-sm font-bold text-white bg-zinc-700 px-3 py-1 rounded-lg">
                {TIER_DISPLAY_NAMES[currentTier]}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Limite de Mensagens/dia</span>
              <span className="text-sm font-bold text-primary-400">
                {currentLimit.toLocaleString('pt-BR')}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Você tentou enviar</span>
              <span className="text-sm font-bold text-red-400">
                {validation.requestedCount.toLocaleString('pt-BR')}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-white/5 pt-3">
              <span className="text-sm text-gray-400">Excedente</span>
              <span className="text-sm font-bold text-red-400">
                +{(validation.requestedCount - currentLimit).toLocaleString('pt-BR')} mensagens
              </span>
            </div>
          </div>

          {/* Upgrade Roadmap */}
          {validation.upgradeRoadmap && validation.upgradeRoadmap.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <TrendingUp size={16} className="text-primary-400" />
                Como aumentar seu limite
              </div>
              <div className="space-y-2">
                {validation.upgradeRoadmap.map((step, index) => (
                  <div
                    key={index}
                    className="flex items-start gap-3 bg-zinc-800/30 p-3 rounded-lg border border-white/5"
                  >
                    <div className="w-5 h-5 rounded-full bg-primary-500/20 text-primary-400 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                      {index + 1}
                    </div>
                    <p className="text-sm text-gray-300">{step.title}: {step.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Next Tier Info */}
          {nextTier && nextLimit && (
            <div className="bg-primary-500/10 border border-primary-500/20 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles size={16} className="text-primary-400" />
                <span className="text-sm font-bold text-primary-400">Próximo Tier: {TIER_DISPLAY_NAMES[nextTier]}</span>
              </div>
              <p className="text-sm text-gray-400">
                Com o tier {TIER_DISPLAY_NAMES[nextTier]}, você poderá enviar até{' '}
                <span className="text-white font-bold">{nextLimit.toLocaleString('pt-BR')}</span> mensagens por dia.
              </p>
            </div>
          )}

          {/* Suggestion */}
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex gap-3">
            <AlertCircle className="text-amber-400 flex-shrink-0" size={18} />
            <div className="text-sm text-amber-200/80">
              <p className="font-bold text-amber-400 mb-1">Sugestão</p>
              <p>
                Reduza o número de destinatários para no máximo{' '}
                <span className="font-bold text-white">{currentLimit.toLocaleString('pt-BR')}</span>{' '}
                ou divida sua campanha em múltiplos envios.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-white/10 bg-zinc-800/30">
          <a
            href="https://developers.facebook.com/docs/whatsapp/messaging-limits"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-gray-400 hover:text-primary-400 flex items-center gap-1 transition-colors"
          >
            <ExternalLink size={14} />
            Documentação da Meta
          </a>
          <button
            onClick={onClose}
            className="px-6 py-2 bg-white text-black font-bold rounded-xl hover:bg-gray-200 transition-colors"
          >
            Entendi
          </button>
        </div>
      </div>
    </div>
  );
};

// Modal de Upgrade - Mostra o roadmap para aumentar o tier
const UpgradeRoadmapModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  accountLimits?: AccountLimits | null;
}> = ({ isOpen, onClose, accountLimits }) => {
  if (!isOpen) return null;

  const currentTier = accountLimits?.messagingTier || 'TIER_250';
  const nextTier = getNextTier(currentTier);
  const currentLimit = TIER_LIMITS[currentTier];
  const nextLimit = nextTier ? TIER_LIMITS[nextTier] : null;

  // Get upgrade steps
  const upgradeSteps = accountLimits ? getUpgradeRoadmap(accountLimits) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-lg mx-4 shadow-2xl animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-4 p-6 border-b border-white/10 bg-gradient-to-r from-primary-500/10 to-transparent shrink-0">
          <div className="p-3 bg-primary-500/20 rounded-xl">
            <TrendingUp className="text-primary-400" size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Aumentar seu Limite</h2>
            <p className="text-sm text-gray-400">Siga o roadmap para evoluir seu tier</p>
          </div>
          <button
            onClick={onClose}
            className="ml-auto p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <XCircle className="text-gray-400" size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1">
          {/* Current vs Next Tier */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-zinc-800/50 rounded-xl p-4 text-center border border-white/5">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Tier Atual</p>
              <p className="text-lg font-bold text-white">{TIER_DISPLAY_NAMES[currentTier]}</p>
              <p className="text-sm text-gray-400">{currentLimit.toLocaleString('pt-BR')}/dia</p>
            </div>
            {nextTier && nextLimit && (
              <div className="bg-primary-500/10 rounded-xl p-4 text-center border border-primary-500/30">
                <p className="text-[10px] text-primary-400 uppercase tracking-wider mb-1">Próximo Tier</p>
                <p className="text-lg font-bold text-primary-400">{TIER_DISPLAY_NAMES[nextTier]}</p>
                <p className="text-sm text-primary-300">{nextLimit.toLocaleString('pt-BR')}/dia</p>
              </div>
            )}
          </div>

          {/* Upgrade Steps */}
          {upgradeSteps.length > 0 ? (
            <div className="space-y-3">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Passos para Evoluir</p>
              {upgradeSteps.map((step, index) => (
                <div
                  key={index}
                  className={`p-4 rounded-xl border transition-all ${step.completed
                    ? 'bg-primary-500/10 border-primary-500/30'
                    : 'bg-zinc-800/30 border-white/5'
                    }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${step.completed
                      ? 'bg-primary-500 text-white'
                      : 'bg-zinc-700 text-gray-400'
                      }`}>
                      {step.completed ? <Check size={14} /> : <Circle size={14} />}
                    </div>
                    <div className="flex-1">
                      <p className={`font-bold text-sm ${step.completed ? 'text-primary-400' : 'text-white'}`}>
                        {step.title}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">{step.description}</p>
                      {step.link && (
                        <a
                          href={step.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary-400 hover:text-primary-300 mt-2"
                        >
                          <ExternalLink size={12} />
                          {step.action || 'Abrir'}
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <TrendingUp size={32} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">Você já está no tier máximo!</p>
            </div>
          )}

          {/* Quality Score Info */}
          {accountLimits?.qualityScore && (
            <div className={`p-4 rounded-xl border ${accountLimits.qualityScore === 'GREEN'
              ? 'bg-green-500/10 border-green-500/30'
              : accountLimits.qualityScore === 'YELLOW'
                ? 'bg-yellow-500/10 border-yellow-500/30'
                : accountLimits.qualityScore === 'RED'
                  ? 'bg-red-500/10 border-red-500/30'
                  : 'bg-zinc-800/30 border-white/5'
              }`}>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Qualidade da Conta</p>
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${accountLimits.qualityScore === 'GREEN' ? 'bg-green-500' :
                  accountLimits.qualityScore === 'YELLOW' ? 'bg-yellow-500' :
                    accountLimits.qualityScore === 'RED' ? 'bg-red-500' : 'bg-gray-500'
                  }`} />
                <span className="text-sm text-white font-medium">
                  {accountLimits.qualityScore === 'GREEN' ? 'Alta (Verde)' :
                    accountLimits.qualityScore === 'YELLOW' ? 'Média (Amarela)' :
                      accountLimits.qualityScore === 'RED' ? 'Baixa (Vermelha)' : 'Desconhecida'}
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                {accountLimits.qualityScore === 'RED'
                  ? 'Melhore a qualidade para poder evoluir de tier.'
                  : 'Mantenha a qualidade alta para evoluir automaticamente.'}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-white/10 bg-zinc-800/30 shrink-0">
          <a
            href="https://developers.facebook.com/docs/whatsapp/messaging-limits"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-gray-400 hover:text-primary-400 flex items-center gap-1 transition-colors"
          >
            <ExternalLink size={14} />
            Documentação Meta
          </a>
          <button
            onClick={onClose}
            className="px-6 py-2 bg-primary-600 text-white font-bold rounded-xl hover:bg-primary-500 transition-colors"
          >
            Entendi
          </button>
        </div>
      </div>
    </div >
  );
};

export const CampaignWizardView: React.FC<CampaignWizardViewProps> = ({
  step,
  setStep,
  name,
  setName,
  selectedTemplateId,
  setSelectedTemplateId,
  recipientSource,
  setRecipientSource,
  totalContacts,
  recipientCount,
  allContacts,
  filteredContacts,
  contactSearchTerm,
  setContactSearchTerm,
  selectedContacts,
  selectedContactIds,
  toggleContact,
  availableTemplates,
  selectedTemplate,
  handleNext,
  handleBack,
  handlePrecheck,
  precheckResult,
  isPrechecking,
  handleSend,
  isCreating,
  isLoading,
  testContact,
  // Template Variables
  templateVariables,
  setTemplateVariables,
  templateVariableCount,
  templateVariableInfo,
  // Account Limits
  accountLimits,
  isBlockModalOpen,
  setIsBlockModalOpen,
  blockReason,
  liveValidation,
  isOverLimit = false,
  currentLimit = 250
}) => {
  // State for upgrade modal
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  // State for scheduling
  const [scheduleMode, setScheduleMode] = useState<'now' | 'scheduled'>('now');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');

  // State for template search and hover preview
  const [testContacts, setTestContacts] = useState<TestContact[]>([]);
  const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>([]);
  const [isFieldsSheetOpen, setIsFieldsSheetOpen] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [hoveredTemplateId, setHoveredTemplateId] = useState<string | null>(null);

  // Load custom fields
  useEffect(() => {
    const loadFields = async () => {
      try {
        const fields = await customFieldService.getAll();
        setCustomFields(fields);
      } catch (err) {
        console.error(err);
      }
    };
    loadFields();
  }, [isFieldsSheetOpen]); // Reload when sheet closes incase fields changed

  useEffect(() => {
    // Carregar contatos de teste do localStorage
    if (typeof window !== 'undefined') {
      const storedTestContacts = localStorage.getItem('testContacts');
      if (storedTestContacts) {
        setTestContacts(JSON.parse(storedTestContacts));
      }
    }
  }, []);

  // Filter templates based on search (or show only selected if one is chosen)
  const filteredTemplates = useMemo(() => {
    // If a template is selected, only show that one
    if (selectedTemplateId) {
      return availableTemplates.filter(t => t.id === selectedTemplateId);
    }
    // Otherwise, filter by search
    if (!templateSearch.trim()) {
      return availableTemplates;
    }
    const search = templateSearch.toLowerCase();
    return availableTemplates.filter(t =>
      t.name.toLowerCase().includes(search) ||
      t.content.toLowerCase().includes(search) ||
      t.category.toLowerCase().includes(search)
    );
  }, [availableTemplates, templateSearch, selectedTemplateId]);

  // Get template to preview (hovered takes priority over selected)
  const previewTemplate = useMemo(() => {
    if (hoveredTemplateId) {
      return availableTemplates.find(t => t.id === hoveredTemplateId);
    }
    return selectedTemplate;
  }, [hoveredTemplateId, selectedTemplate, availableTemplates]);

  type MissingParam = {
    where: 'header' | 'body' | 'button';
    key: string;
    buttonIndex?: number;
    raw: string;
  };

  const missingParams = useMemo<MissingParam[]>(() => {
    const results = (precheckResult as any)?.results as any[] | undefined;
    if (!results || !Array.isArray(results)) return [];

    const out: MissingParam[] = [];
    const parseReason = (reason: string): MissingParam[] => {
      if (!reason || typeof reason !== 'string') return [];
      if (!reason.includes('Variáveis obrigatórias sem valor:')) return [];

      const tail = reason.split('Variáveis obrigatórias sem valor:')[1] || '';
      const parts = tail.split(',').map(s => s.trim()).filter(Boolean);
      const parsed: MissingParam[] = [];

      for (const p of parts) {
        // button:0:1 (raw="{{email}}")
        const btn = p.match(/^button:(\d+):(\w+) \(raw="([\s\S]*?)"\)$/);
        if (btn) {
          parsed.push({ where: 'button', buttonIndex: Number(btn[1]), key: String(btn[2]), raw: btn[3] });
          continue;
        }
        // body:1 (raw="<vazio>")
        const hb = p.match(/^(header|body):(\w+) \(raw="([\s\S]*?)"\)$/);
        if (hb) {
          parsed.push({ where: hb[1] as any, key: String(hb[2]), raw: hb[3] });
        }
      }
      return parsed;
    };

    for (const r of results) {
      if (r?.ok) continue;
      if (r?.skipCode !== 'MISSING_REQUIRED_PARAM') continue;
      const reason = String(r?.reason || '');
      out.push(...parseReason(reason));
    }

    return out;
  }, [precheckResult]);

  const missingSummary = useMemo(() => {
    const map = new Map<string, { where: MissingParam['where']; key: string; buttonIndex?: number; count: number; rawSamples: Set<string> }>();
    for (const m of missingParams) {
      const id = m.where === 'button' ? `button:${m.buttonIndex}:${m.key}` : `${m.where}:${m.key}`;
      const cur = map.get(id) || { where: m.where, key: m.key, buttonIndex: m.buttonIndex, count: 0, rawSamples: new Set<string>() };
      cur.count += 1;
      if (m.raw) cur.rawSamples.add(m.raw);
      map.set(id, cur);
    }

    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [missingParams]);

  const applyQuickFill = (slot: { where: 'header' | 'body' | 'button'; key: string; buttonIndex?: number }, value: string) => {
    if (slot.where === 'header') {
      const idx = (templateVariableInfo?.header || []).findIndex(v => String(v.key) === String(slot.key));
      if (idx < 0) return;
      const newHeader = [...templateVariables.header];
      newHeader[idx] = value;
      setTemplateVariables({ ...templateVariables, header: newHeader });
      return;
    }
    if (slot.where === 'body') {
      const idx = (templateVariableInfo?.body || []).findIndex(v => String(v.key) === String(slot.key));
      if (idx < 0) return;
      const newBody = [...templateVariables.body];
      newBody[idx] = value;
      setTemplateVariables({ ...templateVariables, body: newBody });
      return;
    }
    if (slot.where === 'button') {
      const bIdx = Number(slot.buttonIndex);
      const key = String(slot.key);
      if (!Number.isFinite(bIdx) || bIdx < 0) return;

      // Mantém compatibilidade com UI atual (button_{idx}_0) e com o contrato (aceita legacy e modern).
      const legacyKey = `button_${bIdx}_${Math.max(0, Number(key) - 1)}`;
      const modernKey = `button_${bIdx}_${key}`;

      setTemplateVariables({
        ...templateVariables,
        buttons: {
          ...(templateVariables.buttons || {}),
          [legacyKey]: value,
          [modernKey]: value,
        },
      });
    }
  };

  // Hook must be called before any conditional returns
  const { rate: exchangeRate, hasRate } = useExchangeRate();

  if (isLoading) return <div className="text-white">Carregando assistente...</div>;

  // Calculate accurate pricing (only show total if recipients are selected AND we have exchange rate)
  const pricing = selectedTemplate && recipientCount > 0 && hasRate
    ? getPricingBreakdown(selectedTemplate.category, recipientCount, 0, exchangeRate!)
    : { totalBRLFormatted: 'R$ --', pricePerMessageBRLFormatted: 'R$ --' };

  // Price per message for display in Step 1
  const pricePerMessage = selectedTemplate && hasRate
    ? getPricingBreakdown(selectedTemplate.category, 1, 0, exchangeRate!).pricePerMessageBRLFormatted
    : 'R$ --';

  const steps = [
    { number: 1, title: 'Configuração & Template' },
    { number: 2, title: 'Público' },
    { number: 3, title: 'Revisão & Lançamento' },
  ];

  return (
    <div className="h-full flex flex-col px-6 lg:px-10 py-4">
      {/* Header Navigation */}
      <div className="shrink-0 mb-4">
        <PrefetchLink href="/campaigns" className="text-xs text-gray-500 hover:text-white inline-flex items-center gap-1 transition-colors">
          <ChevronLeft size={12} /> Voltar para Campanhas
        </PrefetchLink>
      </div>

      {/* Main Bar: Title, Stepper, Cost */}
      <div className="flex items-center justify-between shrink-0 mb-8 gap-8">
        {/* Title */}
        <div className="shrink-0">
          <h1 className="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
            Criar Campanha <span className="text-sm font-normal text-gray-500 bg-zinc-900 px-3 py-1 rounded-full border border-white/10">Rascunho</span>
          </h1>
        </div>

        {/* Centralized Stepper */}
        <div className="hidden lg:block flex-1 max-w-2xl px-8">
          <div className="flex items-center justify-between relative">
            <div className="absolute left-0 top-4 transform -translate-y-1/2 w-full h-0.5 bg-zinc-800 -z-10" aria-hidden="true">
              <div
                className="h-full bg-primary-600 transition-all duration-500 ease-out"
                style={{ width: `${((step - 1) / 2) * 100}%` }}
              ></div>
            </div>
            {steps.map((s) => (
              <button
                type="button"
                key={s.number}
                className="flex flex-col items-center group"
                onClick={() => step > s.number && setStep(s.number)}
                disabled={step <= s.number}
                aria-current={step === s.number ? 'step' : undefined}
                aria-label={`${s.title}${step > s.number ? ' - concluído, clique para voltar' : step === s.number ? ' - etapa atual' : ' - etapa futura'}`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm mb-2 transition-all duration-300 border-2 ${step >= s.number
                    ? 'bg-zinc-950 text-primary-400 border-primary-500 shadow-[0_0_15px_rgba(16,185,129,0.4)] scale-110'
                    : 'bg-zinc-950 text-gray-600 border-zinc-800 group-hover:border-zinc-700'
                    }`}
                  aria-hidden="true"
                >
                  {step > s.number ? <Check size={14} strokeWidth={3} /> : s.number}
                </div>
                <span className={`text-[10px] font-bold uppercase tracking-widest transition-colors ${step >= s.number ? 'text-white' : 'text-gray-600'}`}>
                  {s.title}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Cost Info */}
        <div className="text-right hidden md:block shrink-0 min-w-[120px]">
          {step === 1 && selectedTemplate ? (
            <>
              <p className="text-xs text-gray-500">Custo Base</p>
              <p className="text-xl font-bold text-primary-400">{pricePerMessage}/msg</p>
              <p className="text-[10px] text-gray-600 mt-1">{selectedTemplate.category}</p>
            </>
          ) : recipientCount > 0 && selectedTemplate ? (
            <>
              <p className="text-xs text-gray-500">Custo Estimado</p>
              <p className="text-xl font-bold text-primary-400">{pricing.totalBRLFormatted}</p>
              <p className="text-[10px] text-gray-600 mt-1">
                {pricing.pricePerMessageBRLFormatted}/msg • {selectedTemplate.category}
              </p>
            </>
          ) : (
            <>
              <p className="text-xs text-gray-500">Custo Estimado</p>
              <p className="text-xl font-bold text-gray-600">-</p>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Content - Form Area */}
        <div className="flex flex-col min-h-0 lg:col-span-9">
          <div className="glass-panel rounded-2xl flex-1 min-h-0 flex flex-col relative overflow-hidden">
            {/* Step 1: Setup & Template */}
            {step === 1 && (
              <div className="flex-1 min-h-0 flex flex-col space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500 overflow-auto p-6">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 ml-1">Nome da Campanha</label>
                  <input
                    type="text"
                    className="w-full px-5 py-4 bg-zinc-900 border border-white/10 rounded-xl focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500/50 outline-none transition-all text-white placeholder-gray-600 text-lg font-medium"
                    placeholder="ex: Promoção de Verão"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-4 ml-1">
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Selecione o Template</label>
                    <PrefetchLink href="/templates" className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1">
                      <RefreshCw size={12} /> Gerenciar Templates
                    </PrefetchLink>
                  </div>

                  {/* Search bar - only show when no template is selected */}
                  {!selectedTemplateId && availableTemplates.length > 3 && (
                    <div className="relative mb-4">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                      <input
                        type="text"
                        placeholder="Buscar template por nome, conteúdo ou categoria..."
                        value={templateSearch}
                        onChange={(e) => setTemplateSearch(e.target.value)}
                        className="w-full pl-11 pr-4 py-3 bg-zinc-900 border border-white/20 rounded-xl focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500/50 outline-none transition-all text-white placeholder-gray-500 text-sm"
                      />
                      {templateSearch && (
                        <button
                          onClick={() => setTemplateSearch('')}
                          className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors"
                        >
                          <X size={16} />
                        </button>
                      )}
                    </div>
                  )}

                  {/* Selected template indicator with change button */}
                  {selectedTemplateId && (
                    <div className="mb-4 flex items-center justify-between p-3 bg-primary-500/10 border border-primary-500/30 rounded-xl">
                      <div className="flex items-center gap-2">
                        <Check className="text-primary-400" size={16} />
                        <span className="text-sm text-primary-400">Template selecionado</span>
                      </div>
                      <button
                        onClick={() => {
                          setSelectedTemplateId('');
                          setTemplateSearch('');
                        }}
                        className="text-xs text-gray-400 hover:text-white transition-colors flex items-center gap-1"
                      >
                        <RefreshCw size={12} /> Trocar template
                      </button>
                    </div>
                  )}

                  <div className="space-y-2 flex-1 min-h-0 overflow-y-auto pr-2 custom-scrollbar">
                    {availableTemplates.length === 0 && (
                      <div className="text-center p-8 border border-dashed border-white/10 rounded-xl">
                        <p className="text-gray-500 mb-2">Nenhum template aprovado encontrado.</p>
                        <PrefetchLink href="/templates" className="text-primary-400 text-sm hover:underline">Sincronizar Templates</PrefetchLink>
                      </div>
                    )}
                    {filteredTemplates.length === 0 && availableTemplates.length > 0 && !selectedTemplateId && (
                      <div className="text-center p-8 border border-dashed border-white/10 rounded-xl">
                        <p className="text-gray-500 mb-2">Nenhum template encontrado para &ldquo;{templateSearch}&rdquo;</p>
                        <button
                          onClick={() => setTemplateSearch('')}
                          className="text-primary-400 text-sm hover:underline"
                        >
                          Limpar busca
                        </button>
                      </div>
                    )}
                    {filteredTemplates.map((t) => (
                      <div
                        key={t.id}
                        onClick={() => setSelectedTemplateId(t.id)}
                        onMouseEnter={() => setHoveredTemplateId(t.id)}
                        onMouseLeave={() => setHoveredTemplateId(null)}
                        className={`relative border rounded-xl p-4 cursor-pointer transition-all duration-200 group flex items-start gap-4 ${selectedTemplateId === t.id
                          ? 'border-primary-500 bg-primary-500/10 ring-1 ring-primary-500'
                          : hoveredTemplateId === t.id
                            ? 'border-primary-400/50 bg-primary-500/5'
                            : 'border-white/10 bg-zinc-900/50 hover:border-white/20 hover:bg-zinc-900'
                          }`}
                      >
                        {/* Radio indicator */}
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all ${selectedTemplateId === t.id
                          ? 'border-primary-500 bg-primary-500'
                          : 'border-zinc-600 bg-transparent group-hover:border-zinc-500'
                          }`}>
                          {selectedTemplateId === t.id && (
                            <div className="w-2 h-2 rounded-full bg-black" />
                          )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <h3 className={`font-semibold text-sm truncate ${selectedTemplateId === t.id ? 'text-white' : 'text-gray-200'}`}>
                              {t.name}
                            </h3>
                            <span className="text-[10px] text-gray-500 font-mono uppercase tracking-wider ml-2 flex-shrink-0">{t.category}</span>
                          </div>
                          <p className={`text-sm line-clamp-2 leading-relaxed transition-colors ${selectedTemplateId === t.id ? 'text-gray-300' : 'text-gray-500 group-hover:text-gray-400'}`}>
                            {t.content.split(/(\{\{.*?\}\})/).map((part, i) =>
                              part.match(/^\{\{.*?\}\}$/) ? (
                                <span key={i} className="font-medium text-primary-400/80">{part}</span>
                              ) : (
                                part
                              )
                            )}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Template Variables Section - Shows when template has extra variables */}
                {selectedTemplate && templateVariableInfo && templateVariableInfo.totalExtra > 0 && (
                  <div className="mt-8 p-6 bg-primary-500/5 border border-primary-500/20 rounded-xl animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="flex items-start gap-3 mb-4">
                      <div className="p-2 bg-primary-500/20 rounded-lg">
                        <Sparkles className="text-primary-400" size={18} />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-white">Variáveis do Template</h3>
                        <p className="text-xs text-gray-400 mt-1">
                          Preencha os valores que serão usados neste template.
                          Esses valores serão <span className="text-white">iguais para todos</span> os destinatários.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      {/* HEADER Variables - shown FIRST since header appears first in template */}
                      {templateVariableInfo.header.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs text-gray-500 uppercase font-bold tracking-wider flex items-center gap-2">
                            <Eye size={14} /> Variáveis do Cabeçalho
                          </p>
                          {templateVariableInfo.header.map((varInfo, idx) => (
                            <div key={`header-${idx}`} className="flex items-center gap-3">
                              <span className="w-12 text-center text-xs font-mono bg-amber-500/20 text-amber-400 px-1.5 py-1 rounded shrink-0">
                                {varInfo.placeholder}
                              </span>
                              <div className="flex-1 relative flex items-center">
                                <input
                                  type="text"
                                  value={templateVariables.header[idx] || ''}
                                  onChange={(e) => {
                                    const newHeader = [...templateVariables.header];
                                    newHeader[idx] = e.target.value;
                                    setTemplateVariables({ ...templateVariables, header: newHeader });
                                  }}
                                  placeholder={varInfo.context}
                                  className="w-full pl-4 pr-10 py-2 bg-zinc-900/50 border border-white/10 rounded-lg focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 outline-none transition-all text-white text-sm placeholder-gray-600"
                                />

                                {/* Variable Picker - Header version */}
                                <div className="absolute right-2 top-1/2 -translate-y-1/2">
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <button
                                        className="p-1 hover:bg-white/10 text-gray-400 hover:text-amber-400 rounded-md transition-colors outline-none"
                                        title="Inserir Variável Dinâmica"
                                      >
                                        <Braces size={14} />
                                      </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="bg-zinc-900 border-zinc-800 text-white min-w-[200px]">
                                      <DropdownMenuLabel className="text-xs text-gray-500 uppercase tracking-wider px-2 py-1.5">
                                        Dados do Contato
                                      </DropdownMenuLabel>
                                      <DropdownMenuItem
                                        className="text-sm cursor-pointer hover:bg-zinc-800 focus:bg-zinc-800 px-2 py-1.5 rounded-sm flex items-center gap-2 outline-none"
                                        onClick={() => {
                                          const newHeader = [...templateVariables.header];
                                          newHeader[idx] = '{{nome}}';
                                          setTemplateVariables({ ...templateVariables, header: newHeader });
                                        }}
                                      >
                                        <Users size={14} className="text-indigo-400" />
                                        <span>Nome</span>
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        className="text-sm cursor-pointer hover:bg-zinc-800 focus:bg-zinc-800 px-2 py-1.5 rounded-sm flex items-center gap-2 outline-none"
                                        onClick={() => {
                                          const newHeader = [...templateVariables.header];
                                          newHeader[idx] = '{{telefone}}';
                                          setTemplateVariables({ ...templateVariables, header: newHeader });
                                        }}
                                      >
                                        <div className="text-green-400 font-mono text-[10px] w-3.5 text-center">Ph</div>
                                        <span>Telefone</span>
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        className="text-sm cursor-pointer hover:bg-zinc-800 focus:bg-zinc-800 px-2 py-1.5 rounded-sm flex items-center gap-2 outline-none"
                                        onClick={() => {
                                          const newHeader = [...templateVariables.header];
                                          newHeader[idx] = '{{email}}';
                                          setTemplateVariables({ ...templateVariables, header: newHeader });
                                        }}
                                      >
                                        <div className="text-blue-400 font-mono text-[10px] w-3.5 text-center">@</div>
                                        <span>Email</span>
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator className="bg-white/10 my-1" />

                                      {customFields.length > 0 && (
                                        <>
                                          <DropdownMenuLabel className="text-xs text-gray-500 uppercase tracking-wider px-2 py-1.5 mt-2">
                                            Campos Personalizados
                                          </DropdownMenuLabel>
                                          {customFields.map(field => (
                                            <DropdownMenuItem
                                              key={field.id}
                                              className="text-sm cursor-pointer hover:bg-zinc-800 focus:bg-zinc-800 px-2 py-1.5 rounded-sm flex items-center gap-2 outline-none"
                                              onClick={() => {
                                                const newHeader = [...templateVariables.header];
                                                newHeader[idx] = `{{${field.key}}}`;
                                                setTemplateVariables({ ...templateVariables, header: newHeader });
                                              }}
                                            >
                                              <div className="text-amber-400 font-mono text-[10px] w-3.5 text-center">#</div>
                                              <span>{field.label}</span>
                                            </DropdownMenuItem>
                                          ))}
                                          <DropdownMenuSeparator className="bg-white/10 my-1" />
                                        </>
                                      )}

                                      <DropdownMenuItem
                                        className="text-xs text-amber-400 hover:text-amber-300 px-2 py-1.5 cursor-pointer flex items-center gap-2"
                                        onSelect={(e) => {
                                          e.preventDefault();
                                          setIsFieldsSheetOpen(true);
                                        }}
                                      >
                                        <Plus size={12} /> Gerenciar Campos
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              </div>
                              {!templateVariables.header[idx] ? (
                                <span className="text-xs text-amber-400">obrigatório</span>
                              ) : (
                                <Check size={16} className="text-primary-400" />
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* BODY Variables - shown AFTER header */}
                      {templateVariableInfo.body.length > 0 && (
                        <div className={`space-y-2 ${templateVariableInfo.header.length > 0 ? 'pt-2 border-t border-white/5' : ''}`}>
                          <p className="text-xs text-gray-500 uppercase font-bold tracking-wider flex items-center gap-2">
                            <MessageSquare size={14} /> Variáveis do Corpo
                          </p>
                          {templateVariableInfo.body.map((varInfo, idx) => {
                            const value = templateVariables.body[idx] || '';

                            return (
                              <div key={`body-${idx}`} className="flex items-center gap-3">
                                <span className="w-12 text-center text-xs font-mono bg-amber-500/20 text-amber-400 px-1.5 py-1 rounded shrink-0">
                                  {varInfo.placeholder}
                                </span>
                                <div className="flex-1 relative flex items-center">
                                  <input
                                    type="text"
                                    value={value}
                                    onChange={(e) => {
                                      const newBody = [...templateVariables.body];
                                      newBody[idx] = e.target.value;
                                      setTemplateVariables({ ...templateVariables, body: newBody });
                                    }}
                                    placeholder={varInfo.context}
                                    className="w-full pl-4 pr-10 py-2 bg-zinc-900/50 border border-white/10 rounded-lg focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 outline-none transition-all text-white text-sm placeholder-gray-600"
                                  />

                                  {/* Variable Picker - Clean Style */}
                                  <div className="absolute right-2 top-1/2 -translate-y-1/2">
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <button
                                          className="p-1 hover:bg-white/10 text-gray-400 hover:text-amber-400 rounded-md transition-colors outline-none"
                                          title="Inserir Variável Dinâmica"
                                        >
                                          <Braces size={14} />
                                        </button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end" className="bg-zinc-900 border-zinc-800 text-white min-w-[200px]">
                                        <DropdownMenuLabel className="text-xs text-gray-500 uppercase tracking-wider px-2 py-1.5">
                                          Dados do Contato
                                        </DropdownMenuLabel>

                                        <DropdownMenuItem
                                          className="text-sm cursor-pointer hover:bg-zinc-800 focus:bg-zinc-800 px-2 py-1.5 rounded-sm flex items-center gap-2 outline-none"
                                          onClick={() => {
                                            const newBody = [...templateVariables.body];
                                            newBody[idx] = '{{nome}}';
                                            setTemplateVariables({ ...templateVariables, body: newBody });
                                          }}
                                        >
                                          <Users size={14} className="text-indigo-400" />
                                          <span>Nome</span>
                                        </DropdownMenuItem>

                                        <DropdownMenuItem
                                          className="text-sm cursor-pointer hover:bg-zinc-800 focus:bg-zinc-800 px-2 py-1.5 rounded-sm flex items-center gap-2 outline-none"
                                          onClick={() => {
                                            const newBody = [...templateVariables.body];
                                            newBody[idx] = '{{telefone}}';
                                            setTemplateVariables({ ...templateVariables, body: newBody });
                                          }}
                                        >
                                          <div className="text-green-400 font-mono text-[10px] w-3.5 text-center">Ph</div>
                                          <span>Telefone</span>
                                        </DropdownMenuItem>

                                        <DropdownMenuItem
                                          className="text-sm cursor-pointer hover:bg-zinc-800 focus:bg-zinc-800 px-2 py-1.5 rounded-sm flex items-center gap-2 outline-none"
                                          onClick={() => {
                                            const newBody = [...templateVariables.body];
                                            newBody[idx] = '{{email}}';
                                            setTemplateVariables({ ...templateVariables, body: newBody });
                                          }}
                                        >
                                          <div className="text-blue-400 font-mono text-[10px] w-3.5 text-center">@</div>
                                          <span>Email</span>
                                        </DropdownMenuItem>

                                        <DropdownMenuSeparator className="bg-white/10 my-1" />

                                        {customFields.length > 0 && (
                                          <>
                                            <DropdownMenuLabel className="text-xs text-gray-500 uppercase tracking-wider px-2 py-1.5 mt-2">
                                              Campos Personalizados
                                            </DropdownMenuLabel>
                                            {customFields.map(field => (
                                              <DropdownMenuItem
                                                key={field.id}
                                                className="text-sm cursor-pointer hover:bg-zinc-800 focus:bg-zinc-800 px-2 py-1.5 rounded-sm flex items-center gap-2 outline-none"
                                                onClick={() => {
                                                  const newBody = [...templateVariables.body];
                                                  newBody[idx] = `{{${field.key}}}`;
                                                  setTemplateVariables({ ...templateVariables, body: newBody });
                                                }}
                                              >
                                                <div className="text-amber-400 font-mono text-[10px] w-3.5 text-center">#</div>
                                                <span>{field.label}</span>
                                              </DropdownMenuItem>
                                            ))}
                                            <DropdownMenuSeparator className="bg-white/10 my-1" />
                                          </>
                                        )}

                                        <DropdownMenuItem
                                          className="text-xs text-amber-400 hover:text-amber-300 px-2 py-1.5 cursor-pointer flex items-center gap-2"
                                          onSelect={(e) => {
                                            e.preventDefault();
                                            setIsFieldsSheetOpen(true);
                                          }}
                                        >
                                          <Plus size={12} /> Gerenciar Campos
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                </div>
                                {!value ? (
                                  <span className="text-xs text-amber-400">obrigatório</span>
                                ) : (
                                  <Check size={16} className="text-primary-400" />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* BUTTON URL Variables */}
                      {templateVariableInfo.buttons.length > 0 && (
                        <div className="space-y-2 pt-2 border-t border-white/5">
                          <p className="text-xs text-gray-500 uppercase font-bold tracking-wider flex items-center gap-2">
                            <ExternalLink size={12} /> URLs Dinâmicas dos Botões
                          </p>
                          {templateVariableInfo.buttons.map((varInfo, idx) => {
                            const bodyVarsCount = templateVariableInfo.body.filter(b => b.index > 1).length;
                            const headerVarsCount = templateVariableInfo.header.length;
                            const varIndex = bodyVarsCount + headerVarsCount + idx;
                            return (
                              <div key={`button-${varInfo.buttonIndex}`} className="flex items-center gap-3">
                                <span className="w-auto min-w-[48px] text-center text-xs font-mono bg-amber-500/20 text-amber-400 px-2 py-1.5 rounded">
                                  {`Botão ${varInfo.buttonIndex + 1}`}
                                </span>
                                <input
                                  type="text"
                                  value={templateVariables.buttons?.[`button_${varInfo.buttonIndex}_0`] || ''}
                                  onChange={(e) => {
                                    setTemplateVariables({
                                      ...templateVariables,
                                      buttons: {
                                        ...templateVariables.buttons,
                                        [`button_${varInfo.buttonIndex}_0`]: e.target.value
                                      }
                                    });
                                  }}
                                  placeholder={`Parte dinâmica da URL do botão "${varInfo.buttonText}"`}
                                  className="flex-1 px-4 py-2 bg-zinc-900/50 border border-white/10 rounded-lg focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 outline-none transition-all text-white text-sm placeholder-gray-600"
                                />
                                {!templateVariables.buttons?.[`button_${varInfo.buttonIndex}_0`] ? (
                                  <span className="text-xs text-amber-400">obrigatório</span>
                                ) : (
                                  <Check size={16} className="text-amber-400" />
                                )}
                              </div>
                            );
                          })}
                          <p className="text-xs text-gray-500 mt-1 flex items-center gap-1.5 pl-1">
                            <AlertCircle size={11} />
                            Ex: Se a URL é <code className="bg-zinc-800 px-1 rounded">zoom.us/j/{'{{1}}'}</code>, preencha apenas o ID da reunião
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Step 2: Recipients */}
            {step === 2 && (
              <div className="flex-1 min-h-0 flex flex-col space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500 overflow-auto p-6 pb-8">
                <div className="text-center mb-4 shrink-0">
                  <h2 className="text-2xl font-bold text-white mb-2">Escolha seu Público</h2>
                  <p className="text-gray-400">Quem deve receber esta campanha?</p>
                </div>

                {/* Test Contact Card - Always visible if configured */}
                {testContact && (
                  <div className="mb-4">
                    <button
                      onClick={() => setRecipientSource('test')}
                      className={`relative w-full p-4 rounded-2xl border transition-all duration-200 flex items-center gap-4 ${recipientSource === 'test'
                        ? 'bg-amber-500 text-black border-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.3)]'
                        : 'bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/20 hover:border-amber-500/50 text-amber-300'
                        }`}
                    >
                      {recipientSource === 'test' && (
                        <div className="absolute top-3 right-3 text-black">
                          <CheckCircleFilled size={18} />
                        </div>
                      )}
                      <div className={`p-3 rounded-xl ${recipientSource === 'test'
                        ? 'bg-black/20 text-black'
                        : 'bg-amber-500/20 text-amber-400'
                        }`}>
                        <FlaskConical size={20} />
                      </div>
                      <div className="flex-1 text-left">
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-sm">Enviar para Contato de Teste</h3>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${recipientSource === 'test' ? 'bg-black/20' : 'bg-amber-500/20'
                            }`}>
                            RECOMENDADO
                          </span>
                        </div>
                        <p className={`text-xs mt-0.5 ${recipientSource === 'test' ? 'text-black/70' : 'text-amber-400/70'}`}>
                          {testContact.name || 'Contato de Teste'} • +{testContact.phone}
                        </p>
                      </div>
                      {recipientSource === 'test' && selectedTemplate && (
                        <div className="text-right">
                          <p className="text-xs font-bold text-black">
                            {getPricingBreakdown(selectedTemplate.category, 1, 0, exchangeRate ?? 5.00).totalBRLFormatted}
                          </p>
                        </div>
                      )}
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* All Contacts - Shows error style when exceeds limit */}
                  <button
                    onClick={() => setRecipientSource('all')}
                    className={`relative p-6 rounded-2xl border transition-all duration-200 flex flex-col items-center justify-center gap-4 ${recipientSource === 'all' && totalContacts > currentLimit
                      ? 'bg-red-500/10 text-red-300 border-red-500/50 scale-105'
                      : recipientSource === 'all'
                        ? 'bg-white text-black border-white shadow-[0_0_20px_rgba(255,255,255,0.1)] scale-105'
                        : totalContacts > currentLimit
                          ? 'bg-zinc-900/50 border-red-500/30 text-gray-400 opacity-60'
                          : 'bg-zinc-900/50 border-white/10 hover:bg-zinc-900 hover:border-white/20 text-gray-300'
                      }`}
                  >
                    {recipientSource === 'all' && totalContacts <= currentLimit && (
                      <div className="absolute top-3 right-3 text-black">
                        <CheckCircleFilled size={20} />
                      </div>
                    )}
                    {totalContacts > currentLimit && (
                      <div className="absolute top-3 right-3 text-red-400">
                        <ShieldAlert size={18} />
                      </div>
                    )}
                    <div className={`p-4 rounded-full ${totalContacts > currentLimit
                      ? 'bg-red-500/20 text-red-400'
                      : recipientSource === 'all'
                        ? 'bg-gray-200 text-black'
                        : 'bg-zinc-800 text-gray-400'
                      }`}>
                      <Users size={24} />
                    </div>
                    <div className="text-center">
                      <h3 className="font-bold text-sm">Todos os Contatos</h3>
                      <p className={`text-xs mt-1 ${totalContacts > currentLimit ? 'text-red-400' : recipientSource === 'all' ? 'text-gray-600' : 'text-gray-500'}`}>
                        {totalContacts} contatos
                      </p>
                      {totalContacts > currentLimit ? (
                        <p className="text-xs mt-2 font-bold text-red-400">
                          Excede limite ({currentLimit})
                        </p>
                      ) : recipientSource === 'all' && selectedTemplate ? (
                        <p className="text-xs mt-2 font-bold text-primary-600">
                          {getPricingBreakdown(selectedTemplate.category, totalContacts, 0, exchangeRate ?? 5.00).totalBRLFormatted}
                        </p>
                      ) : null}
                    </div>
                  </button>

                  {/* Select Specific - Highlighted as solution when All exceeds */}
                  <button
                    onClick={() => setRecipientSource('specific')}
                    className={`relative p-6 rounded-2xl border transition-all duration-200 flex flex-col items-center justify-center gap-4 ${recipientSource === 'specific'
                      ? 'bg-white text-black border-white shadow-[0_0_20px_rgba(255,255,255,0.1)] scale-105'
                      : totalContacts > currentLimit && recipientSource === 'all'
                        ? 'bg-primary-500/10 border-primary-500/50 text-primary-300 hover:bg-primary-500/20 ring-2 ring-primary-500/30'
                        : 'bg-zinc-900/50 border-white/10 hover:bg-zinc-900 hover:border-white/20 text-gray-300'
                      }`}
                  >
                    {recipientSource === 'specific' && (
                      <div className="absolute top-3 right-3 text-black">
                        <CheckCircleFilled size={20} />
                      </div>
                    )}
                    {totalContacts > currentLimit && recipientSource !== 'specific' && (
                      <div className="absolute top-3 right-3 text-primary-400">
                        <Sparkles size={18} />
                      </div>
                    )}
                    <div className={`p-4 rounded-full ${recipientSource === 'specific'
                      ? 'bg-gray-200 text-black'
                      : totalContacts > currentLimit
                        ? 'bg-primary-500/20 text-primary-400'
                        : 'bg-zinc-800 text-gray-400'
                      }`}>
                      <Smartphone size={24} />
                    </div>
                    <div className="text-center">
                      <h3 className="font-bold text-sm">
                        {totalContacts > currentLimit && recipientSource !== 'specific' ? '✨ Selecionar Específicos' : 'Selecionar Específicos'}
                      </h3>
                      <p className={`text-xs mt-1 ${totalContacts > currentLimit && recipientSource !== 'specific'
                        ? 'text-primary-400 font-medium'
                        : recipientSource === 'specific'
                          ? 'text-gray-600'
                          : 'text-gray-500'
                        }`}>
                        {recipientSource === 'specific'
                          ? `${recipientCount} selecionados`
                          : totalContacts > currentLimit
                            ? `Selecione até ${currentLimit}`
                            : 'Escolher contatos'
                        }
                      </p>
                      {recipientSource === 'specific' && selectedTemplate && recipientCount > 0 && (
                        <p className="text-xs mt-2 font-bold text-primary-600">
                          {getPricingBreakdown(selectedTemplate.category, recipientCount, 0, exchangeRate ?? 5.00).totalBRLFormatted}
                        </p>
                      )}
                    </div>
                  </button>
                </div>

                {/* Contact Selection List */}
                {recipientSource === 'specific' && (
                  <div className="bg-zinc-900/50 border border-white/10 rounded-xl p-6 mt-6 animate-in zoom-in duration-300">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-white font-bold text-sm">Seus Contatos</h4>
                      <span className="text-xs text-gray-500">{recipientCount}/{totalContacts} selecionados</span>
                    </div>

                    {/* Search Input */}
                    <div className="relative mb-4">
                      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                      <input
                        type="text"
                        placeholder="Buscar por nome, telefone, email ou tags..."
                        value={contactSearchTerm}
                        onChange={(e) => setContactSearchTerm(e.target.value)}
                        className="w-full bg-zinc-800 border border-white/10 rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-primary-500 transition-colors"
                      />
                      {contactSearchTerm && (
                        <button
                          onClick={() => setContactSearchTerm('')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>

                    <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar">
                      {filteredContacts.length === 0 ? (
                        <p className="text-gray-500 text-sm text-center py-8">
                          {contactSearchTerm ? 'Nenhum contato encontrado para esta busca' : 'Nenhum contato encontrado'}
                        </p>
                      ) : (
                        filteredContacts.map((contact) => {
                          const isSelected = selectedContactIds.includes(contact.id);
                          return (
                            <label
                              key={contact.id}
                              className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all ${isSelected
                                ? 'bg-primary-500/10 border border-primary-500/30'
                                : 'bg-zinc-800/50 border border-transparent hover:bg-zinc-800'
                                }`}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleContact(contact.id)}
                                className="w-4 h-4 text-primary-600 bg-zinc-700 border-zinc-600 rounded focus:ring-primary-500"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-white truncate">{contact.name || contact.phone}</p>
                                <p className="text-xs text-gray-500 font-mono">{contact.phone}</p>
                              </div>
                              {isSelected && (
                                <Check size={16} className="text-primary-400 flex-shrink-0" />
                              )}
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}

                {/* ⚠️ CONSOLIDATED LIMIT WARNING - Everything user needs to know */}
                {recipientCount > 0 && isOverLimit && liveValidation && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-5 space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="flex gap-3">
                      <ShieldAlert className="text-red-400 flex-shrink-0 mt-0.5" size={22} />
                      <div className="flex-1">
                        <p className="font-bold text-red-400 text-base mb-1">⛔ Limite Excedido</p>
                        <p className="text-sm text-red-200/80">
                          Você selecionou <span className="font-bold text-white">{recipientCount}</span> contatos,
                          mas seu limite atual é de <span className="font-bold text-white">{currentLimit}</span> mensagens/dia.
                        </p>
                      </div>
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-3 gap-3 bg-black/20 rounded-lg p-3">
                      <div className="text-center">
                        <p className="text-lg font-bold text-white">{recipientCount}</p>
                        <p className="text-[10px] text-gray-500 uppercase">Selecionados</p>
                      </div>
                      <div className="text-center border-x border-white/10">
                        <p className="text-lg font-bold text-primary-400">{currentLimit}</p>
                        <p className="text-[10px] text-gray-500 uppercase">Seu Limite</p>
                      </div>
                      <div className="text-center">
                        <p className="text-lg font-bold text-red-400">+{recipientCount - currentLimit}</p>
                        <p className="text-[10px] text-gray-500 uppercase">Excedente</p>
                      </div>
                    </div>

                    {/* Solutions */}
                    <div className="space-y-2">
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">O que você pode fazer:</p>
                      <div className="flex items-center gap-2 text-sm text-gray-300">
                        <span className="w-5 h-5 rounded-full bg-zinc-800 flex items-center justify-center text-xs">1</span>
                        Reduza a seleção para no máximo <span className="font-bold text-primary-400">{currentLimit}</span> contatos
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-300">
                        <span className="w-5 h-5 rounded-full bg-zinc-800 flex items-center justify-center text-xs">2</span>
                        Divida em {Math.ceil(recipientCount / currentLimit)} campanhas menores
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-300">
                        <span className="w-5 h-5 rounded-full bg-primary-500/30 flex items-center justify-center text-xs text-primary-400">✦</span>
                        <button
                          onClick={() => setShowUpgradeModal(true)}
                          className="text-primary-400 hover:text-primary-300 underline"
                        >
                          Saiba como aumentar seu limite →
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Step 3: Review */}
            {step === 3 && (
              <div className="flex-1 min-h-0 flex flex-col space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500 overflow-auto p-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-5 bg-zinc-900/50 border border-white/5 rounded-xl">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Custo Total</p>
                    <p className="text-2xl font-bold text-white">{pricing.totalBRLFormatted}</p>
                    {selectedTemplate && (
                      <p className="text-xs text-gray-500 mt-1">
                        {pricing.pricePerMessageBRLFormatted} × {recipientCount} msgs
                      </p>
                    )}
                  </div>
                  <div className="p-5 bg-zinc-900/50 border border-white/5 rounded-xl">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Total Destinatários</p>
                    <p className="text-2xl font-bold text-white">{recipientCount}</p>
                  </div>
                </div>

                <div className="border-t border-white/5 pt-6 space-y-4">
                  <h3 className="text-sm font-bold text-white mb-4">Detalhes da Campanha</h3>

                  <div className="flex items-center justify-between group">
                    <span className="text-sm text-gray-500">Nome da Campanha</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white">{name}</span>
                      <button onClick={() => setStep(1)} className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-primary-400 transition-all"><small>Editar</small></button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between group">
                    <span className="text-sm text-gray-500">Template</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white font-mono bg-zinc-900 px-2 py-1 rounded text-xs">{selectedTemplateId}</span>
                      <button onClick={() => setStep(1)} className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-primary-400 transition-all"><small>Editar</small></button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between group">
                    <span className="text-sm text-gray-500">Público</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white">
                        {recipientSource === 'test'
                          ? `🧪 Contato de Teste (${testContact?.name})`
                          : recipientSource === 'all'
                            ? 'Todos os Contatos'
                            : 'Contatos Selecionados'
                        } ({recipientCount})
                      </span>
                      <button onClick={() => setStep(2)} className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-primary-400 transition-all"><small>Editar</small></button>
                    </div>
                  </div>
                </div>

                <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 flex gap-3">
                  <AlertCircle className="text-amber-500 flex-shrink-0" size={20} />
                  <div className="text-xs text-amber-200/70">
                    <p className="font-bold text-amber-500 mb-1">Checagem Final</p>
                    <p>Ao clicar em disparar, você confirma que todos os destinatários aceitaram receber mensagens do seu negócio.</p>
                  </div>
                </div>

                {/* Pré-check (dry-run) */}
                <div className="bg-zinc-900/50 border border-white/10 rounded-xl p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <ShieldAlert size={16} className="text-primary-400" />
                      <h3 className="text-sm font-bold text-white">Pré-check de destinatários</h3>
                    </div>

                    <button
                      type="button"
                      onClick={() => handlePrecheck()}
                      disabled={!!isPrechecking}
                      className={`px-4 py-2 rounded-lg text-sm font-bold border transition-colors flex items-center gap-2 ${isPrechecking
                        ? 'bg-zinc-800 border-white/10 text-gray-400'
                        : 'bg-white text-black border-white hover:bg-gray-200'
                        }`}
                      title="Valida telefones + variáveis do template sem criar campanha"
                    >
                      {isPrechecking ? (
                        <>
                          <RefreshCw size={14} className="animate-spin" /> Validando...
                        </>
                      ) : (
                        <>
                          <CheckCircle size={14} /> Validar agora
                        </>
                      )}
                    </button>
                  </div>

                  {precheckResult?.totals && (
                    <div className="mt-3 text-xs text-gray-400 space-y-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-emerald-400 font-bold">Válidos: {precheckResult.totals.valid}</span>
                        <span className="text-amber-400 font-bold">Serão ignorados: {precheckResult.totals.skipped}</span>
                        <span className="text-gray-500">Total: {precheckResult.totals.total}</span>
                      </div>

                      {/* Pré-check alterável (Parte 2): ações rápidas para resolver variáveis faltantes */}
                      {missingSummary.length > 0 && (
                        <div className="bg-zinc-950/30 border border-white/5 rounded-lg p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-gray-200 font-medium">Ajustes rápidos</p>
                              <p className="text-[11px] text-gray-500">
                                Estes itens estão causando <span className="text-amber-300">skips</span> por variável sem valor. Você pode preencher aqui e clicar em <span className="text-white">Validar agora</span> de novo.
                              </p>
                            </div>
                          </div>

                          <div className="mt-3 space-y-2">
                            {missingSummary.slice(0, 6).map((m) => {
                              const label = m.where === 'button'
                                ? `Botão ${Number(m.buttonIndex) + 1} • {{${m.key}}}`
                                : `${m.where === 'header' ? 'Cabeçalho' : 'Corpo'} • {{${m.key}}}`;

                              return (
                                <div key={`${m.where}:${m.buttonIndex ?? ''}:${m.key}`} className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between bg-zinc-900/40 border border-white/5 rounded-lg p-2">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="text-[11px] font-bold text-gray-200 truncate">{label}</span>
                                      <span className="text-[10px] text-amber-300">afetou {m.count}</span>
                                    </div>
                                    {m.rawSamples.size > 0 && (
                                      <p className="text-[10px] text-gray-500 truncate">
                                        raw: {Array.from(m.rawSamples).slice(0, 2).join(' • ')}
                                      </p>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-2 shrink-0">
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <button
                                          type="button"
                                          className="px-3 py-1.5 rounded-md text-[11px] font-bold bg-white/10 hover:bg-white/15 border border-white/10 text-gray-200"
                                          title="Preencher esta variável"
                                        >
                                          Preencher com…
                                        </button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end" className="bg-zinc-900 border-zinc-800 text-white min-w-[220px]">
                                        <DropdownMenuLabel className="text-xs text-gray-500 uppercase tracking-wider px-2 py-1.5">
                                          Dados do Contato
                                        </DropdownMenuLabel>

                                        <DropdownMenuItem
                                          className="text-sm cursor-pointer hover:bg-zinc-800 focus:bg-zinc-800 px-2 py-1.5 rounded-sm flex items-center gap-2 outline-none"
                                          onClick={() => applyQuickFill({ where: m.where, key: m.key, buttonIndex: m.buttonIndex }, '{{nome}}')}
                                        >
                                          <Users size={14} className="text-indigo-400" />
                                          <span>Nome</span>
                                        </DropdownMenuItem>

                                        <DropdownMenuItem
                                          className="text-sm cursor-pointer hover:bg-zinc-800 focus:bg-zinc-800 px-2 py-1.5 rounded-sm flex items-center gap-2 outline-none"
                                          onClick={() => applyQuickFill({ where: m.where, key: m.key, buttonIndex: m.buttonIndex }, '{{telefone}}')}
                                        >
                                          <div className="text-green-400 font-mono text-[10px] w-3.5 text-center">Ph</div>
                                          <span>Telefone</span>
                                        </DropdownMenuItem>

                                        <DropdownMenuItem
                                          className="text-sm cursor-pointer hover:bg-zinc-800 focus:bg-zinc-800 px-2 py-1.5 rounded-sm flex items-center gap-2 outline-none"
                                          onClick={() => applyQuickFill({ where: m.where, key: m.key, buttonIndex: m.buttonIndex }, '{{email}}')}
                                        >
                                          <div className="text-blue-400 font-mono text-[10px] w-3.5 text-center">@</div>
                                          <span>Email</span>
                                        </DropdownMenuItem>

                                        <DropdownMenuSeparator className="bg-white/10 my-1" />

                                        {customFields.length > 0 && (
                                          <>
                                            <DropdownMenuLabel className="text-xs text-gray-500 uppercase tracking-wider px-2 py-1.5 mt-2">
                                              Campos Personalizados
                                            </DropdownMenuLabel>
                                            {customFields.slice(0, 10).map(field => (
                                              <DropdownMenuItem
                                                key={field.id}
                                                className="text-sm cursor-pointer hover:bg-zinc-800 focus:bg-zinc-800 px-2 py-1.5 rounded-sm flex items-center gap-2 outline-none"
                                                onClick={() => applyQuickFill({ where: m.where, key: m.key, buttonIndex: m.buttonIndex }, `{{${field.key}}}`)}
                                              >
                                                <div className="text-amber-400 font-mono text-[10px] w-3.5 text-center">#</div>
                                                <span>{field.label}</span>
                                              </DropdownMenuItem>
                                            ))}
                                          </>
                                        )}
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                </div>
                              );
                            })}

                            {missingSummary.length > 6 && (
                              <p className="text-[10px] text-gray-500">Mostrando 6 de {missingSummary.length} pendências.</p>
                            )}
                          </div>
                        </div>
                      )}

                      {precheckResult.totals.skipped > 0 && (
                        <details className="bg-zinc-950/30 border border-white/5 rounded-lg p-3">
                          <summary className="cursor-pointer text-gray-300 font-medium">
                            Ver ignorados (motivo + ação)
                          </summary>

                          <div className="mt-3 overflow-x-auto">
                            <table className="w-full text-left">
                              <thead className="text-[10px] uppercase tracking-wider text-gray-500">
                                <tr>
                                  <th className="py-2 pr-3">Contato</th>
                                  <th className="py-2 pr-3">Telefone</th>
                                  <th className="py-2 pr-3">Motivo</th>
                                  <th className="py-2 pr-3">Ação</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-white/5">
                                {precheckResult.results
                                  .filter((r: any) => !r.ok)
                                  .slice(0, 20)
                                  .map((r: any, idx: number) => (
                                    <tr key={`${r.phone}_${idx}`}>
                                      <td className="py-2 pr-3 text-gray-200">{r.name}</td>
                                      <td className="py-2 pr-3 font-mono text-[11px] text-gray-500">{r.normalizedPhone || r.phone}</td>
                                      <td className="py-2 pr-3 text-amber-200/80">{r.reason || r.skipCode}</td>
                                      <td className="py-2 pr-3">
                                        {r.contactId ? (
                                          <a
                                            href={`/contacts?edit=${encodeURIComponent(r.contactId)}`}
                                            className="text-primary-400 hover:text-primary-300 underline underline-offset-2"
                                          >
                                            Editar contato
                                          </a>
                                        ) : (
                                          <span className="text-gray-600">-</span>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                              </tbody>
                            </table>
                            {precheckResult.totals.skipped > 20 && (
                              <p className="mt-2 text-[10px] text-gray-500">Mostrando 20 de {precheckResult.totals.skipped} ignorados.</p>
                            )}
                          </div>
                        </details>
                      )}
                    </div>
                  )}
                </div>

                {/* Scheduling Options */}
                <div className="border-t border-white/5 pt-6 space-y-4">
                  <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                    <Clock size={16} className="text-primary-400" />
                    Quando enviar?
                  </h3>

                  <div className="grid grid-cols-2 gap-4">
                    {/* Send Now Option */}
                    <button
                      type="button"
                      onClick={() => setScheduleMode('now')}
                      className={`relative p-4 rounded-xl border transition-all duration-200 flex flex-col items-center justify-center gap-3 ${scheduleMode === 'now'
                        ? 'bg-white text-black border-white shadow-[0_0_20px_rgba(255,255,255,0.1)]'
                        : 'bg-zinc-900/50 border-white/10 hover:bg-zinc-900 hover:border-white/20 text-gray-300'
                        }`}
                    >
                      {scheduleMode === 'now' && (
                        <div className="absolute top-2 right-2 text-black">
                          <CheckCircle size={16} />
                        </div>
                      )}
                      <div className={`p-2 rounded-lg ${scheduleMode === 'now'
                        ? 'bg-gray-200 text-black'
                        : 'bg-zinc-800 text-gray-400'
                        }`}>
                        <Zap size={18} />
                      </div>
                      <div className="text-center">
                        <h4 className="font-bold text-sm">Enviar Agora</h4>
                        <p className={`text-xs mt-1 ${scheduleMode === 'now' ? 'text-gray-600' : 'text-gray-500'}`}>
                          Disparo imediato
                        </p>
                      </div>
                    </button>

                    {/* Schedule Option */}
                    <button
                      type="button"
                      onClick={() => setScheduleMode('scheduled')}
                      className={`relative p-4 rounded-xl border transition-all duration-200 flex flex-col items-center justify-center gap-3 ${scheduleMode === 'scheduled'
                        ? 'bg-white text-black border-white shadow-[0_0_20px_rgba(255,255,255,0.1)]'
                        : 'bg-zinc-900/50 border-white/10 hover:bg-zinc-900 hover:border-white/20 text-gray-300'
                        }`}
                    >
                      {scheduleMode === 'scheduled' && (
                        <div className="absolute top-2 right-2 text-black">
                          <CheckCircle size={16} />
                        </div>
                      )}
                      <div className={`p-2 rounded-lg ${scheduleMode === 'scheduled'
                        ? 'bg-gray-200 text-black'
                        : 'bg-zinc-800 text-gray-400'
                        }`}>
                        <Calendar size={18} />
                      </div>
                      <div className="text-center">
                        <h4 className="font-bold text-sm">Agendar</h4>
                        <p className={`text-xs mt-1 ${scheduleMode === 'scheduled' ? 'text-gray-600' : 'text-gray-500'}`}>
                          Escolher data e hora
                        </p>
                      </div>
                    </button>
                  </div>

                  {/* Date/Time Picker (shown when scheduled) */}
                  {scheduleMode === 'scheduled' && (
                    <div className="bg-zinc-900/50 border border-white/10 rounded-xl p-4 mt-4 animate-in fade-in slide-in-from-top-2 duration-300">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs text-gray-500 mb-2">Data</label>
                          <input
                            type="date"
                            value={scheduledDate}
                            onChange={(e) => setScheduledDate(e.target.value)}
                            min={new Date().toLocaleDateString('en-CA')}
                            className="w-full px-4 py-3 bg-zinc-800 border border-white/10 rounded-lg text-white text-sm focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500/50 outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-2">Horário</label>
                          <input
                            type="time"
                            value={scheduledTime}
                            onChange={(e) => setScheduledTime(e.target.value)}
                            className="w-full px-4 py-3 bg-zinc-800 border border-white/10 rounded-lg text-white text-sm focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500/50 outline-none"
                          />
                        </div>
                      </div>
                      {scheduledDate && scheduledTime && (
                        <div className="mt-3 p-3 bg-primary-500/10 border border-primary-500/20 rounded-lg">
                          <p className="text-xs text-primary-400 flex items-center gap-2">
                            <Calendar size={14} />
                            Campanha será enviada em{' '}
                            <span className="font-bold text-white">
                              {new Date(`${scheduledDate}T${scheduledTime}`).toLocaleString('pt-BR', {
                                dateStyle: 'long',
                                timeStyle: 'short'
                              })}
                            </span>
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* ⚠️ LIMIT WARNING IN REVIEW */}
                {isOverLimit && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <ShieldAlert className="text-red-400 flex-shrink-0 mt-0.5" size={20} />
                    <div className="flex-1">
                      <p className="font-bold text-red-400 text-sm mb-1">⛔ Não é possível disparar</p>
                      <p className="text-sm text-red-200/70">
                        Você selecionou <span className="font-bold text-white">{recipientCount}</span> contatos,
                        mas seu limite é <span className="font-bold text-white">{currentLimit}</span>/dia.
                      </p>
                      <button
                        onClick={() => setStep(2)}
                        className="mt-2 text-xs text-red-400 hover:text-red-300 underline"
                      >
                        ← Voltar e ajustar destinatários
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Navigation */}
            <div className="flex justify-between items-center p-6 border-t border-white/5 bg-zinc-900/30 mt-auto">
              {step > 1 ? (
                <button
                  onClick={handleBack}
                  className="px-6 py-3 rounded-xl text-gray-400 font-medium hover:text-white transition-colors flex items-center gap-2 hover:bg-white/5"
                >
                  <ChevronLeft size={18} /> Voltar
                </button>
              ) : (
                <div></div>
              )}

              {step < 3 ? (
                // Hide button completely if over limit on Step 2 - the cards guide the user
                step === 2 && isOverLimit ? null : (
                  <button
                    onClick={handleNext}
                    className="group relative px-8 py-3 rounded-xl bg-white text-black font-bold hover:bg-gray-200 transition-all flex items-center gap-2 shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_30px_rgba(255,255,255,0.2)] overflow-hidden"
                  >
                    <span className="relative z-10 flex items-center gap-2">Continuar <ChevronRight size={18} className="group-hover:translate-x-1 transition-transform" /></span>
                  </button>
                )
              ) : isOverLimit ? null : (
                <button
                  onClick={() => {
                    if (scheduleMode === 'scheduled' && scheduledDate && scheduledTime) {
                      const scheduledAt = new Date(`${scheduledDate}T${scheduledTime}`).toISOString();
                      handleSend(scheduledAt);
                    } else {
                      handleSend();
                    }
                  }}
                  disabled={isCreating || (scheduleMode === 'scheduled' && (!scheduledDate || !scheduledTime))}
                  className={`group relative px-10 py-3 rounded-xl ${scheduleMode === 'scheduled'
                    ? 'bg-purple-600 hover:bg-purple-500 shadow-[0_0_20px_rgba(147,51,234,0.4)] hover:shadow-[0_0_40px_rgba(147,51,234,0.6)]'
                    : 'bg-primary-600 hover:bg-primary-500 shadow-[0_0_20px_rgba(16,185,129,0.4)] hover:shadow-[0_0_40px_rgba(16,185,129,0.6)]'
                    } text-white font-bold transition-all flex items-center gap-2 hover:scale-105 ${isCreating || (scheduleMode === 'scheduled' && (!scheduledDate || !scheduledTime)) ? 'opacity-70 cursor-not-allowed' : ''}`}
                >
                  <span className="relative z-10 flex items-center gap-2">
                    {isCreating
                      ? 'Processando...'
                      : scheduleMode === 'scheduled'
                        ? 'Agendar Campanha'
                        : 'Disparar Campanha'
                    }
                    {!isCreating && (scheduleMode === 'scheduled' ? <Calendar size={18} /> : <Zap size={18} className="fill-white" />)}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right Content - Preview Panel */}
        <div className={`hidden lg:flex flex-col lg:col-span-3 bg-zinc-900/30 rounded-2xl border border-white/5 p-4 ${step === 2 && isOverLimit ? 'opacity-30 pointer-events-none' : ''}`}>
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-gray-400 text-xs uppercase tracking-widest font-bold">
                <Eye size={14} /> Pré-visualização
              </div>
              {step === 2 && isOverLimit && <span className="text-red-400 text-[10px]">(ajuste os contatos)</span>}
            </div>

            {/* Phone Mockup - Universal Component */}
            <div className="flex-1 min-h-0 flex items-center justify-center">
              <WhatsAppPhonePreview
                components={previewTemplate?.components}
                fallbackContent={previewTemplate?.content}
                variables={(() => {
                  // Get contact info for resolving variable tokens based on recipient source
                  let contactName = '';
                  let contactPhone = '';
                  let contactEmail = '';
                  let customFields: Record<string, unknown> = {};

                  if (recipientSource === 'test' && testContact) {
                    contactName = testContact.name || '';
                    contactPhone = testContact.phone || '';
                  } else if (recipientSource === 'specific' && selectedContacts.length > 0) {
                    contactName = selectedContacts[0].name || '';
                    contactPhone = selectedContacts[0].phone || '';
                    contactEmail = selectedContacts[0].email || '';
                    customFields = selectedContacts[0].custom_fields || {};
                  } else if (recipientSource === 'all' && allContacts.length > 0) {
                    contactName = allContacts[0].name || '';
                    contactPhone = allContacts[0].phone || '';
                    contactEmail = allContacts[0].email || '';
                    customFields = allContacts[0].custom_fields || {};
                  }

                  // Resolve body variables using new array structure
                  return templateVariables.body.map(val => {
                    if (val === '{{nome}}' || val === '{{contact.name}}' || val === '{{name}}') {
                      return contactName || val;
                    } else if (val === '{{telefone}}' || val === '{{contact.phone}}' || val === '{{phone}}') {
                      return contactPhone || val;
                    } else if (val === '{{email}}' || val === '{{contact.email}}') {
                      return contactEmail || val;
                    } else {
                      // Check for custom field tokens
                      const match = val.match(/^\{\{(\w+)\}\}$/);
                      if (match && customFields[match[1]] !== undefined) {
                        return String(customFields[match[1]]);
                      }
                    }
                    return val;
                  });
                })()}
                headerVariables={(() => {
                  // Get contact info for resolving variable tokens
                  let contactName = '';
                  let contactPhone = '';
                  let contactEmail = '';
                  let customFields: Record<string, unknown> = {};

                  if (recipientSource === 'test' && testContact) {
                    contactName = testContact.name || '';
                    contactPhone = testContact.phone || '';
                  } else if (recipientSource === 'specific' && selectedContacts.length > 0) {
                    contactName = selectedContacts[0].name || '';
                    contactPhone = selectedContacts[0].phone || '';
                    contactEmail = selectedContacts[0].email || '';
                    customFields = selectedContacts[0].custom_fields || {};
                  } else if (recipientSource === 'all' && allContacts.length > 0) {
                    contactName = allContacts[0].name || '';
                    contactPhone = allContacts[0].phone || '';
                    contactEmail = allContacts[0].email || '';
                    customFields = allContacts[0].custom_fields || {};
                  }

                  // Resolve header variables using new array structure
                  if (templateVariables.header.length === 0) return undefined;

                  return templateVariables.header.map(val => {
                    if (val === '{{nome}}' || val === '{{contact.name}}' || val === '{{name}}') {
                      return contactName || val;
                    } else if (val === '{{telefone}}' || val === '{{contact.phone}}' || val === '{{phone}}') {
                      return contactPhone || val;
                    } else if (val === '{{email}}' || val === '{{contact.email}}') {
                      return contactEmail || val;
                    } else {
                      // Check for custom field tokens
                      const match = val.match(/^\{\{(\w+)\}\}$/);
                      if (match && customFields[match[1]] !== undefined) {
                        return String(customFields[match[1]]);
                      }
                    }
                    return val;
                  });
                })()}
                showEmptyState={!selectedTemplateId}
                emptyStateMessage="Selecione um template ao lado para visualizar"
                size="adaptive"
                className="max-h-full"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Modal de Bloqueio */}
      <CampaignBlockModal
        isOpen={isBlockModalOpen}
        onClose={() => setIsBlockModalOpen(false)}
        validation={blockReason}
        accountLimits={accountLimits}
      />

      {/* Modal de Upgrade */}
      <UpgradeRoadmapModal
        isOpen={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        accountLimits={accountLimits}
      />

      <CustomFieldsSheet
        open={isFieldsSheetOpen}
        onOpenChange={setIsFieldsSheetOpen}
        entityType="contact"
      />
    </div>
  );
};
