from common.aws import get_env
from common.storage import read_json, write_text, write_json
from common.text import (
    normalize_whitespace,
    dehyphenate,
    detect_headers_footers,
    detect_boilerplate_lines,
    remove_lines
)


env = get_env()


def handler(event, _context):
    tenant_id = event["tenantId"]
    dataset_id = event["datasetId"]
    file_id = event["fileId"]

    pages = read_json(env["PROCESSED_BUCKET"], event["extractedPagesKey"])

    cleaned_pages = []
    for page in pages:
        text = page.get("text", "")
        text = dehyphenate(text)
        text = normalize_whitespace(text)
        cleaned_pages.append({"pageNumber": page.get("pageNumber"), "text": text})

    header_lines, footer_lines, confidence = detect_headers_footers(cleaned_pages)
    boilerplate_lines = detect_boilerplate_lines(cleaned_pages)

    normalized_pages = []
    for page in cleaned_pages:
        text = remove_lines(page["text"], header_lines + footer_lines + boilerplate_lines)
        normalized_pages.append({"pageNumber": page["pageNumber"], "text": text})

    clean_full_text = "\n\n".join(page["text"] for page in normalized_pages)

    base_prefix = f"processed/{tenant_id}/{dataset_id}/{file_id}"
    cleaned_text_key = f"{base_prefix}/cleaned_text.txt"
    cleaned_pages_key = f"{base_prefix}/cleaned_pages.json"

    write_text(env["PROCESSED_BUCKET"], cleaned_text_key, clean_full_text)
    write_json(env["PROCESSED_BUCKET"], cleaned_pages_key, normalized_pages)

    event.update({
        "cleanedTextKey": cleaned_text_key,
        "cleanedPagesKey": cleaned_pages_key,
        "normalizationStats": {
            "removedHeaderLines": header_lines,
            "removedFooterLines": footer_lines,
            "removedBoilerplateLines": boilerplate_lines,
            "headerFooterConfidence": round(confidence, 3)
        }
    })

    return event
