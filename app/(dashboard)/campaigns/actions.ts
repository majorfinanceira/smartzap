'use server'

import { createClient } from '@/lib/supabase-server'
import type { Campaign, CampaignFolder, CampaignTag } from '@/types'
import type { CampaignListResult } from '@/services/campaignService'

const PAGE_SIZE = 20

/**
 * Busca dados iniciais de campanhas no servidor (RSC).
 * Retorna primeira página com folders e tags para filtros.
 */
export async function getCampaignsInitialData(): Promise<CampaignListResult & {
  folders: CampaignFolder[]
  tags: CampaignTag[]
}> {
  const supabase = await createClient()

  // Buscar campanhas, folders e tags em PARALELO
  const [campaignsResult, foldersResult, tagsResult] = await Promise.all([
    // Campanhas com folder (primeira página)
    supabase
      .from('campaigns')
      .select(`
        *,
        folder:campaign_folders(id, name, color)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(0, PAGE_SIZE - 1),

    // Todas as pastas
    supabase
      .from('campaign_folders')
      .select('*')
      .order('name'),

    // Todas as tags
    supabase
      .from('campaign_tags')
      .select('*')
      .order('name')
  ])

  // Buscar tags das campanhas
  const campaignIds = (campaignsResult.data || []).map(c => c.id)
  let campaignTagsMap: Record<string, CampaignTag[]> = {}

  if (campaignIds.length > 0) {
    const { data: campaignTags } = await supabase
      .from('campaign_tag_assignments')
      .select(`
        campaign_id,
        tag:campaign_tags(id, name, color)
      `)
      .in('campaign_id', campaignIds)

    // Agrupar tags por campanha
    // Note: Supabase retorna tag como objeto único, não array
    campaignTagsMap = (campaignTags || []).reduce((acc, item: any) => {
      const cid = item.campaign_id
      if (!acc[cid]) acc[cid] = []
      if (item.tag && typeof item.tag === 'object' && !Array.isArray(item.tag)) {
        acc[cid].push(item.tag as CampaignTag)
      }
      return acc
    }, {} as Record<string, CampaignTag[]>)
  }

  // Mapear campanhas para formato da aplicação
  const campaigns: Campaign[] = (campaignsResult.data || []).map(c => ({
    id: c.id,
    name: c.name,
    templateName: c.template_name || '',
    status: c.status,
    recipients: c.recipients || 0,
    sent: c.sent || 0,
    delivered: c.delivered || 0,
    read: c.read || 0,
    skipped: c.skipped || 0,
    failed: c.failed || 0,
    createdAt: c.created_at,
    startedAt: c.started_at,
    completedAt: c.completed_at,
    scheduledAt: c.scheduled_at,
    lastSentAt: c.last_sent_at,
    folderId: c.folder_id,
    folder: c.folder as CampaignFolder | undefined,
    tags: campaignTagsMap[c.id] || []
  }))

  return {
    data: campaigns,
    total: campaignsResult.count || 0,
    limit: PAGE_SIZE,
    offset: 0,
    folders: (foldersResult.data || []) as CampaignFolder[],
    tags: (tagsResult.data || []) as CampaignTag[]
  }
}
