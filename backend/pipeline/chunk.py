import json

from common.aws import get_env
from common.chunking import chunk_pages, chunk_warnings
from common.ids import new_id
from common.storage import read_json, write_text


env = get_env()


def handler(event, _context):
    tenant_id = event["tenantId"]
    dataset_id = event["datasetId"]
    file_id = event["fileId"]
    filename = event.get("filename", "unknown.pdf")

    pages = read_json(env["PROCESSED_BUCKET"], event["cleanedPagesKey"])

    chunks = chunk_pages(pages, min_len=800, max_len=1200, overlap=200)
    warnings = chunk_warnings(chunks)

    lines = []
    for chunk in chunks:
        chunk_id = new_id()
        page_range = chunk.get("pageRange", (0, 0))
        payload = {
            "chunkId": chunk_id,
            "text": chunk.get("text", ""),
            "metadata": {
                "datasetId": dataset_id,
                "fileId": file_id,
                "pageRange": {"start": page_range[0], "end": page_range[1]},
                "sourceFilename": filename
            }
        }
        lines.append(json.dumps(payload))

    base_prefix = f"processed/{tenant_id}/{dataset_id}/{file_id}"
    chunks_key = f"{base_prefix}/chunks.jsonl"
    write_text(env["PROCESSED_BUCKET"], chunks_key, "\n".join(lines))

    event.update({
        "chunksKey": chunks_key,
        "chunkStats": {"chunkCount": len(chunks)},
        "chunkWarnings": warnings
    })

    return event
