"""PostgreSQL + pgvector client for vector storage and search."""

import json
import os
from typing import Dict, List, Optional

import boto3
import psycopg2
from psycopg2.extras import execute_values
from pgvector.psycopg2 import register_vector

# Module-level connection cache
_connection: Optional[psycopg2.extensions.connection] = None


def get_db_secret() -> Dict:
    """Retrieve database credentials from AWS Secrets Manager."""
    secret_arn = os.environ.get("DB_SECRET_ARN", "")
    if not secret_arn:
        raise ValueError("Missing DB_SECRET_ARN environment variable")

    client = boto3.client("secretsmanager")
    response = client.get_secret_value(SecretId=secret_arn)
    return json.loads(response["SecretString"])


def get_connection() -> psycopg2.extensions.connection:
    """Get or create a database connection with pgvector support."""
    global _connection
    if _connection is None or _connection.closed:
        secret = get_db_secret()
        _connection = psycopg2.connect(
            host=os.environ.get("DB_HOST", ""),
            port=int(os.environ.get("DB_PORT", "5432")),
            database=os.environ.get("DB_NAME", "ragready"),
            user=secret["username"],
            password=secret["password"],
            sslmode="require"
        )
        register_vector(_connection)
    return _connection


def ensure_extension(conn: psycopg2.extensions.connection) -> None:
    """Ensure pgvector extension is enabled in the database."""
    with conn.cursor() as cur:
        cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
    conn.commit()


def delete_existing_doc(
    conn: psycopg2.extensions.connection,
    tenant_id: str,
    dataset_id: str,
    doc_id: str
) -> int:
    """Delete all existing chunks for a document before re-indexing."""
    with conn.cursor() as cur:
        cur.execute(
            """
            DELETE FROM chunks
            WHERE tenant_id = %s AND dataset_id = %s AND doc_id = %s
            """,
            (tenant_id, dataset_id, doc_id)
        )
        deleted = cur.rowcount
    conn.commit()
    return deleted


def bulk_insert_chunks(
    conn: psycopg2.extensions.connection,
    records: List[Dict],
    embeddings: List[List[float]]
) -> int:
    """Bulk insert chunks with embeddings using execute_values for efficiency."""
    if not records:
        return 0

    values = []
    for record, embedding in zip(records, embeddings):
        values.append((
            record.get("tenant_id"),
            record.get("dataset_id"),
            record.get("doc_id"),
            record.get("chunk_id"),
            record.get("source_uri"),
            record.get("filename"),
            record.get("page"),
            record.get("chunk_index"),
            record.get("text"),
            embedding,
            record.get("content_hash"),
            record.get("embedding_model"),
            record.get("acl") or [],
            record.get("created_at"),
            record.get("doc_type"),
            record.get("discipline"),
            record.get("section_reference"),
            record.get("standards_referenced")
        ))

    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO chunks (
                tenant_id, dataset_id, doc_id, chunk_id, source_uri, filename,
                page, chunk_index, text, embedding, content_hash, embedding_model,
                acl, created_at, doc_type, discipline, section_reference, standards_referenced
            ) VALUES %s
            ON CONFLICT (chunk_id) DO UPDATE SET
                text = EXCLUDED.text,
                embedding = EXCLUDED.embedding,
                content_hash = EXCLUDED.content_hash,
                created_at = EXCLUDED.created_at
            """,
            values
        )
        inserted = cur.rowcount
    conn.commit()
    return inserted


def vector_search(
    conn: psycopg2.extensions.connection,
    tenant_id: str,
    dataset_id: str,
    query_vector: List[float],
    top_k: int = 8
) -> List[Dict]:
    """Perform vector similarity search using cosine distance."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                chunk_id, doc_id, filename, page, chunk_index, text,
                source_uri, content_hash, doc_type, discipline,
                section_reference, standards_referenced,
                1 - (embedding <=> %s::vector) AS score
            FROM chunks
            WHERE tenant_id = %s AND dataset_id = %s
            ORDER BY embedding <=> %s::vector
            LIMIT %s
            """,
            (query_vector, tenant_id, dataset_id, query_vector, top_k)
        )
        columns = [desc[0] for desc in cur.description]
        results = []
        for row in cur.fetchall():
            results.append(dict(zip(columns, row)))
    return results


def close_connection() -> None:
    """Close the database connection if open."""
    global _connection
    if _connection is not None and not _connection.closed:
        _connection.close()
        _connection = None
