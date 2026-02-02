import json
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, Iterable, List

import boto3

from common.aws import get_env
from common.chunk_records import compute_content_hash
from common.ddb import update_dataset, put_audit, now_iso
from common.postgres import (
    get_connection,
    ensure_extension,
    delete_existing_doc,
    bulk_insert_chunks
)


env = get_env()
s3 = boto3.client("s3")
bedrock = boto3.client("bedrock-runtime")
cloudwatch = boto3.client("cloudwatch")


def log(level: str, message: str, **kwargs) -> None:
    payload = {"level": level, "message": message, **kwargs}
    print(json.dumps(payload))


def read_chunks(bucket: str, key: str) -> Iterable[Dict]:
    response = s3.get_object(Bucket=bucket, Key=key)
    for line in response["Body"].iter_lines():
        if not line:
            continue
        payload = json.loads(line.decode("utf-8"))
        yield payload


def embed_text(text: str, model_id: str) -> List[float]:
    payload = json.dumps({"inputText": text})
    response = bedrock.invoke_model(
        modelId=model_id,
        contentType="application/json",
        accept="application/json",
        body=payload
    )
    body = json.loads(response["body"].read().decode("utf-8"))
    if "embedding" in body:
        return body["embedding"]
    if "embeddings" in body and isinstance(body["embeddings"], list):
        return body["embeddings"][0]
    if "vector" in body:
        return body["vector"]
    raise Exception("Unsupported embedding response format.")


def embed_texts(texts: List[str], model_id: str, max_workers: int) -> List[List[float]]:
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        return list(executor.map(lambda t: embed_text(t, model_id), texts))


def normalize_record(
    record: Dict,
    *,
    tenant_id: str,
    dataset_id: str,
    doc_id: str,
    source_uri: str,
    filename: str,
    chunk_index: int,
    created_at: str,
    embedding_model: str
) -> Dict:
    normalized = dict(record)
    legacy_chunk_id = normalized.get("chunkId")
    if legacy_chunk_id and not normalized.get("chunk_id"):
        normalized["chunk_id"] = legacy_chunk_id
    normalized.pop("metadata", None)
    normalized.pop("chunkId", None)
    normalized["tenant_id"] = tenant_id
    normalized["dataset_id"] = dataset_id
    normalized["doc_id"] = normalized.get("doc_id") or doc_id
    normalized["source_uri"] = normalized.get("source_uri") or source_uri
    normalized["filename"] = normalized.get("filename") or filename
    normalized["chunk_index"] = normalized.get("chunk_index", chunk_index)
    normalized["page"] = normalized.get("page")
    normalized["created_at"] = normalized.get("created_at") or created_at
    normalized["embedding_model"] = normalized.get("embedding_model") or embedding_model
    normalized["acl"] = normalized.get("acl") or []

    if not normalized.get("chunk_id"):
        page_value = normalized.get("page") or 0
        normalized["chunk_id"] = f"{normalized['doc_id']}#p{page_value}#c{normalized['chunk_index']}"

    if not normalized.get("content_hash"):
        normalized["content_hash"] = compute_content_hash(
            normalized["doc_id"],
            normalized.get("page"),
            normalized["chunk_index"],
            normalized.get("text", "")
        )

    return normalized


def publish_metric(name: str, value: float, unit: str = "Count") -> None:
    try:
        cloudwatch.put_metric_data(
            Namespace="RagReady/Pipeline",
            MetricData=[
                {"MetricName": name, "Value": value, "Unit": unit}
            ]
        )
    except Exception as error:
        log("WARN", "Failed to publish metric", metric=name, error=str(error))


def handler(event, _context):
    tenant_id = event["tenantId"]
    dataset_id = event["datasetId"]
    file_id = event["fileId"]
    job_id = event.get("jobId")

    try:
        chunks_key = event.get("chunksKey")
        filename = event.get("filename", "unknown.pdf")
        raw_key = event.get("rawS3Key", "")

        if not chunks_key:
            raise Exception("Missing chunksKey for vector ingestion.")

        model_id = env["BEDROCK_EMBED_MODEL_ID"]
        embedding_dimension = int(env["EMBEDDING_DIMENSION"] or "0")
        batch_size = int(env["INGEST_BATCH_SIZE"] or "50")
        concurrency = int(env["INGEST_CONCURRENCY"] or "4")

        if not model_id:
            raise Exception("Vector ingestion is missing Bedrock configuration.")
        if embedding_dimension <= 0:
            raise Exception("Embedding dimension must be configured.")

        start_time = time.time()
        update_dataset(tenant_id, dataset_id, {"status": "INDEXING"})
        put_audit(
            tenant_id,
            "DATASET_INDEXING_STARTED",
            {"datasetId": dataset_id, "fileId": file_id, "jobId": job_id}
        )

        # Connect to PostgreSQL and ensure pgvector extension is enabled
        conn = get_connection()
        ensure_extension(conn)

        # Delete existing chunks for this document before re-indexing
        delete_existing_doc(conn, tenant_id, dataset_id, file_id)

        source_uri = f"s3://{env['RAW_BUCKET']}/{raw_key}" if raw_key else ""
        created_at = now_iso()

        processed = 0
        batch: List[Dict] = []
        for idx, record in enumerate(read_chunks(env["PROCESSED_BUCKET"], chunks_key)):
            text = record.get("text", "")
            if not text.strip():
                continue
            normalized = normalize_record(
                record,
                tenant_id=tenant_id,
                dataset_id=dataset_id,
                doc_id=file_id,
                source_uri=source_uri,
                filename=filename,
                chunk_index=idx,
                created_at=created_at,
                embedding_model=model_id
            )
            batch.append(normalized)

            if len(batch) >= batch_size:
                embeddings = embed_texts([item["text"] for item in batch], model_id, concurrency)
                if embedding_dimension and embeddings and len(embeddings[0]) != embedding_dimension:
                    raise Exception("Embedding dimension mismatch.")
                bulk_insert_chunks(conn, batch, embeddings)
                processed += len(batch)
                batch = []

        if batch:
            embeddings = embed_texts([item["text"] for item in batch], model_id, concurrency)
            if embedding_dimension and embeddings and len(embeddings[0]) != embedding_dimension:
                raise Exception("Embedding dimension mismatch.")
            bulk_insert_chunks(conn, batch, embeddings)
            processed += len(batch)

        update_dataset(tenant_id, dataset_id, {"status": "READY"})
        put_audit(tenant_id, "DATASET_READY", {"datasetId": dataset_id, "fileId": file_id, "jobId": job_id})

        duration_ms = int((time.time() - start_time) * 1000)
        publish_metric("VectorIngestSuccess", 1)
        publish_metric("VectorIngestLatencyMs", duration_ms, unit="Milliseconds")

        log(
            "INFO",
            "Vector ingestion complete",
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            file_id=file_id,
            job_id=job_id,
            chunks=processed,
            duration_ms=duration_ms
        )

        event.update({"vectorIngested": processed})
        return event
    except Exception as error:
        publish_metric("VectorIngestFailure", 1)
        log(
            "ERROR",
            "Vector ingestion failed",
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            file_id=file_id,
            job_id=job_id,
            error=str(error)
        )
        raise
