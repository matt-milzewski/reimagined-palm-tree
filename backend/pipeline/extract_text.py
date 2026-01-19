import csv
import hashlib
import os
import shutil
import subprocess
import tempfile
import zipfile
import xml.etree.ElementTree as ElementTree
from io import BytesIO, StringIO
from typing import List, Optional
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


def build_pages_from_text(text: str, page_char_limit: int = 4000) -> List[dict]:
    normalized = normalize_whitespace(text)
    if not normalized:
        return []
    if len(normalized) <= page_char_limit:
        return [{"pageNumber": 1, "text": normalized}]

    pages = []
    start = 0
    page_number = 1
    while start < len(normalized):
        end = min(start + page_char_limit, len(normalized))
        slice_text = normalized[start:end]
        if end < len(normalized):
            split_at = slice_text.rfind("\n\n")
            if split_at > int(page_char_limit * 0.6):
                slice_text = slice_text[:split_at]
                end = start + split_at
        chunk = slice_text.strip()
        if chunk:
            pages.append({"pageNumber": page_number, "text": chunk})
            page_number += 1
        if end <= start:
            end = min(start + page_char_limit, len(normalized))
        start = end
    return pages


def extract_text_docx(data: bytes) -> str:
    try:
        with zipfile.ZipFile(BytesIO(data)) as docx:
            with docx.open("word/document.xml") as xml_file:
                root = ElementTree.fromstring(xml_file.read())
    except Exception as error:
        raise Exception("Unable to read DOCX document content.") from error

    paragraphs = []
    for paragraph in root.iter():
        if not paragraph.tag.endswith("}p"):
            continue
        runs = []
        for node in paragraph.iter():
            if node.tag.endswith("}t") and node.text:
                runs.append(node.text)
            elif node.tag.endswith("}tab"):
                runs.append("\t")
            elif node.tag.endswith("}br"):
                runs.append("\n")
        if runs:
            paragraphs.append("".join(runs))
    return "\n\n".join(paragraphs)


def extract_text_csv(data: bytes) -> str:
    decoded = data.decode("utf-8", errors="replace")
    if not decoded.strip():
        return ""

    sample = decoded[:2048]
    try:
        dialect = csv.Sniffer().sniff(sample)
    except Exception:
        dialect = csv.excel

    reader = csv.reader(StringIO(decoded), dialect)
    rows = list(reader)
    if not rows:
        return ""

    header = rows[0]
    start_index = 1
    if not header or all(not cell.strip() for cell in header):
        header = []
        start_index = 0

    lines = []
    if header:
        headers = [cell.strip() or f"column_{i + 1}" for i, cell in enumerate(header)]
        lines.append("Columns: " + ", ".join(headers))
    else:
        headers = []

    row_number = 1
    for row in rows[start_index:]:
        values = [cell.strip() for cell in row]
        if not any(values):
            row_number += 1
            continue
        if headers:
            pairs = []
            for col_index, value in enumerate(values):
                if not value:
                    continue
                col_name = headers[col_index] if col_index < len(headers) else f"column_{col_index + 1}"
                pairs.append(f"{col_name}: {value}")
            if pairs:
                lines.append(f"Row {row_number}: " + "; ".join(pairs))
        else:
            lines.append(f"Row {row_number}: " + ", ".join(value for value in values if value))
        row_number += 1

    return "\n".join(lines)


def resolve_libreoffice_binary() -> str:
    override = os.environ.get("LIBREOFFICE_BIN") or os.environ.get("SOFFICE_BIN")
    if override:
        return override
    for candidate in ("soffice", "libreoffice"):
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    raise Exception("LibreOffice binary not available for DOC conversion.")


def convert_doc_to_docx(data: bytes) -> bytes:
    binary = resolve_libreoffice_binary()
    with tempfile.TemporaryDirectory() as workdir:
        input_path = os.path.join(workdir, "input.doc")
        output_dir = os.path.join(workdir, "out")
        os.makedirs(output_dir, exist_ok=True)
        with open(input_path, "wb") as handle:
            handle.write(data)

        env_vars = os.environ.copy()
        env_vars["HOME"] = workdir
        env_vars["TMPDIR"] = workdir
        command = [
            binary,
            "--headless",
            "--nologo",
            "--nolockcheck",
            "--norestore",
            "--convert-to",
            "docx",
            "--outdir",
            output_dir,
            input_path
        ]
        result = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env_vars,
            timeout=60,
            check=False
        )
        if result.returncode != 0:
            stderr = result.stderr.decode("utf-8", errors="replace").strip()
            raise Exception(f"LibreOffice conversion failed: {stderr or 'unknown error'}")

        output_files = [
            name for name in os.listdir(output_dir)
            if name.lower().endswith(".docx")
        ]
        if not output_files:
            raise Exception("LibreOffice conversion did not produce a DOCX file.")

        output_path = os.path.join(output_dir, output_files[0])
        with open(output_path, "rb") as handle:
            return handle.read()


def detect_file_type(filename: str, content_type: Optional[str]) -> str:
    if content_type:
        lower = content_type.lower()
        if lower in ("application/pdf", "application/x-pdf"):
            return "pdf"
        if lower in ("application/vnd.openxmlformats-officedocument.wordprocessingml.document",):
            return "docx"
        if lower in ("application/msword", "application/vnd.ms-word"):
            return "doc"
        if lower in ("text/csv", "application/csv"):
            return "csv"

    extension = os.path.splitext(filename or "")[1].lower()
    if extension == ".pdf":
        return "pdf"
    if extension == ".docx":
        return "docx"
    if extension == ".doc":
        return "doc"
    if extension == ".csv":
        return "csv"
    return "unknown"


def handler(event, _context):
    tenant_id = event["tenantId"]
    dataset_id = event["datasetId"]
    file_id = event["fileId"]
    raw_key = event["rawS3Key"]
    filename = event.get("filename", "")
    content_type = event.get("contentType")

    response = s3.get_object(Bucket=env["RAW_BUCKET"], Key=raw_key)
    data = response["Body"].read()

    raw_sha256 = hashlib.sha256(data).hexdigest()

    pages = []
    extraction_method = None
    pypdf_error = None
    pdfminer_error = None
    file_type = detect_file_type(filename, content_type)

    if file_type == "pdf":
        extraction_method = "pypdf"
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
    elif file_type == "docx":
        extraction_method = "docx"
        docx_text = extract_text_docx(data)
        pages = build_pages_from_text(docx_text)
        extraction_stats = compute_extraction_stats(pages)
        if extraction_stats["textLength"] < 20:
            raise Exception("No extractable text found in DOCX document.")
    elif file_type == "doc":
        extraction_method = "doc"
        docx_data = convert_doc_to_docx(data)
        docx_text = extract_text_docx(docx_data)
        pages = build_pages_from_text(docx_text)
        extraction_stats = compute_extraction_stats(pages)
        if extraction_stats["textLength"] < 20:
            raise Exception("No extractable text found in DOC document.")
    elif file_type == "csv":
        extraction_method = "csv"
        csv_text = extract_text_csv(data)
        pages = build_pages_from_text(csv_text)
        extraction_stats = compute_extraction_stats(pages)
        if extraction_stats["textLength"] < 20:
            raise Exception("No extractable text found in CSV document.")
    else:
        raise Exception("Unsupported file type. Please upload PDF, DOC, DOCX, or CSV.")

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
