#!/usr/bin/env python3
"""
Migrate vectors from OpenSearch Serverless to PostgreSQL pgvector.

Usage:
    export OPENSEARCH_COLLECTION_ENDPOINT="https://xxx.us-east-1.aoss.amazonaws.com"
    export OPENSEARCH_INDEX_NAME="ragready_chunks_v1"
    export DB_HOST="ragready-dev-vector-db.xxx.us-east-1.rds.amazonaws.com"
    export DB_PORT="5432"
    export DB_NAME="ragready"
    export DB_USER="ragready_admin"
    export DB_PASSWORD="your-password"

    python scripts/migrate-data.py
"""

import hashlib
import json
import os
import sys
from typing import Dict, List, Generator

import boto3
import psycopg2
from psycopg2.extras import execute_values
from pgvector.psycopg2 import register_vector
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from botocore.session import Session
import urllib3

http = urllib3.PoolManager()

# Configuration from environment
OPENSEARCH_ENDPOINT = os.environ.get("OPENSEARCH_COLLECTION_ENDPOINT", "")
OPENSEARCH_INDEX = os.environ.get("OPENSEARCH_INDEX_NAME", "ragready_chunks_v1")
DB_HOST = os.environ.get("DB_HOST", "")
DB_PORT = os.environ.get("DB_PORT", "5432")
DB_NAME = os.environ.get("DB_NAME", "ragready")
DB_USER = os.environ.get("DB_USER", "")
DB_PASSWORD = os.environ.get("DB_PASSWORD", "")
BATCH_SIZE = 100
REGION = os.environ.get("AWS_REGION", "us-east-1")


def log(level: str, message: str, **kwargs) -> None:
    """Print structured log message."""
    payload = {"level": level, "message": message, **kwargs}
    print(json.dumps(payload))


def parse_endpoint(endpoint: str) -> str:
    """Ensure endpoint has https:// prefix."""
    if not endpoint:
        raise ValueError("OPENSEARCH_COLLECTION_ENDPOINT is required")
    if endpoint.startswith("http"):
        return endpoint.rstrip("/")
    return f"https://{endpoint}".rstrip("/")


def opensearch_request(method: str, path: str, body: object = None) -> Dict:
    """Make signed request to OpenSearch Serverless."""
    endpoint = parse_endpoint(OPENSEARCH_ENDPOINT)
    url = f"{endpoint}{path}"

    from urllib.parse import urlparse
    parsed = urlparse(url)

    data = json.dumps(body).encode("utf-8") if body else None
    payload_hash = hashlib.sha256(data or b"").hexdigest()

    headers = {
        "host": parsed.netloc,
        "x-amz-content-sha256": payload_hash,
        "content-type": "application/json"
    }

    creds = Session().get_credentials()
    if not creds:
        raise ValueError("AWS credentials not found")
    frozen = creds.get_frozen_credentials()

    request = AWSRequest(method=method, url=url, data=data, headers=headers)
    SigV4Auth(frozen, "aoss", REGION).add_auth(request)

    response = http.request(method, url, body=data, headers=dict(request.headers.items()))
    body_text = response.data.decode("utf-8") if response.data else ""

    if response.status >= 300:
        raise Exception(f"OpenSearch request failed ({response.status}): {body_text}")

    return json.loads(body_text) if body_text else {}


def get_postgres_conn():
    """Get PostgreSQL connection with pgvector support."""
    if not DB_HOST or not DB_USER or not DB_PASSWORD:
        raise ValueError("DB_HOST, DB_USER, and DB_PASSWORD are required")

    conn = psycopg2.connect(
        host=DB_HOST,
        port=int(DB_PORT),
        database=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
        sslmode="require"
    )
    register_vector(conn)
    return conn


def scroll_opensearch(index: str, batch_size: int = 100) -> Generator[List[Dict], None, None]:
    """Scroll through all documents in OpenSearch index."""
    log("INFO", "Starting OpenSearch scroll", index=index, batch_size=batch_size)

    # Initial search with scroll
    query = {
        "size": batch_size,
        "query": {"match_all": {}},
        "sort": ["_doc"]
    }

    response = opensearch_request("POST", f"/{index}/_search?scroll=5m", query)
    scroll_id = response.get("_scroll_id")
    hits = response.get("hits", {}).get("hits", [])
    total = response.get("hits", {}).get("total", {})
    total_count = total.get("value", 0) if isinstance(total, dict) else total

    log("INFO", "OpenSearch scroll initialized", total_documents=total_count)

    while hits:
        yield hits

        if not scroll_id:
            break

        # Continue scrolling
        response = opensearch_request("POST", "/_search/scroll", {
            "scroll": "5m",
            "scroll_id": scroll_id
        })
        scroll_id = response.get("_scroll_id")
        hits = response.get("hits", {}).get("hits", [])


def migrate_batch(conn, hits: List[Dict]) -> int:
    """Insert batch of documents into PostgreSQL."""
    if not hits:
        return 0

    values = []
    for hit in hits:
        source = hit.get("_source", {})

        # Extract vector from OpenSearch document
        vector = source.get("vector")
        if not vector:
            log("WARN", "Skipping document without vector", chunk_id=source.get("chunk_id"))
            continue

        values.append((
            source.get("tenant_id"),
            source.get("dataset_id"),
            source.get("doc_id"),
            source.get("chunk_id"),
            source.get("source_uri"),
            source.get("filename"),
            source.get("page"),
            source.get("chunk_index"),
            source.get("text"),
            vector,
            source.get("content_hash"),
            source.get("embedding_model"),
            source.get("acl") or [],
            source.get("created_at"),
            source.get("doc_type"),
            source.get("discipline"),
            source.get("section_reference"),
            source.get("standards_referenced")
        ))

    if not values:
        return 0

    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO chunks (
                tenant_id, dataset_id, doc_id, chunk_id, source_uri, filename,
                page, chunk_index, text, embedding, content_hash, embedding_model,
                acl, created_at, doc_type, discipline, section_reference, standards_referenced
            ) VALUES %s
            ON CONFLICT (chunk_id) DO NOTHING
            """,
            values
        )
        inserted = cur.rowcount
    conn.commit()
    return inserted


def verify_migration(conn) -> Dict:
    """Verify migration by counting documents per tenant/dataset."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT tenant_id, dataset_id, COUNT(*)
            FROM chunks
            GROUP BY tenant_id, dataset_id
            ORDER BY tenant_id, dataset_id
        """)
        results = cur.fetchall()

    summary = {}
    for tenant_id, dataset_id, count in results:
        key = f"{tenant_id}#{dataset_id}"
        summary[key] = count

    return summary


def main():
    """Main migration function."""
    log("INFO", "Starting OpenSearch to PostgreSQL migration")
    log("INFO", "Configuration",
        opensearch_index=OPENSEARCH_INDEX,
        db_host=DB_HOST,
        db_name=DB_NAME,
        batch_size=BATCH_SIZE)

    # Validate configuration
    if not OPENSEARCH_ENDPOINT:
        log("ERROR", "OPENSEARCH_COLLECTION_ENDPOINT is required")
        sys.exit(1)
    if not DB_HOST or not DB_USER or not DB_PASSWORD:
        log("ERROR", "DB_HOST, DB_USER, and DB_PASSWORD are required")
        sys.exit(1)

    conn = get_postgres_conn()
    total_migrated = 0
    total_batches = 0

    try:
        for batch in scroll_opensearch(OPENSEARCH_INDEX, BATCH_SIZE):
            migrated = migrate_batch(conn, batch)
            total_migrated += migrated
            total_batches += 1
            log("INFO", "Batch migrated",
                batch_number=total_batches,
                batch_size=len(batch),
                inserted=migrated,
                total_migrated=total_migrated)

        log("INFO", "Migration complete",
            total_documents=total_migrated,
            total_batches=total_batches)

        # Verify migration
        summary = verify_migration(conn)
        log("INFO", "Migration verification", datasets=len(summary), summary=summary)

    except Exception as e:
        log("ERROR", "Migration failed", error=str(e))
        raise
    finally:
        conn.close()

    print(f"\nMigration complete. Total documents migrated: {total_migrated}")
    return total_migrated


if __name__ == "__main__":
    main()
