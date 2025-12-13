import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@/lib/navigation';
import { toast } from 'sonner';
import { campaignService, contactService, templateService } from '../services';
import { settingsService } from '../services/settingsService';
import { Template, TestContact } from '../types';
import { useAccountLimits } from './useAccountLimits';
import { CampaignValidation } from '../lib/meta-limits';
import { countTemplateVariables } from '../lib/template-validator';

export const useCampaignWizardController = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [step, setStep] = useState(1);

  // Form State
  const [name, setName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [recipientSource, setRecipientSource] = useState<'all' | 'specific' | 'test' | null>(null);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [contactSearchTerm, setContactSearchTerm] = useState('');

  // Template Variables State - Official Meta API Structure
  // header: array of values for header {{1}}, {{2}}, etc.
  // body: array of values for body {{1}}, {{2}}, etc.
  // buttons: optional Record for button URL variables
  const [templateVariables, setTemplateVariables] = useState<{ header: string[], body: string[], buttons?: Record<string, string> }>({ header: [], body: [] });

  // Scheduling State
  const [scheduledAt, setScheduledAt] = useState<string | null>(null);
  const [isScheduling, setIsScheduling] = useState(false);

  // Validation Modal State
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [validationResult, setValidationResult] = useState<CampaignValidation | null>(null);

  // Pré-check (dry-run) state
  const [precheckResult, setPrecheckResult] = useState<any>(null);
  const [isPrechecking, setIsPrechecking] = useState(false);

  // Account Limits Hook
  const { validate, limits, isLoading: limitsLoading, tierName } = useAccountLimits();

  // --- Queries ---
  const contactsQuery = useQuery({
    queryKey: ['contacts'],
    queryFn: contactService.getAll,
  });

  const templatesQuery = useQuery({
    queryKey: ['templates'],
    queryFn: templateService.getAll,
    select: (data) => data.filter(t => t.status === 'APPROVED')
  });

  // Get settings (mostly for limits/credentials)
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: settingsService.get,
  });

  // NEW: Fetch test contact from DB (Source of Truth)
  const testContactQuery = useQuery({
    queryKey: ['testContact'],
    queryFn: settingsService.getTestContact,
    staleTime: 60 * 1000,
  });

  // Prefer DB data, fallback to settings (legacy/local)
  const testContact = testContactQuery.data || settingsQuery.data?.testContact;

  // Initialize name
  useEffect(() => {
    if (!name) {
      const date = new Date().toLocaleDateString('pt-BR', { month: 'short', day: 'numeric' });
      setName(`Campanha ${date}`);
    }
  }, []);

  // Update selected contact IDs when switching to "all"
  useEffect(() => {
    if (recipientSource === 'all' && contactsQuery.data) {
      setSelectedContactIds(contactsQuery.data.map(c => c.id));
    } else if (recipientSource === 'specific') {
      setSelectedContactIds([]);
    } else if (recipientSource === 'test') {
      // Test mode doesn't use contact IDs - handled separately
      setSelectedContactIds([]);
    }
  }, [recipientSource, contactsQuery.data]);

  // --- Mutations ---
  const createCampaignMutation = useMutation({
    mutationFn: campaignService.create,
    onMutate: async (input) => {
      // Generate temp ID for immediate navigation
      const tempId = `temp_${Date.now()}`;

      // 🚀 PRE-SET cache with PENDING messages BEFORE API call
      const contacts = input.selectedContacts || [];
      const pendingMessages = contacts.map((contact, index) => ({
        id: `msg_${tempId}_${index}`,
        campaignId: tempId,
        contactName: contact.name || contact.phone,
        contactPhone: contact.phone,
        status: 'Pending' as const,
        sentAt: '-',
      }));

      // Pre-populate the campaign in cache
      const pendingCampaign = {
        id: tempId,
        name: input.name,
        template: input.templateName,
        recipients: input.recipients,
        sent: 0,
        status: 'SENDING' as const,
        createdAt: new Date().toISOString(),
      };

      queryClient.setQueryData(['campaign', tempId], pendingCampaign);
      queryClient.setQueryData(['campaignMessages', tempId], pendingMessages);

      // Navigate IMMEDIATELY (before API responds)
      navigate(`/campaigns/${tempId}`);

      return { tempId };
    },
    onSuccess: (campaign, _input, context) => {
      const tempId = context?.tempId;

      // Copy cached data to real campaign ID
      if (tempId) {
        const cachedMessages = queryClient.getQueryData(['campaignMessages', tempId]);
        if (cachedMessages) {
          queryClient.setQueryData(['campaignMessages', campaign.id], cachedMessages);
        }
        // Clean up temp cache
        queryClient.removeQueries({ queryKey: ['campaign', tempId] });
        queryClient.removeQueries({ queryKey: ['campaignMessages', tempId] });
      }

      queryClient.invalidateQueries({ queryKey: ['campaigns'] });

      // Navigate to real campaign (replaces temp URL)
      navigate(`/campaigns/${campaign.id}`, { replace: true });

      toast.success('Campanha criada e disparada com sucesso!');
    },
    onError: (_error, _input, context) => {
      // Clean up temp cache on error
      if (context?.tempId) {
        queryClient.removeQueries({ queryKey: ['campaign', context.tempId] });
        queryClient.removeQueries({ queryKey: ['campaignMessages', context.tempId] });
      }
      toast.error('Erro ao criar campanha.');
      navigate('/campaigns');
    }
  });

  // --- Logic ---
  const allContacts = contactsQuery.data || [];
  const totalContacts = allContacts.length;
  const selectedContacts = allContacts.filter(c => selectedContactIds.includes(c.id));

  // Filter contacts by search term (name, phone, email, tags)
  const filteredContacts = useMemo(() => {
    if (!contactSearchTerm.trim()) return allContacts;
    const term = contactSearchTerm.toLowerCase().trim();
    return allContacts.filter(contact => {
      const nameMatch = contact.name?.toLowerCase().includes(term);
      const phoneMatch = contact.phone?.toLowerCase().includes(term);
      const emailMatch = contact.email?.toLowerCase().includes(term);
      const tagsMatch = contact.tags?.some(tag => tag.toLowerCase().includes(term));
      return nameMatch || phoneMatch || emailMatch || tagsMatch;
    });
  }, [allContacts, contactSearchTerm]);

  // Calculate recipient count - 1 for test mode, otherwise selected contacts
  const recipientCount = recipientSource === 'test' && testContact ? 1 : selectedContacts.length;

  // Get contacts for sending - test contact or selected contacts (includes email and custom_fields for variable resolution)
  const contactsForSending = recipientSource === 'test' && testContact
    ? [{ id: (testContact as any).id || 'manual_test_id', contactId: (testContact as any).id || 'manual_test_id', name: testContact.name || testContact.phone, phone: testContact.phone, email: (testContact as any).email || '', custom_fields: (testContact as any).custom_fields || {} }]
    : selectedContacts.map(c => ({ id: c.id, contactId: c.id, name: c.name || c.phone, phone: c.phone, email: c.email || '', custom_fields: c.custom_fields || {} }));

  const availableTemplates = templatesQuery.data || [];
  const selectedTemplate = availableTemplates.find(t => t.id === selectedTemplateId);

  // Calculate all template variables with detailed info about where each is used
  const templateVariableInfo = useMemo(() => {
    if (!selectedTemplate) return { body: [], header: [], buttons: [], totalExtra: 0 };

    const components = selectedTemplate.components || [];
    const result = {
      body: [] as { index: number; key: string; placeholder: string; context: string }[],
      header: [] as { index: number; key: string; placeholder: string; context: string }[],
      buttons: [] as { index: number; key: string; buttonIndex: number; buttonText: string; context: string }[],
      totalExtra: 0,
    };

    // Generic Regex to match {{1}} OR {{variable_name}}
    const varRegex = /\{\{([\w\d_]+)\}\}/g;

    // Helper to extract numeric index or return string key
    const getVarId = (match: string): { isNum: boolean, val: string } => {
      const clean = match.replace(/[{}]/g, '');
      const num = parseInt(clean);
      return { isNum: !isNaN(num), val: clean };
    };

    // Parse body variables (deduplicate - same variable may appear multiple times in text)
    const bodyComponent = components.find(c => c.type === 'BODY');
    if (bodyComponent?.text) {
      const matches = bodyComponent.text.match(varRegex) || [];
      const seenKeys = new Set<string>();
      matches.forEach((match) => {
        const { isNum, val } = getVarId(match);
        // Skip if we've already seen this variable
        if (seenKeys.has(val)) return;
        seenKeys.add(val);

        result.body.push({
          index: isNum ? parseInt(val) : 0, // 0 for named
          key: val,
          placeholder: match,
          context: `Variável do corpo (${match})`
        });
      });
    }

    // Parse header variables (deduplicate - same variable may appear multiple times)
    const headerComponent = components.find(c => c.type === 'HEADER');
    if (headerComponent?.format === 'TEXT' && headerComponent?.text) {
      const matches = headerComponent.text.match(varRegex) || [];
      const seenKeys = new Set<string>();
      matches.forEach((match) => {
        const { isNum, val } = getVarId(match);
        // Skip if we've already seen this variable
        if (seenKeys.has(val)) return;
        seenKeys.add(val);

        result.header.push({
          index: isNum ? parseInt(val) : 0,
          key: val,
          placeholder: match,
          context: `Variável do cabeçalho (${match})`
        });
      });
    }

    // Parse button variables (URL)
    const buttonsComponent = components.find(c => c.type === 'BUTTONS');
    if (buttonsComponent?.buttons) {
      buttonsComponent.buttons.forEach((btn: any, btnIndex: number) => {
        if (btn.type === 'URL' && btn.url) {
          const matches = btn.url.match(varRegex) || [];
          matches.forEach((match: string) => {
            const { isNum, val } = getVarId(match);
            result.buttons.push({
              index: isNum ? parseInt(val) : 0, // Usually just 1
              key: val,
              buttonIndex: btnIndex,
              buttonText: btn.text || `Botão ${btnIndex + 1}`,
              context: `Variável da URL (${match})`
            });
          });
        }
      });
    }

    // Calculate total extra variables (not used for limits logic directly locally but good for UI)
    result.totalExtra = result.body.length + result.header.length + result.buttons.length;

    return result;
  }, [selectedTemplate]);

  // For backward compatibility - count of extra variables
  const templateVariableCount = templateVariableInfo.totalExtra;

  // AUTO-MAPPING & Reset
  // Strategy: Only auto-fill when Meta variable name EXACTLY matches our system fields
  // System fields: nome, telefone, email (Portuguese)
  useEffect(() => {
    const systemFields = ['nome', 'telefone', 'email'];

    // Build header array - one value per header variable
    const headerVars = templateVariableInfo.header
      .sort((a, b) => a.index - b.index)
      .map(v => {
        const lowerKey = v.key.toLowerCase();
        return systemFields.includes(lowerKey) ? `{{${lowerKey}}}` : '';
      });

    // Build body array - one value per body variable
    const bodyVars = templateVariableInfo.body
      .sort((a, b) => a.index - b.index)
      .map(v => {
        const lowerKey = v.key.toLowerCase();
        return systemFields.includes(lowerKey) ? `{{${lowerKey}}}` : '';
      });

    setTemplateVariables({ header: headerVars, body: bodyVars });
  }, [templateVariableInfo]);

  // 🔴 LIVE VALIDATION - Check limits in real-time as user selects contacts
  const liveValidation = useMemo(() => {
    if (recipientCount === 0) return null;
    return validate(recipientCount);
  }, [recipientCount, validate]);

  const isOverLimit = liveValidation ? !liveValidation.canSend : false;
  // Use the limit from validation (respects DEBUG mode) not from API limits
  const currentLimit = liveValidation?.currentLimit || limits?.maxUniqueUsersPerDay || 250;

  const toggleContact = (contactId: string) => {
    setSelectedContactIds(prev =>
      prev.includes(contactId)
        ? prev.filter(id => id !== contactId)
        : [...prev, contactId]
    );
  };

  const handleNext = () => {
    if (step === 1) {
      if (!name) { toast.error('Por favor insira o nome da campanha'); return; }
      if (!selectedTemplateId) { toast.error('Por favor selecione um template'); return; }
    }
    if (step === 2) {
      if (!recipientSource) { toast.error('Por favor selecione uma fonte de destinatários'); return; }
      if (recipientSource === 'specific' && selectedContactIds.length === 0) {
        toast.error('Por favor selecione pelo menos um contato');
        return;
      }
      if (recipientSource === 'test' && !testContact) {
        toast.error('Contato de teste não configurado. Configure em Ajustes.');
        return;
      }
    }
    setStep((prev) => Math.min(prev + 1, 3));
  };

  const handleBack = () => setStep((prev) => Math.max(prev - 1, 1));

  const runPrecheck = async () => {
    if (!selectedTemplate?.name) {
      toast.error('Selecione um template antes de validar');
      return;
    }
    if (!contactsForSending || contactsForSending.length === 0) {
      toast.error('Selecione pelo menos um contato');
      return;
    }

    setIsPrechecking(true);
    try {
      const result = await campaignService.precheck({
        templateName: selectedTemplate.name,
        contacts: contactsForSending,
        templateVariables:
          (templateVariables.header.length > 0 || templateVariables.body.length > 0 || (templateVariables.buttons && Object.keys(templateVariables.buttons).length > 0))
            ? templateVariables
            : undefined,
      });

      setPrecheckResult(result);

      const skipped = result?.totals?.skipped ?? 0;
      const valid = result?.totals?.valid ?? 0;
      if (skipped > 0) {
        toast.warning(`Pré-check: ${valid} válidos, ${skipped} serão ignorados (ver detalhes)`);
      } else {
        toast.success(`Pré-check OK: ${valid} destinatários válidos`);
      }

      return result;
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao validar destinatários');
      return null;
    } finally {
      setIsPrechecking(false);
    }
  };

  const handlePrecheck = async (): Promise<void> => {
    await runPrecheck();
  };

  // INTELLIGENT VALIDATION - Prevents users from sending campaigns that exceed limits
  const handleSend = async (scheduleTime?: string) => {
    // Validate that all required template variables are filled
    if (templateVariableCount > 0) {
      // Check if we have enough keys filled? 
      // Actually we should check against templateVariableInfo requirements.
      // For now, simpler check: do we have at least `templateVariableCount` keys?
      // Or better: are any values empty?
      // Since we initialize empty, we rely on user filling them.

      const isFilled = (v: unknown) => {
        if (typeof v !== 'string') return false;
        return v.trim().length > 0;
      };

      const filledCount =
        [...templateVariables.header, ...templateVariables.body].filter(isFilled).length +
        Object.values(templateVariables.buttons || {}).filter(isFilled).length;
      if (filledCount < templateVariableCount) {
        toast.error(`Preencha todas as variáveis do template (${templateVariableCount - filledCount} pendentes)`);
        return;
      }
    }

    // Dry-run pré-check antes de criar/disparar (UX). Backend continua blindado.
    // Regra: se NENHUM válido, não cria a campanha.
    const result = await runPrecheck();
    if (result?.totals && result.totals.valid === 0) {
      toast.error('Nenhum destinatário válido para envio. Corrija os contatos ignorados e valide novamente.');
      return;
    }

    // Validate campaign against account limits
    const validation = validate(recipientCount);
    setValidationResult(validation);

    // If campaign is blocked, show modal with explanation
    if (!validation.canSend) {
      setShowBlockModal(true);
      return;
    }

    // Show warnings if any (but allow to proceed)
    if (validation.warnings.length > 0) {
      validation.warnings.forEach(warning => {
        toast.warning(warning);
      });
    }

    // Proceed with campaign creation
    createCampaignMutation.mutate({
      name: recipientSource === 'test' ? `[TESTE] ${name}` : name,
      templateName: selectedTemplate?.name || 'unknown_template',
      recipients: recipientCount,
      selectedContacts: contactsForSending,
      selectedContactIds: recipientSource === 'test' ? [] : selectedContactIds, // Save for resume functionality
      scheduledAt: scheduleTime || scheduledAt || undefined, // Use provided time or state
      templateVariables: (templateVariables.header.length > 0 || templateVariables.body.length > 0) ? templateVariables : undefined,
    });
  };

  // Schedule campaign for later
  const handleSchedule = (scheduleTime: string) => {
    setScheduledAt(scheduleTime);
    handleSend(scheduleTime);
  };

  // Close the block modal
  const closeBlockModal = () => {
    setShowBlockModal(false);
    setValidationResult(null);
  };

  return {
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
    handleSend,
    isCreating: createCampaignMutation.isPending,
    isLoading: contactsQuery.isLoading || templatesQuery.isLoading || limitsLoading || settingsQuery.isLoading || testContactQuery.isLoading,

    // Pré-check (dry-run)
    precheckResult,
    isPrechecking,

    // Test Contact
    testContact,

    // Template Variables (for {{2}}, {{3}}, etc.)
    templateVariables,
    setTemplateVariables,
    templateVariableCount,
    templateVariableInfo, // Detailed info about each variable location

    // Account Limits & Validation state
    accountLimits: limits,
    isBlockModalOpen: showBlockModal,
    setIsBlockModalOpen: setShowBlockModal,
    blockReason: validationResult,
    tierName,

    // Live validation (real-time as user selects)
    liveValidation,
    isOverLimit,
    currentLimit,

    // Scheduling
    scheduledAt,
    setScheduledAt,
    isScheduling,
    setIsScheduling,
    handleSchedule,
  };
};
