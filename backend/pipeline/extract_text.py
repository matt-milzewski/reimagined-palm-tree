import hashlib
from io import BytesIO
from pypdf import PdfReader
from pdfminer.high_level import extract_text as pdfminer_extract_text

from common.aws import get_env, get_s3_client
from common.ddb import update_file
from common.storage import write_text, write_json
from common.text import compute_extraction_stats, normalize_whitespace


env = get_env()
s3 = get_s3_client()

def extract_pages_pypdf(data: bytes):
    reader = PdfReader(BytesIO(data))
    if reader.is_encrypted:
        try:
            reader.decrypt("")
        except Exception as error:
            raise Exception("Encrypted PDF not supported in MVP.") from error
    pages = []
    for i, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        text = normalize_whitespace(text)
        pages.append({"pageNumber": i + 1, "text": text})
    return pages


def extract_pages_pdfminer(data: bytes):
    text = pdfminer_extract_text(BytesIO(data)) or ""
    raw_pages = text.split("\f")
    if raw_pages and not raw_pages[-1].strip():
        raw_pages = raw_pages[:-1]
    pages = []
    for i, page_text in enumerate(raw_pages):
        normalized = normalize_whitespace(page_text or "")
        pages.append({"pageNumber": i + 1, "text": normalized})
    return pages


def handler(event, _context):
    tenant_id = event["tenantId"]
    dataset_id = event["datasetId"]
    file_id = event["fileId"]
    raw_key = event["rawS3Key"]

    response = s3.get_object(Bucket=env["RAW_BUCKET"], Key=raw_key)
    data = response["Body"].read()

    raw_sha256 = hashlib.sha256(data).hexdigest()

    pages = []
    extraction_method = "pypdf"
    pypdf_error = None
    pdfminer_error = None
    try:
        pages = extract_pages_pypdf(data)
    except Exception as error:
        pypdf_error = str(error)
        pages = []

    extraction_stats = compute_extraction_stats(pages)
    if extraction_stats["textLength"] < 50:
        try:
            pages = extract_pages_pdfminer(data)
            extraction_method = "pdfminer"
            extraction_stats = compute_extraction_stats(pages)
        except Exception as error:
            pdfminer_error = str(error)

    if extraction_stats["textLength"] < 50:
        message = "No extractable text using pypdf or pdfminer. Scanned PDF not supported in MVP."
        raise Exception(message)

    extraction_stats["method"] = extraction_method
    if pypdf_error:
        extraction_stats["pypdfError"] = pypdf_error
    if pdfminer_error:
        extraction_stats["pdfminerError"] = pdfminer_error

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
