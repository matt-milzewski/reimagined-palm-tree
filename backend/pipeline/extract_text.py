import hashlib
from io import BytesIO
from pypdf import PdfReader

from common.aws import get_env, get_s3_client
from common.ddb import update_file
from common.storage import write_text, write_json
from common.text import compute_extraction_stats, normalize_whitespace


env = get_env()
s3 = get_s3_client()


def handler(event, _context):
    tenant_id = event["tenantId"]
    dataset_id = event["datasetId"]
    file_id = event["fileId"]
    raw_key = event["rawS3Key"]

    response = s3.get_object(Bucket=env["RAW_BUCKET"], Key=raw_key)
    data = response["Body"].read()

    raw_sha256 = hashlib.sha256(data).hexdigest()

    reader = PdfReader(BytesIO(data))
    pages = []
    for i, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        text = normalize_whitespace(text)
        pages.append({"pageNumber": i + 1, "text": text})

    extraction_stats = compute_extraction_stats(pages)
    if extraction_stats["textLength"] < 50:
        raise Exception("No extractable text. Scanned PDF not supported in MVP.")

    base_prefix = f"processed/{tenant_id}/{dataset_id}/{file_id}"
    extracted_text_key = f"{base_prefix}/extracted.txt"
    extracted_pages_key = f"{base_prefix}/extracted_pages.json"

    full_text = "\n\n".join(page["text"] for page in pages)
    write_text(env["PROCESSED_BUCKET"], extracted_text_key, full_text)
    write_json(env["PROCESSED_BUCKET"], extracted_pages_key, pages)

    update_file(
        tenant_dataset_id=f"{tenant_id}#{dataset_id}",
        file_id=file_id,
        updates={
            "rawSha256": raw_sha256,
            "status": "PROCESSING"
        }
    )

    event.update({
        "rawSha256": raw_sha256,
        "extractedTextKey": extracted_text_key,
        "extractedPagesKey": extracted_pages_key,
        "extractionStats": extraction_stats
    })

    return event
