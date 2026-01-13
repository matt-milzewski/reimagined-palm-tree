import hashlib
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, Iterable, List, Optional
from urllib.parse import urlparse

import boto3
import urllib3
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from botocore.session import Session

from common.aws import get_env
from common.chunk_records import compute_content_hash
from common.ddb import update_dataset, put_audit, now_iso


env = get_env()
s3 = boto3.client("s3")
bedrock = boto3.client("bedrock-runtime")
cloudwatch = boto3.client("cloudwatch")
http = urllib3.PoolManager()


def log(level: str, message: str, **kwargs) -> None:
    payload = {"level": level, "message": message, **kwargs}
    print(json.dumps(payload))


def parse_endpoint(endpoint: str) -> str:
    if endpoint.startswith("http"):
        return endpoint.rstrip("/")
    return f"https://{endpoint}".rstrip("/")


def get_region() -> str:
    return os.environ.get("AWS_REGION") or boto3.session.Session().region_name or "us-east-1"


def opensearch_request(
    endpoint: str,
    method: str,
    path: str,
    body: Optional[object] = None,
    content_type: str = "application/json",
    raise_on_error: bool = True
) -> Dict:
    url = f"{endpoint}{path}"
    parsed = urlparse(url)
    data = None
    if body is not None:
        if isinstance(body, (dict, list)):
            data = json.dumps(body).encode("utf-8")
        elif isinstance(body, str):
            data = body.encode("utf-8")
        else:
            data = body

    payload_hash = hashlib.sha256(data or b"").hexdigest()
    headers = {
        "host": parsed.netloc,
        "x-amz-content-sha256": payload_hash
    }
    if data is not None:
        headers["content-type"] = content_type

    creds = Session().get_credentials()
    frozen = creds.get_frozen_credentials() if creds else None
    if frozen is None:
        raise Exception("Missing AWS credentials for OpenSearch request.")

    request = AWSRequest(method=method, url=url, data=data, headers=headers)
    SigV4Auth(frozen, "aoss", get_region()).add_auth(request)

    response = http.request(method, url, body=data, headers=dict(request.headers.items()))
    body_text = response.data.decode("utf-8") if response.data else ""

    if raise_on_error and response.status >= 300:
        raise Exception(f"OpenSearch request failed ({response.status}): {body_text}")

    return {"status": response.status, "body": body_text}


def ensure_index(endpoint: str, index_name: str, dimension: int) -> None:
    head = opensearch_request(endpoint, "HEAD", f"/{index_name}", raise_on_error=False)
    recreate = False
    if head["status"] == 200:
        mapping = opensearch_request(endpoint, "GET", f"/{index_name}/_mapping", raise_on_error=False)
        if mapping["status"] == 200 and mapping.get("body"):
            payload = json.loads(mapping["body"])
            index_mapping = payload.get(index_name, {})
            properties = index_mapping.get("mappings", {}).get("properties", {})
            vector_field = properties.get("vector", {})
            existing_dimension = vector_field.get("dimension")
            if existing_dimension and existing_dimension != dimension:
                opensearch_request(endpoint, "DELETE", f"/{index_name}")
                recreate = True
            else:
                return
        else:
            return
    if head["status"] not in (404, 400) and not recreate:
        raise Exception(f"Unexpected OpenSearch index check status {head['status']}")

    mapping = {
        "settings": {"index": {"knn": True}},
        "mappings": {
            "properties": {
                "tenant_id": {"type": "keyword"},
                "dataset_id": {"type": "keyword"},
                "doc_id": {"type": "keyword"},
                "chunk_id": {"type": "keyword"},
                "source_uri": {"type": "keyword"},
                "filename": {"type": "keyword"},
                "page": {"type": "integer"},
                "chunk_index": {"type": "integer"},
                "created_at": {"type": "date"},
                "embedding_model": {"type": "keyword"},
                "content_hash": {"type": "keyword"},
                "acl": {"type": "keyword"},
                "text": {"type": "text"},
                "vector": {"type": "knn_vector", "dimension": dimension}
            }
        }
    }

    opensearch_request(endpoint, "PUT", f"/{index_name}", body=mapping)


def delete_existing_doc(endpoint: str, index_name: str, tenant_id: str, dataset_id: str, doc_id: str) -> None:
    query = {
        "query": {
            "bool": {
                "filter": [
                    {"term": {"tenant_id": tenant_id}},
                    {"term": {"dataset_id": dataset_id}},
                    {"term": {"doc_id": doc_id}}
                ]
            }
        }
    }
    response = opensearch_request(
        endpoint,
        "POST",
        f"/{index_name}/_delete_by_query",
        body=query,
        raise_on_error=False
    )
    if response["status"] >= 300 and response["status"] != 404:
        raise Exception(f"OpenSearch delete_by_query failed ({response['status']}): {response.get('body')}")


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


def build_bulk_payload(index_name: str, records: List[Dict], embeddings: List[List[float]]) -> str:
    lines = []
    for record, embedding in zip(records, embeddings):
        action = {"index": {"_index": index_name}}
        doc = dict(record)
        doc["vector"] = embedding
        lines.append(json.dumps(action))
        lines.append(json.dumps(doc))
    return "\n".join(lines) + "\n"


def ensure_bulk_ok(response: Dict) -> None:
    body = response.get("body") or ""
    if not body:
        return
    payload = json.loads(body)
    if not payload.get("errors"):
        return
    items = payload.get("items", [])
    errors = []
    for item in items:
        action = next(iter(item.values()), {})
        error = action.get("error")
        if error:
            errors.append(error)
    sample = errors[:3]
    raise Exception(f"OpenSearch bulk errors: {json.dumps(sample)}")


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

        endpoint = parse_endpoint(env["OPENSEARCH_COLLECTION_ENDPOINT"])
        index_name = env["OPENSEARCH_INDEX_NAME"]
        model_id = env["BEDROCK_EMBED_MODEL_ID"]
        embedding_dimension = int(env["EMBEDDING_DIMENSION"] or "0")
        batch_size = int(env["INGEST_BATCH_SIZE"] or "50")
        concurrency = int(env["INGEST_CONCURRENCY"] or "4")

        if not endpoint or not index_name or not model_id:
            raise Exception("Vector ingestion is missing OpenSearch or Bedrock configuration.")
        if embedding_dimension <= 0:
            raise Exception("Embedding dimension must be configured.")

        start_time = time.time()
        update_dataset(tenant_id, dataset_id, {"status": "INDEXING"})
        put_audit(
            tenant_id,
            "DATASET_INDEXING_STARTED",
            {"datasetId": dataset_id, "fileId": file_id, "jobId": job_id}
        )

        ensure_index(endpoint, index_name, embedding_dimension)
        delete_existing_doc(endpoint, index_name, tenant_id, dataset_id, file_id)

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
                payload = build_bulk_payload(index_name, batch, embeddings)
                response = opensearch_request(
                    endpoint,
                    "POST",
                    f"/{index_name}/_bulk",
                    body=payload,
                    content_type="application/x-ndjson"
                )
                ensure_bulk_ok(response)
                processed += len(batch)
                batch = []

        if batch:
            embeddings = embed_texts([item["text"] for item in batch], model_id, concurrency)
            if embedding_dimension and embeddings and len(embeddings[0]) != embedding_dimension:
                raise Exception("Embedding dimension mismatch.")
            payload = build_bulk_payload(index_name, batch, embeddings)
            response = opensearch_request(
                endpoint,
                "POST",
                f"/{index_name}/_bulk",
                body=payload,
                content_type="application/x-ndjson"
            )
            ensure_bulk_ok(response)
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
