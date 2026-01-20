-- =============================================================================
-- Migration: RAG com pgvector
-- Descrição: Habilita pgvector e cria infraestrutura para RAG próprio,
--            substituindo a dependência do Google File Search
-- =============================================================================

-- =============================================================================
-- PARTE 1: HABILITAR EXTENSÃO PGVECTOR
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- =============================================================================
-- PARTE 2: ADICIONAR CONFIG RAG NA TABELA AI_AGENTS
-- =============================================================================

-- Configuração do provider de embeddings
ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS embedding_provider TEXT DEFAULT 'google';
ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS embedding_model TEXT DEFAULT 'gemini-embedding-001';
ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS embedding_dimensions INTEGER DEFAULT 768;

-- Configuração de reranking (opcional)
ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS rerank_enabled BOOLEAN DEFAULT false;
ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS rerank_provider TEXT;
ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS rerank_model TEXT;
ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS rerank_top_k INTEGER DEFAULT 5;

-- Configuração de busca RAG
ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS rag_similarity_threshold REAL DEFAULT 0.5;
ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS rag_max_results INTEGER DEFAULT 5;

-- =============================================================================
-- PARTE 3: ADICIONAR CHUNKS_COUNT NA TABELA AI_KNOWLEDGE_FILES
-- =============================================================================

ALTER TABLE ai_knowledge_files ADD COLUMN IF NOT EXISTS chunks_count INTEGER DEFAULT 0;

-- =============================================================================
-- PARTE 4: CRIAR TABELA DE EMBEDDINGS
-- =============================================================================

-- Nota: Usamos 3072 como máximo (OpenAI text-embedding-3-large)
-- Vetores menores (768 do Gemini, 1024 do Voyage) são compatíveis
CREATE TABLE IF NOT EXISTS ai_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL,
  file_id UUID,
  content TEXT NOT NULL,
  embedding VECTOR(3072) NOT NULL,
  dimensions INTEGER NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Foreign keys
ALTER TABLE ai_embeddings
  ADD CONSTRAINT ai_embeddings_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES ai_agents(id) ON DELETE CASCADE;

ALTER TABLE ai_embeddings
  ADD CONSTRAINT ai_embeddings_file_id_fkey
  FOREIGN KEY (file_id) REFERENCES ai_knowledge_files(id) ON DELETE CASCADE;

-- =============================================================================
-- PARTE 5: ÍNDICES PARA BUSCA EFICIENTE
-- =============================================================================

-- Index HNSW para busca por similaridade de cosseno
-- HNSW é mais rápido que IVFFlat para reads, ideal para RAG
CREATE INDEX IF NOT EXISTS ai_embeddings_embedding_idx
  ON ai_embeddings USING hnsw (embedding vector_cosine_ops);

-- Index para filtrar por agente (muito usado nas queries)
CREATE INDEX IF NOT EXISTS ai_embeddings_agent_id_idx
  ON ai_embeddings(agent_id);

-- Index para filtrar por arquivo (útil para deletar embeddings de um arquivo)
CREATE INDEX IF NOT EXISTS ai_embeddings_file_id_idx
  ON ai_embeddings(file_id);

-- Index composto para queries comuns
CREATE INDEX IF NOT EXISTS ai_embeddings_agent_dimensions_idx
  ON ai_embeddings(agent_id, dimensions);

-- =============================================================================
-- PARTE 6: FUNÇÃO DE BUSCA POR SIMILARIDADE
-- =============================================================================

CREATE OR REPLACE FUNCTION search_embeddings(
  query_embedding VECTOR(3072),
  agent_id_filter UUID,
  expected_dimensions INTEGER,
  match_threshold FLOAT DEFAULT 0.5,
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  similarity FLOAT,
  metadata JSONB
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.content,
    (1 - (e.embedding <=> query_embedding))::FLOAT AS similarity,
    e.metadata
  FROM ai_embeddings e
  WHERE e.agent_id = agent_id_filter
    AND e.dimensions = expected_dimensions
    AND (1 - (e.embedding <=> query_embedding)) > match_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- =============================================================================
-- PARTE 7: RLS POLICIES PARA AI_EMBEDDINGS
-- =============================================================================

ALTER TABLE ai_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_embeddings_select_authenticated"
  ON ai_embeddings FOR SELECT TO authenticated USING (true);

CREATE POLICY "ai_embeddings_insert_authenticated"
  ON ai_embeddings FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "ai_embeddings_update_authenticated"
  ON ai_embeddings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "ai_embeddings_delete_authenticated"
  ON ai_embeddings FOR DELETE TO authenticated USING (true);

-- =============================================================================
-- PARTE 8: COMENTÁRIOS DE DOCUMENTAÇÃO
-- =============================================================================

COMMENT ON TABLE ai_embeddings IS 'Armazena embeddings vetoriais para RAG (Retrieval-Augmented Generation)';
COMMENT ON COLUMN ai_embeddings.embedding IS 'Vetor de embedding (max 3072 dimensões para compatibilidade com múltiplos providers)';
COMMENT ON COLUMN ai_embeddings.dimensions IS 'Número real de dimensões do vetor (768 para Gemini, 3072 para OpenAI large, etc)';
COMMENT ON COLUMN ai_agents.embedding_provider IS 'Provider de embeddings: google, openai, voyage, cohere';
COMMENT ON COLUMN ai_agents.embedding_model IS 'Modelo de embedding específico do provider';
COMMENT ON COLUMN ai_agents.rerank_enabled IS 'Se habilitado, aplica reranking nos resultados da busca';
COMMENT ON FUNCTION search_embeddings IS 'Busca embeddings similares usando distância de cosseno. Retorna apenas vetores com dimensões compatíveis.';
