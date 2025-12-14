import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { MessageStatus } from '@/types'

// Force dynamic rendering (no caching)
export const dynamic = 'force-dynamic'

interface Params {
  params: Promise<{ id: string }>
}

/**
 * GET /api/campaigns/[id]/messages
 * Get messages for a campaign with pagination and aggregated stats
 * 
 * Query params:
 * - limit: number of messages per page (default: 50, max: 100)
 * - offset: pagination offset (default: 0)
 * - status: filter by status (optional)
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)

    // Pagination params
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100)
    const offset = parseInt(searchParams.get('offset') || '0')
    const statusFilter = searchParams.get('status')

    // 1. Get aggregated stats (parallel queries)
    const [
      { count: total },
      { count: pending },
      { count: sent },
      { count: delivered },
      { count: read },
      { count: skipped },
      { count: failed }
    ] = await Promise.all([
      supabase.from('campaign_contacts').select('*', { count: 'exact', head: true }).eq('campaign_id', id),
      supabase.from('campaign_contacts').select('*', { count: 'exact', head: true }).eq('campaign_id', id).in('status', ['pending', 'sending']),
      // "Enviado" (sent) deve incluir entregues e lidas para manter a progressão: sent >= delivered >= read
      supabase.from('campaign_contacts').select('*', { count: 'exact', head: true }).eq('campaign_id', id).in('status', ['sent', 'delivered', 'read']),
      // Delivered inclui delivered + read
      supabase.from('campaign_contacts').select('*', { count: 'exact', head: true }).eq('campaign_id', id).in('status', ['delivered', 'read']),
      supabase.from('campaign_contacts').select('*', { count: 'exact', head: true }).eq('campaign_id', id).eq('status', 'read'),
      supabase.from('campaign_contacts').select('*', { count: 'exact', head: true }).eq('campaign_id', id).eq('status', 'skipped'),
      supabase.from('campaign_contacts').select('*', { count: 'exact', head: true }).eq('campaign_id', id).eq('status', 'failed')
    ])

    const aggregatedStats = {
      total: total || 0,
      pending: pending || 0,
      sent: sent || 0,
      delivered: delivered || 0,
      read: read || 0,
      skipped: skipped || 0,
      failed: failed || 0,
    }

    // 2. Get paginated messages
    let query = supabase
      .from('campaign_contacts')
      .select('*')
      .eq('campaign_id', id)

    if (statusFilter) {
      if (statusFilter === MessageStatus.SENT) {
        // "Enviado" = efetivamente disparado (exclui pending e skipped)
        query = query.in('status', ['sent', 'delivered', 'read', 'failed'])
      } else if (statusFilter === MessageStatus.DELIVERED) {
        // Delivered matches Delivered + Read
        query = query.in('status', ['delivered', 'read'])
      } else if (statusFilter === MessageStatus.READ) {
        query = query.eq('status', 'read')
      } else if (statusFilter === MessageStatus.SKIPPED) {
        query = query.eq('status', 'skipped')
      } else if (statusFilter === MessageStatus.FAILED) {
        query = query.eq('status', 'failed')
      }
    }

    const { data: rows, error } = await query
      // Sort logic: Show Undelivered (Null delivered_at) first to highlight potential issues/gaps
      .order('delivered_at', { ascending: true, nullsFirst: true })
      .order('sent_at', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1)

    if (error) throw error

    const messages = (rows || []).map((row, index) => {
      // Map database status to MessageStatus enum
      let status = MessageStatus.PENDING
      const dbStatus = row.status as string

      if (dbStatus === 'sent') status = MessageStatus.SENT
      else if (dbStatus === 'delivered') status = MessageStatus.DELIVERED
      else if (dbStatus === 'read') status = MessageStatus.READ
      else if (dbStatus === 'sending') status = MessageStatus.PENDING
      else if (dbStatus === 'skipped') status = MessageStatus.SKIPPED
      else if (dbStatus === 'failed') status = MessageStatus.FAILED

      return {
        id: row.id as string || `msg_${id}_${offset + index}`,
        campaignId: id,
        contactId: (row.contact_id as string | null) || undefined,
        contactName: row.name as string || row.phone as string,
        contactPhone: row.phone as string,
        status,
        messageId: row.message_id as string | undefined,
        sentAt: row.sent_at ? new Date(row.sent_at as string).toLocaleString('pt-BR') : '-',
        deliveredAt: row.delivered_at ? new Date(row.delivered_at as string).toLocaleString('pt-BR') : undefined,
        readAt: row.read_at ? new Date(row.read_at as string).toLocaleString('pt-BR') : undefined,
        error: (
          // Para skipped, o motivo vem do nosso pré-check/guard-rail
          (status === MessageStatus.SKIPPED ? (row.skip_reason || row.skip_code) : undefined) ||
          row.failure_reason ||
          row.error ||
          row.error_message ||
          (status === MessageStatus.SENT ? 'Aguardando confirmação de entrega...' : undefined)
        ) as string | undefined,
      }
    })

    // Return paginated response with stats (no cache for real-time data)
    return NextResponse.json({
      messages,
      stats: aggregatedStats,
      pagination: {
        limit,
        offset,
        total: aggregatedStats.total,
        hasMore: offset + messages.length < aggregatedStats.total,
      }
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      }
    })
  } catch (error) {
    console.error('Failed to fetch campaign messages:', error)
    return NextResponse.json(
      { error: 'Falha ao buscar mensagens', details: (error as Error).message },
      { status: 500 }
    )
  }
}
