-- PostgreSQL + pgvector schema migration for RagReady
-- Run this script after creating the RDS instance

-- Enable pgvector extension (requires rds_superuser or rds.allowed_extensions parameter)
CREATE EXTENSION IF NOT EXISTS vector;

-- Main chunks table for vector storage
CREATE TABLE IF NOT EXISTS chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64) NOT NULL,
    dataset_id VARCHAR(64) NOT NULL,
    doc_id VARCHAR(64) NOT NULL,
    chunk_id VARCHAR(128) UNIQUE NOT NULL,
    source_uri TEXT,
    filename VARCHAR(255),
    page INTEGER,
    chunk_index INTEGER,
    text TEXT,
    embedding vector(1024),  -- 1024 dimensions for Titan v2
    content_hash VARCHAR(64),
    embedding_model VARCHAR(128),
    acl TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Construction-specific metadata
    doc_type VARCHAR(32),
    discipline VARCHAR(32),
    section_reference VARCHAR(64),
    standards_referenced TEXT[]
);

-- B-tree index for tenant/dataset filtering (critical for multi-tenancy)
CREATE INDEX IF NOT EXISTS idx_chunks_tenant_dataset
    ON chunks(tenant_id, dataset_id);

-- B-tree index for document-level operations (delete before re-index)
CREATE INDEX IF NOT EXISTS idx_chunks_tenant_dataset_doc
    ON chunks(tenant_id, dataset_id, doc_id);

-- HNSW index for approximate nearest neighbor vector search
-- HNSW provides better query performance than IVFFlat for most workloads
-- m=16: number of bi-directional links per node (higher = better recall, more memory)
-- ef_construction=64: size of dynamic candidate list during index build
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw
    ON chunks USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Optional: Create index for content_hash to speed up deduplication queries
CREATE INDEX IF NOT EXISTS idx_chunks_content_hash
    ON chunks(content_hash);

-- Grant permissions (adjust role names as needed)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON chunks TO ragready_app;
-- GRANT USAGE ON SCHEMA public TO ragready_app;
