import json

from common.aws import get_env
from common.chunk_records import build_chunk_record
from common.chunking import chunk_pages, chunk_warnings
from common.ddb import update_dataset, now_iso
from common.storage import read_json, write_text


env = get_env()


def handler(event, _context):
    tenant_id = event["tenantId"]
    dataset_id = event["datasetId"]
    file_id = event["fileId"]
    filename = event.get("filename", "unknown.pdf")
    raw_key = event.get("rawS3Key", "")

    pages = read_json(env["PROCESSED_BUCKET"], event["cleanedPagesKey"])

    chunks = chunk_pages(pages, min_len=800, max_len=1200, overlap=200)
    warnings = chunk_warnings(chunks)

    lines = []
    created_at = now_iso()
    embedding_model = env.get("BEDROCK_EMBED_MODEL_ID") or "unknown"
    source_uri = f"s3://{env['RAW_BUCKET']}/{raw_key}" if raw_key else ""
    for index, chunk in enumerate(chunks):
        page_range = chunk.get("pageRange", (0, 0))
        payload = build_chunk_record(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            doc_id=file_id,
            source_uri=source_uri,
            filename=filename,
            page=page_range[0] if page_range else None,
            chunk_index=index,
            text=chunk.get("text", ""),
            created_at=created_at,
            embedding_model=embedding_model
        )
        payload["chunkId"] = payload["chunk_id"]
        payload["metadata"] = {
            "datasetId": dataset_id,
            "fileId": file_id,
            "pageRange": {"start": page_range[0], "end": page_range[1]},
            "sourceFilename": filename
        }
        lines.append(json.dumps(payload))

    base_prefix = f"processed/{tenant_id}/{dataset_id}/{file_id}"
    chunks_key = f"{base_prefix}/chunks.jsonl"
    write_text(env["PROCESSED_BUCKET"], chunks_key, "\n".join(lines))

    update_dataset(tenant_id, dataset_id, {"status": "CHUNKED"})

    event.update({
        "chunksKey": chunks_key,
        "chunkStats": {"chunkCount": len(chunks)},
        "chunkWarnings": warnings
    })

    return event
