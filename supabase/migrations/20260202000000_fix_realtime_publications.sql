-- Fix: Adicionar tabelas faltantes à publicação supabase_realtime,
-- habilitar REPLICA IDENTITY FULL em campaign_contacts e conceder
-- SELECT + RLS restritiva para permitir filtros por campaign_id no
-- Supabase Realtime.
--
-- Contexto: Os canais Realtime (centralized-realtime-v1, campaign-progress,
-- account-alerts-realtime) falhavam silenciosamente porque:
-- 1. contacts, templates, flows e account_alerts não estavam na publicação
-- 2. campaign_contacts tinha REPLICA IDENTITY DEFAULT (só PK), impedindo
--    filtros por campaign_id
-- 3. anon não tinha GRANT SELECT em campaign_contacts — a função
--    realtime.subscription_check_filters usa has_column_privilege()
--    para validar filtros, rejeitando com "invalid column for filter"

-- Adicionar tabelas à publicação (idempotente com IF NOT EXISTS via DO block)
DO $$
BEGIN
  -- contacts
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'contacts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE contacts;
  END IF;

  -- templates
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'templates'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE templates;
  END IF;

  -- flows
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'flows'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE flows;
  END IF;

  -- account_alerts
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'account_alerts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE account_alerts;
  END IF;
END;
$$;

-- Habilitar REPLICA IDENTITY FULL em campaign_contacts
-- Permite que o Supabase Realtime filtre por qualquer coluna (ex: campaign_id)
-- Trade-off: aumenta levemente o volume de WAL, mas campaign_contacts tem
-- volume controlado (ligado ao tamanho das campanhas)
ALTER TABLE campaign_contacts REPLICA IDENTITY FULL;

-- Conceder SELECT ao anon para satisfazer has_column_privilege() no Realtime,
-- mas bloquear leitura direta via REST API com RLS USING(false).
-- O Realtime recebe eventos via WAL (server-side, não passa por RLS),
-- então o filtro campaign_id funciona normalmente.
GRANT SELECT ON campaign_contacts TO anon;

CREATE POLICY deny_anon_select ON campaign_contacts
  FOR SELECT TO anon USING (false);
