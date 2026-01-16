# OpenSearch Cost Analysis & Recommendations

## Current Situation

### OpenSearch Serverless Costs
| Component | Cost | Monthly |
|-----------|------|---------|
| Search OCUs (min 2) | $0.24/OCU/hour | ~$350 |
| Indexing OCUs (min 2) | $0.24/OCU/hour | ~$350 |
| Storage | $0.024/GB/month | ~$5-20 |
| **Total Minimum** | | **~$700-720/month** |

**Problem:** OpenSearch Serverless has a minimum of 4 OCUs (2 search + 2 indexing) regardless of usage. For a startup with few paying customers, this is unsustainable.

---

## Alternative Solutions Comparison

| Solution | Monthly Cost | Vectors Supported | Complexity | Latency |
|----------|--------------|-------------------|------------|---------|
| **OpenSearch Serverless** | $700+ | Unlimited | Low | <50ms |
| **PostgreSQL + pgvector** | $20-50 | Millions | Medium | <100ms |
| **Pinecone Starter** | $0-70 | 100k-1M | Low | <100ms |
| **Qdrant Cloud** | $0-25 | 100k-500k | Low | <50ms |
| **Aurora Serverless v2** | $50-100 | Millions | Medium | <100ms |
| **Self-hosted Qdrant (EC2)** | $15-30 | Millions | High | <50ms |

---

## Recommended Solution: PostgreSQL + pgvector

### Why PostgreSQL with pgvector?

1. **Cost:** ~$20-50/month (95% savings)
2. **Proven:** Used by major companies for vector search
3. **AWS Native:** RDS PostgreSQL fully managed
4. **Hybrid Search:** Supports both vector + keyword search
5. **Scalable:** Handles millions of vectors easily
6. **Simple Migration:** Similar query patterns

### Cost Breakdown

| RDS Instance | vCPU | RAM | Monthly Cost |
|--------------|------|-----|--------------|
| db.t4g.micro | 2 | 1GB | ~$12 |
| db.t4g.small | 2 | 2GB | ~$25 |
| db.t4g.medium | 2 | 4GB | ~$50 |
| db.t4g.large | 2 | 8GB | ~$100 |

**Recommendation:** Start with `db.t4g.small` (~$25/month) and scale as needed.

### Implementation Changes Required

#### 1. Database Schema

```sql
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create chunks table
CREATE TABLE chunks (
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
    embedding vector(1024),  -- 1024 dimensions for Titan
    content_hash VARCHAR(64),
    created_at TIMESTAMP DEFAULT NOW(),

    -- Construction metadata
    doc_type VARCHAR(32),
    discipline VARCHAR(32),
    section_reference VARCHAR(64),
    standards_referenced TEXT[],

    -- Indexes
    CONSTRAINT chunks_tenant_dataset_idx
        INDEX (tenant_id, dataset_id)
);

-- Vector similarity index (IVFFlat for large datasets)
CREATE INDEX chunks_embedding_idx ON chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- Or HNSW for faster queries (recommended)
CREATE INDEX chunks_embedding_hnsw_idx ON chunks
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
```

#### 2. Query Pattern

```sql
-- Vector similarity search with tenant isolation
SELECT
    chunk_id,
    filename,
    page,
    text,
    doc_type,
    discipline,
    section_reference,
    standards_referenced,
    1 - (embedding <=> $1::vector) AS score
FROM chunks
WHERE tenant_id = $2
  AND dataset_id = $3
ORDER BY embedding <=> $1::vector
LIMIT $4;
```

#### 3. Files to Modify

| File | Changes |
|------|---------|
| `infra/lib/vector-stack.ts` | Replace with RDS PostgreSQL stack |
| `backend/pipeline/vector_ingest.py` | Use psycopg2 instead of OpenSearch |
| `backend/api/src/opensearch.ts` | Replace with PostgreSQL queries |
| `backend/api/src/handler.ts` | Update vector search calls |

---

## Migration Plan

### Phase 1: Infrastructure (1-2 days)
1. Create RDS PostgreSQL instance with pgvector
2. Set up security groups and IAM
3. Create database schema

### Phase 2: Ingestion Pipeline (1-2 days)
1. Update `vector_ingest.py` to use PostgreSQL
2. Test bulk insert performance
3. Add connection pooling

### Phase 3: Query API (1 day)
1. Update `handler.ts` to query PostgreSQL
2. Test vector similarity search
3. Verify latency is acceptable

### Phase 4: Data Migration (1 day)
1. Export existing vectors from OpenSearch
2. Import into PostgreSQL
3. Validate data integrity

### Phase 5: Cutover (1 day)
1. Switch to PostgreSQL
2. Monitor for issues
3. Delete OpenSearch collection

---

## Quick Wins (If Keeping OpenSearch)

If you want to keep OpenSearch temporarily, these changes won't help much since the minimum OCU cost is fixed, but they'll optimize usage:

1. **No immediate savings possible** - 4 OCU minimum is fixed
2. **Consider switching regions** - Some regions may have lower pricing
3. **Batch queries** - Reduce API call overhead
4. **Cache frequent queries** - Add ElastiCache for repeated queries

---

## Alternative: Pinecone (Simplest Migration)

If you want minimal code changes:

### Pinecone Pricing
| Tier | Vectors | Cost |
|------|---------|------|
| Starter | 100k | Free |
| Standard | 1M | $70/month |
| Enterprise | 10M+ | Custom |

### Pros
- Drop-in replacement for vector search
- Fully managed
- Very fast queries

### Cons
- Vendor lock-in
- No hybrid search (text + vector)
- Less control

---

## Recommendation

**For your situation (few paying customers, need to reduce costs):**

### Immediate (This Week)
→ **Migrate to PostgreSQL + pgvector**
- Reduces costs from ~$700/month to ~$25/month
- Maintains all functionality
- Battle-tested solution

### Alternative (If Time-Constrained)
→ **Migrate to Pinecone Starter**
- Free tier for up to 100k vectors
- Fastest migration path
- Good for MVP validation

---

## Implementation Support

I can help implement the PostgreSQL migration if you'd like. The main changes are:

1. New CDK stack for RDS PostgreSQL
2. Updated Python ingestion code
3. Updated TypeScript query code
4. Data migration script

Would you like me to proceed with implementing the PostgreSQL + pgvector solution?
