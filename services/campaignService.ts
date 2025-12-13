import { Campaign, CampaignStatus, Message, MessageStatus } from '../types';

interface CreateCampaignInput {
  name: string;
  templateName: string;
  recipients: number;
  selectedContacts?: { name: string; phone: string; custom_fields?: Record<string, unknown> }[];
  selectedContactIds?: string[];  // For resume functionality
  scheduledAt?: string;           // ISO timestamp for scheduling
  templateVariables?: { header: string[], body: string[], buttons?: Record<string, string> };   // Meta API structure
}

interface RealMessageStatus {
  phone: string;
  status: 'sent' | 'failed';
  messageId?: string;
  error?: string;
  timestamp?: string;
  sentAt?: string; // Alternativo ao timestamp
  webhookStatus?: 'delivered' | 'read' | 'failed'; // From Meta webhook
  webhookTimestamp?: string;
}

// Helper para extrair timestamp de forma segura
function getTimestamp(msg: RealMessageStatus): string {
  const ts = msg.timestamp || msg.sentAt;
  if (!ts) return '-';
  try {
    return new Date(ts).toLocaleString('pt-BR');
  } catch {
    return '-';
  }
}

interface CampaignStatusResponse {
  campaignId: string;
  stats: {
    sent: number;
    delivered: number;
    read: number;
    skipped?: number;
    failed: number;
    total: number;
  };
  messages: RealMessageStatus[];
}

interface PrecheckContactInput {
  id?: string;
  contactId?: string;
  contact_id?: string;
  name?: string;
  phone: string;
  email?: string | null;
  custom_fields?: Record<string, unknown>;
}

export interface CampaignPrecheckResult {
  ok: true;
  templateName: string;
  totals: { total: number; valid: number; skipped: number };
  results: Array<
    | { ok: true; contactId?: string; name: string; phone: string; normalizedPhone: string }
    | { ok: false; contactId?: string; name: string; phone: string; normalizedPhone?: string; skipCode: string; reason: string }
  >;
}

export const campaignService = {
  getAll: async (): Promise<Campaign[]> => {
    // Fetch from real API
    const response = await fetch('/api/campaigns');
    if (!response.ok) {
      console.error('Failed to fetch campaigns:', response.statusText);
      return [];
    }
    return response.json();
  },

  getById: async (id: string): Promise<Campaign | undefined> => {
    // Fetch from Database (SOURCE OF TRUTH for persisted data)
    const response = await fetch(`/api/campaigns/${id}`);
    if (!response.ok) {
      if (response.status === 404) return undefined;
      console.error('Failed to fetch campaign:', response.statusText);
      return undefined;
    }

    const campaign = await response.json();

    // Strategy: Use Redis for real-time stats while campaign is active
    // Once completed, database is the source of truth
    const isActive = campaign.status === 'Enviando' || campaign.status === 'Agendado';

    if (isActive) {
      // Try to get real-time stats from Redis for faster updates
      try {
        const statusResponse = await fetch(`/api/campaign/${id}/status`);
        if (statusResponse.ok) {
          const realStatus: CampaignStatusResponse = await statusResponse.json();
          // Only use Redis stats if they have data (not empty)
          if (realStatus.stats.sent > 0 || realStatus.stats.failed > 0) {
            return {
              ...campaign,
              sent: realStatus.stats.sent,
              delivered: realStatus.stats.delivered,
              read: realStatus.stats.read,
              failed: realStatus.stats.failed,
            };
          }
        }
      } catch (e) {
        console.warn('Failed to fetch Redis stats, using database:', e);
      }
    }

    // For completed campaigns or if Redis fails, use database (source of truth)
    return campaign;
  },

  // INSTANT: Get pending messages - returns empty array (real data comes from getMessages)
  getPendingMessages: (_id: string): Message[] => {
    // During creation, messages are pending. After dispatch, use getMessages() for real status.
    return [];
  },

  // ASYNC: Get real message status from campaign_contacts table (paginated)
  getMessages: async (id: string, options?: { limit?: number; offset?: number; status?: string }): Promise<{
    messages: Message[];
    stats: { total: number; pending: number; sent: number; delivered: number; read: number; skipped: number; failed: number };
    pagination: { limit: number; offset: number; total: number; hasMore: boolean };
  }> => {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.offset) params.set('offset', String(options.offset));
    if (options?.status) params.set('status', options.status);

    const url = `/api/campaigns/${id}/messages${params.toString() ? `?${params}` : ''}`;
    const response = await fetch(url);
    if (!response.ok) {
      console.error('Failed to fetch messages:', response.statusText);
      return { messages: [], stats: { total: 0, pending: 0, sent: 0, delivered: 0, read: 0, skipped: 0, failed: 0 }, pagination: { limit: 50, offset: 0, total: 0, hasMore: false } };
    }
    return response.json();
  },

  // Fetch real-time status from Redis
  getRealStatus: async (id: string): Promise<CampaignStatusResponse | null> => {
    try {
      const response = await fetch(`/api/campaign/${id}/status`);
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      console.error('Failed to fetch real status:', error);
    }
    return null;
  },

  create: async (input: CreateCampaignInput): Promise<Campaign> => {
    const { name, templateName, recipients, selectedContacts, selectedContactIds, scheduledAt, templateVariables } = input;

    // 1. Create campaign in Database (source of truth) with contacts
    const response = await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        templateName,
        recipients,
        scheduledAt,
        selectedContactIds,
        contacts: selectedContacts, // Pass contacts to be saved in campaign_contacts
        templateVariables, // Pass template variables to be saved in database
        status: scheduledAt ? CampaignStatus.SCHEDULED : CampaignStatus.SENDING,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to create campaign');
    }

    const newCampaign = await response.json();

    // 2. If scheduled for later, don't dispatch now
    if (scheduledAt) {
      console.log(`Campaign ${newCampaign.id} scheduled for ${scheduledAt}`);
      return newCampaign;
    }

    // 3. Dispatch to Backend immediately (Execution)
    if (selectedContacts && selectedContacts.length > 0) {
      await campaignService.dispatchToBackend(newCampaign.id, templateName, selectedContacts, templateVariables);
    }

    return newCampaign;
  },

  // Dry-run: valida contatos/variáveis SEM criar campanha e SEM persistir.
  precheck: async (input: { templateName: string; contacts: PrecheckContactInput[]; templateVariables?: { header: string[], body: string[], buttons?: Record<string, string> } }): Promise<CampaignPrecheckResult> => {
    const response = await fetch('/api/campaign/precheck', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateName: input.templateName,
        contacts: input.contacts,
        templateVariables: input.templateVariables,
      }),
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(payload?.error || 'Falha ao validar destinatários')
    }
    return payload as CampaignPrecheckResult
  },

  // Internal: dispatch campaign to backend queue
  dispatchToBackend: async (campaignId: string, templateName: string, contacts?: { id?: string; contactId?: string; name: string; phone: string; email?: string | null; custom_fields?: Record<string, unknown> }[], templateVariables?: { header: string[], body: string[], buttons?: Record<string, string> }): Promise<boolean> => {
    try {
      // Use provided contacts - contacts must be passed explicitly
      if (!contacts || contacts.length === 0) {
        console.error('No contacts provided for dispatch');
        return false;
      }

      // Don't send credentials from localStorage - server fetches from Redis
      const response = await fetch('/api/campaign/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          templateName,
          contacts,
          templateVariables, // Pass template variables to workflow
          // whatsappCredentials fetched from Redis on server
        })
      });

      if (!response.ok) {
        console.error('Dispatch failed:', await response.text());
        return false;
      }
      return true;
    } catch (error) {
      console.error('Failed to dispatch campaign to backend:', error);
      return false;
    }
  },

  // Re-enqueue only skipped contacts after revalidation
  resendSkipped: async (campaignId: string): Promise<{ status: string; resent: number; stillSkipped: number; message?: string }> => {
    const response = await fetch(`/api/campaigns/${campaignId}/resend-skipped`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(payload?.error || 'Falha ao reenviar ignorados')
    }
    return payload
  },

  delete: async (id: string): Promise<void> => {
    const response = await fetch(`/api/campaigns/${id}`, { method: 'DELETE' });
    if (!response.ok) {
      throw new Error('Failed to delete campaign');
    }
  },

  duplicate: async (id: string): Promise<Campaign> => {
    const response = await fetch(`/api/campaigns/${id}/duplicate`, { method: 'POST' });
    if (!response.ok) {
      throw new Error('Failed to duplicate campaign');
    }
    return response.json();
  },

  // Pause a running campaign
  pause: async (id: string): Promise<Campaign | undefined> => {
    // Update Database first (source of truth)
    const updateResponse = await fetch(`/api/campaigns/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: CampaignStatus.PAUSED,
        pausedAt: new Date().toISOString(),
      }),
    });

    if (!updateResponse.ok) {
      console.error('Failed to pause campaign in Database');
      return undefined;
    }

    const campaign = await updateResponse.json();

    // Notify backend to pause queue processing
    try {
      await fetch(`/api/campaign/${id}/pause`, { method: 'POST' });
    } catch (error) {
      console.error('Failed to pause campaign on backend:', error);
    }

    return campaign;
  },

  // Resume a paused campaign
  resume: async (id: string): Promise<Campaign | undefined> => {
    // Get campaign from Database
    const campaign = await campaignService.getById(id);
    if (!campaign) return undefined;

    // Update status in Database
    const updateResponse = await fetch(`/api/campaigns/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: CampaignStatus.SENDING,
        pausedAt: null,
      }),
    });

    if (!updateResponse.ok) {
      console.error('Failed to resume campaign in Database');
      return undefined;
    }

    const updatedCampaign = await updateResponse.json();

    // Notify backend to resume processing
    try {
      await fetch(`/api/campaign/${id}/resume`, { method: 'POST' });
    } catch (error) {
      console.error('Failed to resume campaign on backend:', error);
    }

    return updatedCampaign;
  },

  // Start a scheduled or draft campaign immediately
  start: async (id: string): Promise<Campaign | undefined> => {
    console.log('🚀 Starting campaign:', { id });

    // Get campaign from Database first to get templateVariables and templateName
    const campaignData = await campaignService.getById(id);
    if (!campaignData) {
      console.error('❌ Campaign not found!');
      return undefined;
    }

    // Get campaign contacts from Database (campaign_contacts table)
    const messagesResponse = await fetch(`/api/campaigns/${id}/messages`);
    let contacts: { name: string; phone: string }[] = [];

    if (messagesResponse.ok) {
      const response = await messagesResponse.json();
      // API returns { messages: [...], stats: {...} } - access the messages array
      const messagesList = response.messages || response;
      contacts = messagesList.map((m: { contactName: string; contactPhone: string }) => ({
        name: m.contactName,
        phone: m.contactPhone,
      }));
    }

    if (contacts.length === 0) {
      console.error('❌ No contacts found for campaign! Campaign will not be dispatched.');
      return undefined;
    }

    console.log('📋 Found contacts:', contacts.length);
    console.log('📝 Template variables:', campaignData.templateVariables);

    // Update status in Database
    const updateResponse = await fetch(`/api/campaigns/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: CampaignStatus.SENDING,
        startedAt: new Date().toISOString(),
        scheduledAt: null,
      }),
    });

    if (!updateResponse.ok) {
      console.error('Failed to start campaign in Database');
      return undefined;
    }

    const campaign = await updateResponse.json();

    console.log('📤 Dispatching to backend with contacts:', contacts.length);

    const success = await campaignService.dispatchToBackend(
      id,
      campaign.templateName,
      contacts,
      campaignData.templateVariables as { header: string[], body: string[], buttons?: Record<string, string> } | undefined // Pass template variables from database
    );

    console.log('📤 Dispatch result:', success ? '✅ Success' : '❌ Failed');

    return campaign;
  },

  // Update campaign stats from real-time polling
  updateStats: async (id: string): Promise<Campaign | undefined> => {
    const realStatus = await campaignService.getRealStatus(id);

    if (realStatus && realStatus.stats.total > 0) {
      // Get campaign from Database
      const campaign = await campaignService.getById(id);
      if (!campaign) return undefined;

      const isComplete = realStatus.stats.sent + realStatus.stats.failed >= campaign.recipients;

      // Update in Database
      const response = await fetch(`/api/campaigns/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sent: realStatus.stats.sent,
          delivered: realStatus.stats.delivered,
          read: realStatus.stats.read,
          failed: realStatus.stats.failed,
          status: isComplete ? CampaignStatus.COMPLETED : campaign.status,
          completedAt: isComplete ? new Date().toISOString() : undefined,
        }),
      });

      if (!response.ok) {
        console.error('Failed to update campaign stats');
        return campaign;
      }

      return response.json();
    }

    return campaignService.getById(id);
  }
};
